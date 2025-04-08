import { AdminForthPlugin, AdminForthResource, IAdminForth } from "adminforth";
import { PluginOptions } from "./types.js";

export default class MarkdownPlugin extends AdminForthPlugin {
  options: PluginOptions;
  resourceConfig!: AdminForthResource;
  adminforth!: IAdminForth;

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
      },
    };
    
    column.components.create = {
      file: this.componentPath("MarkdownEditor.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        columnName: fieldName,
        pluginType: 'crepe',
      },
    };
  }
}
