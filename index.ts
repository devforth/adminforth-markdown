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

      if (this.options.attachments.attachmentTitleFieldName) {
        const titleField = await resource.columns.find(c => c.name === this.options.attachments!.attachmentTitleFieldName);
        if (!titleField) {
          throw new Error(`Field '${this.options.attachments!.attachmentTitleFieldName}' not found in resource '${this.options.attachments!.attachmentResource}'`);
        }
      }

      if (this.options.attachments.attachmentAltFieldName) {
        const altField = await resource.columns.find(c => c.name === this.options.attachments!.attachmentAltFieldName);
        if (!altField) {
          throw new Error(`Field '${this.options.attachments!.attachmentAltFieldName}' not found in resource '${this.options.attachments!.attachmentResource}'`);
        }
      }
      
      const plugin = await adminforth.activatedPlugins.find(p => 
        p.resourceConfig!.resourceId === this.options.attachments!.attachmentResource && 
        p.pluginOptions.pathColumnName === this.options.attachments!.attachmentFieldName
      );
      if (!plugin) {
        throw new Error(`${plugin} Plugin for attachment field '${this.options.attachments!.attachmentFieldName}' not found in resource '${this.options.attachments!.attachmentResource}', please check if Upload Plugin is installed on the field ${this.options.attachments!.attachmentFieldName}`);
      }

      if (!plugin.pluginOptions.storageAdapter.objectCanBeAccesedPublicly()) {
        throw new Error(`Upload Plugin for attachment field '${this.options.attachments!.attachmentFieldName}' in resource '${this.options.attachments!.attachmentResource}' 
          uses adapter which is not configured to store objects in public way, so it will produce only signed private URLs which can not be used in HTML text of blog posts.
          Please configure adapter in such way that it will store objects publicly (e.g.  for S3 use 'public-read' ACL).  
        `);
      }
      this.uploadPlugin = plugin as AdminForthPlugin;
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
        uploadPluginInstanceId: this.uploadPlugin?.pluginInstanceId,
      },
    };
    
    column.components.create = {
      file: this.componentPath("MarkdownEditor.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        columnName: fieldName,
        uploadPluginInstanceId: this.uploadPlugin?.pluginInstanceId,
      },
    };
    const editorRecordPkField = resourceConfig.columns.find(c => c.primaryKey);
    if (this.options.attachments) {

      type AttachmentMeta = { key: string; alt: string | null; title: string | null };

      const extractKeyFromUrl = (url: string) => url.replace(/^https:\/\/[^\/]+\/+/, '');

      function getAttachmentMetas(markdown: string): AttachmentMeta[] {
        if (!markdown) {
          return [];
        }

        // Minimal image syntax: ![alt](src) or ![alt](src "title") or ![alt](src 'title')
        // We only track https URLs and only those that look like S3/AWS public URLs.
        const imageRegex = /!\[([^\]]*)\]\(\s*(https:\/\/[^\s)]+)\s*(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g;

        const byKey = new Map<string, AttachmentMeta>();
        for (const match of markdown.matchAll(imageRegex)) {
          const altRaw = match[1] ?? '';
          const srcRaw = match[2];
          const titleRaw = (match[3] ?? match[4]) ?? null;

          const srcNoQuery = srcRaw.split('?')[0];
          if (!srcNoQuery.includes('s3') && !srcNoQuery.includes('amazonaws')) {
            continue;
          }

          const key = extractKeyFromUrl(srcNoQuery);
          byKey.set(key, {
            key,
            alt: altRaw,
            title: titleRaw,
          });
        }
        return [...byKey.values()];
      }

      const createAttachmentRecords = async (
        adminforth: IAdminForth,
        options: PluginOptions,
        recordId: any,
        metas: AttachmentMeta[],
        adminUser: AdminUser
      ) => {
        if (!metas.length) {
          return;
        }
        process.env.HEAVY_DEBUG && console.log('📸 Creating attachment records', JSON.stringify(recordId))
        try {
          await Promise.all(metas.map(async (meta) => {
            try {
              const recordToCreate: any = {
                [options.attachments.attachmentFieldName]: meta.key,
                [options.attachments.attachmentRecordIdFieldName]: recordId,
                [options.attachments.attachmentResourceIdFieldName]: resourceConfig.resourceId,
              };

              if (options.attachments.attachmentTitleFieldName) {
                recordToCreate[options.attachments.attachmentTitleFieldName] = meta.title;
              }
              if (options.attachments.attachmentAltFieldName) {
                recordToCreate[options.attachments.attachmentAltFieldName] = meta.alt;
              }

              await adminforth.createResourceRecord({
                resource: this.attachmentResource,
                record: recordToCreate,
                adminUser,
              });
            } catch (err) {
              console.error('Error creating record for', meta.key, err);
            }
          }));
        } catch (err) {
          console.error('Error in Promise.all', err);
        }
      }

      const deleteAttachmentRecords = async (
        adminforth: IAdminForth,
        options: PluginOptions,
        recordId: any,
        keys: string[],
        adminUser: AdminUser
      ) => {
        if (!keys.length) {
          return;
        }
        const attachmentPrimaryKeyField = this.attachmentResource.columns.find(c => c.primaryKey);
        const attachments = await adminforth.resource(options.attachments.attachmentResource).list([
          Filters.EQ(options.attachments.attachmentRecordIdFieldName, recordId),
          Filters.EQ(options.attachments.attachmentResourceIdFieldName, resourceConfig.resourceId),
          Filters.IN(options.attachments.attachmentFieldName, keys),
        ]);

        await Promise.all(attachments.map(async (a: any) => {
          await adminforth.deleteResourceRecord({
            resource: this.attachmentResource,
            recordId: a[attachmentPrimaryKeyField.name],
            adminUser,
            record: a,
          })
        }))
      }

      const updateAttachmentRecordsMetadata = async (
        adminforth: IAdminForth,
        options: PluginOptions,
        recordId: any,
        metas: AttachmentMeta[],
        adminUser: AdminUser
      ) => {
        if (!metas.length) {
          return;
        }
        if (!options.attachments.attachmentTitleFieldName && !options.attachments.attachmentAltFieldName) {
          return;
        }
        const attachmentPrimaryKeyField = this.attachmentResource.columns.find(c => c.primaryKey);
        const metaByKey = new Map(metas.map(m => [m.key, m] as const));

        const existingAparts = await adminforth.resource(options.attachments.attachmentResource).list([
          Filters.EQ(options.attachments.attachmentRecordIdFieldName, recordId),
          Filters.EQ(options.attachments.attachmentResourceIdFieldName, resourceConfig.resourceId)
        ]);

        await Promise.all(existingAparts.map(async (a: any) => {
          const key = a[options.attachments.attachmentFieldName];
          const meta = metaByKey.get(key);
          if (!meta) {
            return;
          }

          const patch: any = {};
          if (options.attachments.attachmentTitleFieldName) {
            const field = options.attachments.attachmentTitleFieldName;
            if ((a[field] ?? null) !== (meta.title ?? null)) {
              patch[field] = meta.title;
            }
          }
          if (options.attachments.attachmentAltFieldName) {
            const field = options.attachments.attachmentAltFieldName;
            if ((a[field] ?? null) !== (meta.alt ?? null)) {
              patch[field] = meta.alt;
            }
          }
          if (!Object.keys(patch).length) {
            return;
          }

          await adminforth.updateResourceRecord({
            resource: this.attachmentResource,
            recordId: a[attachmentPrimaryKeyField.name],
            record: patch,
            oldRecord: a,
            adminUser,
          });
        }));
      }
      
      (resourceConfig.hooks.create.afterSave).push(async ({ record, adminUser }: { record: any, adminUser: AdminUser }) => {
        // find all s3Paths in the html
        const metas = getAttachmentMetas(record[this.options.fieldName]);
        const keys = metas.map(m => m.key);
        process.env.HEAVY_DEBUG && console.log('📸 Found attachment keys', keys);
        // create attachment records
        await createAttachmentRecords(
          adminforth, this.options, record[editorRecordPkField.name], metas, adminUser);

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
          const existingKeys = existingAparts.map((a: any) => a[this.options.attachments.attachmentFieldName]);

          const metas = getAttachmentMetas(record[this.options.fieldName]);
          const newKeys = metas.map(m => m.key);

          process.env.HEAVY_DEBUG && console.log('📸 Existing keys (from db)', existingKeys)
          process.env.HEAVY_DEBUG && console.log('📸 Found new keys (from text)', newKeys);

          const toDelete = existingKeys.filter(key => !newKeys.includes(key));
          const toAdd = newKeys.filter(key => !existingKeys.includes(key));

          process.env.HEAVY_DEBUG && console.log('📸 Found keys to delete', toDelete)
          process.env.HEAVY_DEBUG && console.log('📸 Found keys to add', toAdd);

          const metasToAdd = metas.filter(m => toAdd.includes(m.key));
          await Promise.all([
            deleteAttachmentRecords(adminforth, this.options, recordId, toDelete, adminUser),
            createAttachmentRecords(adminforth, this.options, recordId, metasToAdd, adminUser)
          ]);

          // Keep alt/title in sync for existing attachments too
          await updateAttachmentRecordsMetadata(adminforth, this.options, recordId, metas, adminUser);

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
          const existingKeys = existingAparts.map((a: any) => a[this.options.attachments.attachmentFieldName]);
          process.env.HEAVY_DEBUG && console.log('📸 Found keys to delete', existingKeys);
          await deleteAttachmentRecords(adminforth, this.options, record[editorRecordPkField.name], existingKeys, adminUser);

          return { ok: true };
        }
      );
    }
  }
}
