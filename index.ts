import { AdminForthPlugin, AdminForthResource, IAdminForth, Filters, AdminUser} from "adminforth";
import { PluginOptions } from "./types.js";

export default class MarkdownPlugin extends AdminForthPlugin {
  options: PluginOptions;
  resourceConfig!: AdminForthResource;
  adminforth!: IAdminForth;
  uploadPlugin: AdminForthPlugin;
  attachmentResource: AdminForthResource = undefined;

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
  }

  instanceUniqueRepresentation(pluginOptions: any): string {
    return pluginOptions.fieldName;
  }

  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    this.adminforth = adminforth;
    const column = resourceConfig.columns.find(c => c.name === this.options.fieldName);
    if (!column) {
      throw new Error(`Column ${this.options.fieldName} not found in resource ${resourceConfig.label}`);
    }
    const validDataTypes = ['string', 'text', 'richtext'];

    if (!validDataTypes.includes(column.type)) {
      throw new Error(`Column ${this.options.fieldName} must be of type 'string', 'text' or 'richtext'.`);
    }
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);
    this.resourceConfig = resourceConfig;

    const fieldName = this.options.fieldName;
    const column = resourceConfig.columns.find(c => c.name === fieldName);
    if (!column) {
      throw new Error(`Column ${fieldName} not found in resource ${resourceConfig.label}`);
    }

    if (!column.components) {
      column.components = {};
    }
    if (this.options.attachments) {
      const resource = await adminforth.config.resources.find(r => r.resourceId === this.options.attachments!.attachmentResource);
      if (!resource) {
        throw new Error(`Resource '${this.options.attachments!.attachmentResource}' not found`);
      }
      this.attachmentResource = resource;
      const field = await resource.columns.find(c => c.name === this.options.attachments!.attachmentFieldName);
      if (!field) {
        throw new Error(`Field '${this.options.attachments!.attachmentFieldName}' not found in resource '${this.options.attachments!.attachmentResource}'`);
      }
      
      const plugin = await adminforth.activatedPlugins.find(p => 
        p.resourceConfig!.resourceId === this.options.attachments!.attachmentResource && 
        p.pluginOptions.pathColumnName === this.options.attachments!.attachmentFieldName
      );
      if (!plugin) {
        throw new Error(`${plugin} Plugin for attachment field '${this.options.attachments!.attachmentFieldName}' not found in resource '${this.options.attachments!.attachmentResource}', please check if Upload Plugin is installed on the field ${this.options.attachments!.attachmentFieldName}`);
      }

      if (plugin.pluginOptions.s3ACL !== 'public-read') {
        throw new Error(`Upload Plugin for attachment field '${this.options.attachments!.attachmentFieldName}' in resource '${this.options.attachments!.attachmentResource}' 
          should have s3ACL set to 'public-read' (in vast majority of cases signed urls inside of HTML text is not desired behavior, so we did not implement it)`);
      }
      this.uploadPlugin = plugin;
    }

    column.components.show = {
      file: this.componentPath("MarkdownRenderer.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        columnName: fieldName,
      },
    };

    column.components.list = {
      file: this.componentPath("MarkdownRenderer.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        columnName: fieldName,
      },
    };

    column.components.edit = {
      file: this.componentPath("MarkdownEditor.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        columnName: fieldName,
        pluginType: 'crepe',
        uploadPluginInstanceId: this.uploadPlugin?.pluginInstanceId,
      },
    };
    
    column.components.create = {
      file: this.componentPath("MarkdownEditor.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        columnName: fieldName,
        pluginType: 'crepe',
        uploadPluginInstanceId: this.uploadPlugin?.pluginInstanceId,
      },
    };
    const editorRecordPkField = resourceConfig.columns.find(c => c.primaryKey);
    if (this.options.attachments) {

      function getAttachmentPathes(markdown: string): string[] {
        if (!markdown) {
          return [];
        }

        const s3PathRegex = /!\[.*?\]\((https:\/\/.*?\/.*?)(\?.*)?\)/g;
      
        const matches = [...markdown.matchAll(s3PathRegex)];

        return matches
          .map(match => match[1])
          .filter(src => src.includes("s3") || src.includes("amazonaws"));
      }

      const createAttachmentRecords = async (
        adminforth: IAdminForth, options: PluginOptions, recordId: any, s3Paths: string[], adminUser: AdminUser
      ) => {
        const extractKey = (s3Paths: string) => s3Paths.replace(/^https:\/\/[^\/]+\/+/, '');
        process.env.HEAVY_DEBUG && console.log('📸 Creating attachment records', JSON.stringify(recordId))
        try {
          await Promise.all(s3Paths.map(async (s3Path) => {
            console.log('Processing path:', s3Path);
            try {
              await adminforth.createResourceRecord(
                {
                  resource: this.attachmentResource,
                  record: {
                    [options.attachments.attachmentFieldName]: extractKey(s3Path),
                    [options.attachments.attachmentRecordIdFieldName]: recordId,
                    [options.attachments.attachmentResourceIdFieldName]: resourceConfig.resourceId,
                  },
                  adminUser
                }
              );
              console.log('Successfully created record for:', s3Path);
            } catch (err) {
              console.error('Error creating record for', s3Path, err);
            }
          }));
        } catch (err) {
          console.error('Error in Promise.all', err);
        }
      }

      const deleteAttachmentRecords = async (
        adminforth: IAdminForth, options: PluginOptions, s3Paths: string[], adminUser: AdminUser
      ) => {
        if (!s3Paths.length) {
          return;
        }
        const attachmentPrimaryKeyField = this.attachmentResource.columns.find(c => c.primaryKey);
        const attachments = await adminforth.resource(options.attachments.attachmentResource).list(
          Filters.IN(options.attachments.attachmentFieldName, s3Paths)
        );
        await Promise.all(attachments.map(async (a: any) => {
          await adminforth.deleteResourceRecord(
            {
              resource: this.attachmentResource,
              recordId: a[attachmentPrimaryKeyField.name],
              adminUser,
              record: a,
            }
          )
        }))
      }
      
      (resourceConfig.hooks.create.afterSave).push(async ({ record, adminUser }: { record: any, adminUser: AdminUser }) => {
        // find all s3Paths in the html
        const s3Paths = getAttachmentPathes(record[this.options.fieldName])
        
        process.env.HEAVY_DEBUG && console.log('📸 Found s3Paths', s3Paths);
        // create attachment records
        await createAttachmentRecords(
          adminforth, this.options, record[editorRecordPkField.name], s3Paths, adminUser);

        return { ok: true };
      });

      // after edit we need to delete attachments that are not in the html anymore
      // and add new ones
      (resourceConfig.hooks.edit.afterSave).push(
        async ({ recordId, record, adminUser }: { recordId: any, record: any, adminUser: AdminUser }) => {
          process.env.HEAVY_DEBUG && console.log('⚓ Cought hook', recordId, 'rec', record);
          if (record[this.options.fieldName] === undefined) {
            console.log('⚓ Cought hook', recordId, 'rec', record);
            // field was not changed, do nothing
            return { ok: true };
          }
          const existingAparts = await adminforth.resource(this.options.attachments.attachmentResource).list([
            Filters.EQ(this.options.attachments.attachmentRecordIdFieldName, recordId),
            Filters.EQ(this.options.attachments.attachmentResourceIdFieldName, resourceConfig.resourceId)
          ]);
          const existingS3Paths = existingAparts.map((a: any) => a[this.options.attachments.attachmentFieldName]);
          const newS3Paths = getAttachmentPathes(record[this.options.fieldName]);
          process.env.HEAVY_DEBUG && console.log('📸 Existing s3Paths (from db)', existingS3Paths)
          process.env.HEAVY_DEBUG && console.log('📸 Found new s3Paths (from text)', newS3Paths);
          const toDelete = existingS3Paths.filter(s3Path => !newS3Paths.includes(s3Path));
          const toAdd = newS3Paths.filter(s3Path => !existingS3Paths.includes(s3Path));
          process.env.HEAVY_DEBUG && console.log('📸 Found s3Paths to delete', toDelete)
          process.env.HEAVY_DEBUG && console.log('📸 Found s3Paths to add', toAdd);
          await Promise.all([
            deleteAttachmentRecords(adminforth, this.options, toDelete, adminUser),
            createAttachmentRecords(adminforth, this.options, recordId, toAdd, adminUser)
          ]);

          return { ok: true };

        }
      );

      // after delete we need to delete all attachments
      (resourceConfig.hooks.delete.afterSave).push(
        async ({ record, adminUser }: { record: any, adminUser: AdminUser }) => {
          const existingAparts = await adminforth.resource(this.options.attachments.attachmentResource).list(
            [
              Filters.EQ(this.options.attachments.attachmentRecordIdFieldName, record[editorRecordPkField.name]),
              Filters.EQ(this.options.attachments.attachmentResourceIdFieldName, resourceConfig.resourceId)
            ]
          );
          const existingS3Paths = existingAparts.map((a: any) => a[this.options.attachments.attachmentFieldName]);
          process.env.HEAVY_DEBUG && console.log('📸 Found s3Paths to delete', existingS3Paths);
          await deleteAttachmentRecords(adminforth, this.options, existingS3Paths, adminUser);

          return { ok: true };
        }
      );
    }
  }
}
