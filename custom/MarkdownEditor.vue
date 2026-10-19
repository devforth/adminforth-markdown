<template>
  <MonacoMarkdownEditor :column="column" :record="record" :meta="meta" @update:value="emit('update:value', $event)" />
</template>

<script setup lang="ts">
import { defineAsyncComponent, h } from 'vue';

defineProps<{
  column: any,
  record: any,
  meta: any,
}>();

const emit = defineEmits(['update:value']);

// Monaco is about 900 KB gzip: it loads when an editor is shown, while the SPA prefetches only this small wrapper
// after every page load. Meanwhile an empty frame of the editor of the minimal height keeps the form from jumping
// (toolbar 37px, text 160px, borders)
const MonacoMarkdownEditor = defineAsyncComponent({
  loader: () => import('./MonacoMarkdownEditor.vue'),
  loadingComponent: {
    render: () => h('div', {
      class: 'af-markdown-editor mb-2 w-full h-[199px] rounded-default border shadow-customLight border-lightInputBorder bg-lightInputBackground dark:border-darkInputBorder dark:bg-darkInputBackground',
    }),
  },
  delay: 0,
});
</script>
