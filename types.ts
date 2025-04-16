
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
     * For example when RichEditor installed on description field of apartment resource, it will store id of apartment resource.
     */
    attachmentResourceIdFieldName: string; // e.g. 'apartment_resource_id',
  },
}
