
export interface PluginOptions {
  fieldName: string;

  /**
   * Allows to attach images to the HTML text
   * Requires to have a separate resource with Upload Plugin installed on attachment field.
   * Each attachment used in HTML will create one record in the attachment resource.
   */
  attachments?: {
    /**
     * Resource name where images are stored. Should point to the existing resource.
     */
    attachmentResource: string;

    /**
     * Field name in the attachment resource where image is stored. Should point to the existing field in the attachment resource.
     * Also there should be upload plugin installed on this field.
     */
    attachmentFieldName: string; // e.g. 'image_path',

    /**
     * When attachment is created, it will be linked to the record, by storing id of the record with editor in attachment resource.
     * Here you define the field name where this id will be stored.
     * 
     * Linking is needed to remove all attachments when record is deleted.
     * 
     * For example when RichEditor installed on description field of apartment resource,
     * field in attachment resource described hear will store id of apartment record.
     */
    attachmentRecordIdFieldName: string; // e.g. 'apartment_id',

    /**
     * When attachment is created, it will be linked to the resource, by storing id of the resource with editor in attachment resource.
     * Here you define the field name where this id will be stored.
     * For example when RichEditor installed on description field of apartment resource, it will store id of apartment resource.
     * 
     * Why we force to store and ask for resource id if we already have record id? Because in amny use cases attachments resource is shared between multiple resources, and record id might be not be unique across resources, but resource id + record id will be always unique.
     */
    attachmentResourceIdFieldName: string; // e.g. 'apartment_resource_id',

    /**
     * Optional: field name in attachment resource where title of image will be stored.
     * When in markdown title of image is mentioned e.g. ![alt](image.jpg "title"), it will be parsed and stored in attachment resource. 
     * If you will update title in markdown, it will be updated in attachment resource as well.
     */
    attachmentTitleFieldName?: string; // e.g. 'title',

    /**
     * Optional: field name in attachment resource where alt of image will be stored.
     * When in markdown alt of image is mentioned e.g. ![alt](image.jpg), it will be parsed and stored in attachment resource.
     * If you will update alt in markdown, it will be updated in attachment resource as well.
     */
    attachmentAltFieldName?: string; // e.g. 'alt',
  },
}
