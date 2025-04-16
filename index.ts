import { AdminForthPlugin, AdminForthResource, IHttpServer, IAdminForth, RateLimiter, Filters, AdminUser } from "adminforth";
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
    if (this.options.completion?.adapter) {
      this.options.completion?.adapter.validate();
    }
    // optional method where you can safely check field types after database discovery was performed
    if (this.options.completion && !this.options.completion.adapter) {
      throw new Error(`Completion adapter is required`);
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
        shouldComplete: !!this.options.completion,
        pluginType: 'crepe',
        uploadPluginInstanceId: this.uploadPlugin?.pluginInstanceId,
      },
    };
    
    column.components.create = {
      file: this.componentPath("MarkdownEditor.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        columnName: fieldName,
        shouldComplete: !!this.options.completion,
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
  generateRecordContext(record: any, maxFields: number, inputFieldLimit: number, partsCount: number): string {
    // stringify each field
    let fields: [string, string][] = Object.entries(record).map(([key, value]) => {
      return [key, JSON.stringify(value)];
    });

    // sort fields by length, higher first
    fields = fields.sort((a, b) => b[1].length - a[1].length);

    // select longest maxFields fields
    fields = fields.slice(0, maxFields);

    const minLimit = '...'.length * partsCount;

    if (inputFieldLimit < minLimit) {
      throw new Error(`inputFieldLimit should be at least ${minLimit}`);
    }

    // for each field, if it is longer than inputFieldLimit, truncate it using next way:
    // split into 5 parts, divide inputFieldLimit by 5, crop each part to this length, join parts using '...'
    fields = fields.map(([key, value]) => {
      if (value.length > inputFieldLimit) {
        const partLength = Math.floor(inputFieldLimit / partsCount) - '...'.length;
        const parts: string[] = [];
        for (let i = 0; i < partsCount; i++) {
          parts.push(value.slice(i * partLength, (i + 1) * partLength));
        }
        value = parts.join('...');
        return [key, value];
      }
      return [key, value];
    });

    return JSON.stringify(Object.fromEntries(fields));
  }

  setupEndpoints(server: IHttpServer) {
    console.log('-----😀😀😀😀----------------------------- Setup endpoints for plugin', this.pluginInstanceId);
    server.endpoint({
      method: 'POST',
      path: `/plugin/${this.pluginInstanceId}/doComplete`,
      handler: async ({ body, headers }) => {
        console.log('-----😀😀😀😀----------------------------- Do complete for plugin', this.pluginInstanceId);
        const { record } = body;

        if (this.options.completion.rateLimit?.limit) {
          // rate limit
          const { error } = RateLimiter.checkRateLimit(
            this.pluginInstanceId, 
            this.options.completion.rateLimit?.limit,
            this.adminforth.auth.getClientIp(headers),
          );
          if (error) {
            return {
              completion: [],
            }
          }
        }
        const recordNoField = {...record};
        delete recordNoField[this.options.fieldName];
        let currentVal = record[this.options.fieldName] as string;
        const promptLimit = this.options.completion.expert?.promptInputLimit || 500;
        const inputContext = this.generateRecordContext(
          recordNoField,
          this.options.completion.expert?.recordContext?.maxFields || 5, 
          this.options.completion.expert?.recordContext?.maxFieldLength || 300,
          this.options.completion.expert?.recordContext?.splitParts || 5,
        );

        if (currentVal && currentVal.length > promptLimit) {
          currentVal = currentVal.slice(-promptLimit);
        }

        const resLabel = this.resourceConfig!.label;
       
        let content;
        
        if (currentVal) {
          content = `Continue writing for text/string field "${this.options.fieldName}" in the table "${resLabel}"\n` +
              (Object.keys(recordNoField).length > 0 ? `Record has values for the context: ${inputContext}\n` : '') +
              `Current field value: ${currentVal}\n` +
              "Don't talk to me. Just write text. No quotes. Don't repeat current field value, just write completion\n";

        } else {
          content = `Fill text/string field "${this.options.fieldName}" in the table "${resLabel}"\n` +
              (Object.keys(recordNoField).length > 0 ? `Record has values for the context: ${inputContext}\n` : '') +
              "Be short, clear and precise. No quotes. Don't talk to me. Just write text\n";
        }

        process.env.HEAVY_DEBUG && console.log('🪲 OpenAI Prompt 🧠', content);
        const { content: respContent, finishReason } = await this.options.completion.adapter.complete(content, this.options.completion?.expert?.stop, this.options.completion?.expert?.maxTokens);
        const stop = this.options.completion.expert?.stop || ['.'];
        let suggestion = respContent + (
          finishReason === 'stop' ? (
            stop[0] === '.' && stop.length === 1 ? '. ' : ''
          ) : ''
        );

        if (suggestion.startsWith(currentVal)) {
          suggestion = suggestion.slice(currentVal.length);
        }
        const wordsList = suggestion.split(' ').map((w, i) => {
          return (i === suggestion.split(' ').length - 1) ? w : w + ' ';
        });
        console.log('🪲 OpenAI Suggestion 🧠', wordsList);
        // remove quotes from start and end
        return {
          completion: wordsList
        };
      }
    });

  }
}
