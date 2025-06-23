<template>
  <div class="mb-2"></div>
    <div ref="editorContainer" id="editor" :class="[
    'text-sm rounded-lg block w-full transition-all box-border',
    isFocused
      ? 'ring-1 ring-lightPrimary border ring-lightPrimary border-lightPrimary dark:ring-darkPrimary dark:border-darkPrimary bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
      : 'bg-gray-50 border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white',
  ]"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { callAdminForthApi } from '@/utils';
import { Editor } from '@milkdown/core';
import { Crepe } from '@milkdown/crepe';
import type { AdminForthColumn } from '@/types/Common';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame-dark.css';

const props = defineProps<{
  column: AdminForthColumn,
  record: any,
  meta: any,
}>()

const emit = defineEmits(['update:value']);
const editorContainer = ref<HTMLElement | null>(null);
const content = ref(props.record[props.column.name] || '');

const isFocused = ref(false);

let milkdownInstance: Editor | null = null;
let crepeInstance: Crepe | null = null;

onMounted(async () => {
  if (!editorContainer.value) return;
  try {
    // Milkdown
    // console.log('props.cole', props.column)
    // if (props.column.components.edit.meta.pluginType === 'milkdown' || props.column.components.create.meta.pluginType === 'milkdown') {
    //   milkdownInstance = await Editor.make()
    //     .config((ctx) => {
    //       ctx.set(rootCtx, editorContainer.value!);
    //       ctx.set(defaultValueCtx, content.value);
    //       ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
    //         content.value = markdown;
    //         emit('update:value', markdown);
    //       });
    //       ctx.get(listenerCtx).focus(() => {
    //         isFocused.value = true;
    //       });

    //       ctx.get(listenerCtx).blur(() => {
    //         isFocused.value = false;
    //       });
    //     })
    //     .use(commonmark)
    //     .use(gfm)
    //     .use(listener)
    //     .create();

    //   console.log('Milkdown editor created');
    // }

    // Crepe
    if (props.column.components.edit.meta.pluginType === 'crepe' || props.column.components.create.meta.pluginType === 'crepe') {
      crepeInstance = await new Crepe({
        root: editorContainer.value,
        defaultValue: content.value,
      });

      crepeInstance.on((listener) => {
        listener.markdownUpdated(async () => {
          let markdownContent = crepeInstance.getMarkdown(); 
          markdownContent = await replaceBlobsWithS3Urls(markdownContent);
          emit('update:value', markdownContent);
        });

        listener.focus(() => {
          isFocused.value = true;
        });
        listener.blur(() => {
          isFocused.value = false;
        });
      });

      await crepeInstance.create();
      console.log('Crepe editor created');
    }
  } catch (error) {
    console.error('Failed to initialize editor:', error);
  }
});

async function replaceBlobsWithS3Urls(markdownContent: string): Promise<string> {
  const blobUrls = markdownContent.match(/blob:[^\s)]+/g);
  const base64Images = markdownContent.match(/data:image\/[^;]+;base64,[^\s)]+/g);
  if (blobUrls) {
    for (let blobUrl of blobUrls) {
      const file = await getFileFromBlobUrl(blobUrl);
      if (file) {
        const s3Url = await uploadFileToS3(file);
        if (s3Url) {
          markdownContent = markdownContent.replace(blobUrl, s3Url);
        }
      }
    }
  }
  if (base64Images) {
  for (let base64Image of base64Images) {
      const file = await fetch(base64Image).then(res => res.blob()).then(blob => new File([blob], 'image.jpg', { type: blob.type }));
      if (file) {
        const s3Url = await uploadFileToS3(file);
        if (s3Url) {
          markdownContent = markdownContent.replace(base64Image, s3Url);
        }
      }
    }
  }
  return markdownContent;
}

async function getFileFromBlobUrl(blobUrl: string): Promise<File | null> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    const file = new File([blob], 'uploaded-image.jpg', { type: blob.type });
    return file;
  } catch (error) {
    console.error('Failed to get file from blob URL:', error);
    return null;
  }
}
async function uploadFileToS3(file: File) {
  if (!file || !file.name) {
    console.error('File or file name is undefined');
    return;
  }

  const formData = new FormData();
  formData.append('image', file);
  const originalFilename = file.name.split('.').slice(0, -1).join('.');
  const originalExtension = file.name.split('.').pop();

  const { uploadUrl, tagline, previewUrl, s3Path, error } = await callAdminForthApi({
    path: `/plugin/${props.meta.uploadPluginInstanceId}/get_file_upload_url`,
    method: 'POST',
    body: {
      originalFilename,
      contentType: file.type,
      size: file.size,
      originalExtension,
    },
  });

  if (error) {
    console.error('Upload failed:', error);
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open('PUT', uploadUrl, true);
  xhr.setRequestHeader('Content-Type', file.type);
  xhr.setRequestHeader('x-amz-tagging', tagline);
  xhr.send(file);

  return new Promise((resolve, reject) => {
    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(previewUrl);
      } else {
        reject('Error uploading to S3');
      }
    };

    xhr.onerror = () => {
      reject('Error uploading to S3');
    };
  });
}

onBeforeUnmount(() => {
  milkdownInstance?.destroy();
  crepeInstance?.destroy();
  console.log('Editor destroyed');
});
</script>

<style>
#editor [contenteditable="true"] {
  @apply bg-transparent outline-none border-none shadow-none transition-none min-h-10 p-2 bg-gray-700 dark:placeholder-gray-400;
}

#editor [contenteditable="true"].is-focused {
  @apply ring-1 ring-lightPrimary border ring-lightPrimary border-lightPrimary bg-white text-gray-900 dark:ring-darkPrimary dark:border-darkPrimary dark:bg-gray-700 dark:text-white;
}

#editor [contenteditable="true"]:not(.is-focused) {
  @apply bg-gray-50 border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white;
}

.milkdown milkdown-slash-menu {
  @apply bg-gray-50 border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white z-10;
}

.milkdown milkdown-slash-menu .menu-groups .menu-group li.hover {
  @apply bg-gray-50 border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white;
}

.milkdown milkdown-slash-menu .tab-group ul li.selected {
  @apply bg-gray-50 border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white;
}

.milkdown-slash-menu .tab-group ul li.selected:hover {
  @apply bg-gray-50 border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white;
}

.milkdown milkdown-code-block {
  @apply bg-gray-50 border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white;
}

.milkdown milkdown-code-block .cm-gutters {
  @apply bg-gray-50 border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white;
}


</style>
