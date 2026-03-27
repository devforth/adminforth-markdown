<template>
    <div 
      v-html="purifiedHtml"   
      class="prose
         prose-p:my-0
         prose-headings:my-0
         prose-h1:text-[1.6rem]
         prose-ul:my-0
         prose-ol:my-0
         prose-li:my-0
         prose-pre:my-0
         prose-hr:my-1
         leading-tight
         dark: dark:text-gray-300
         dark:[&_h1]:text-white dark:[&_h2]:text-gray-100 dark:[&_h3]:text-gray-200
         dark:[&_a]:text-white dark:[&_a:hover]:text-white
         dark:[&_pre]:bg-black dark:[&_pre]:border dark:[&_border-slate-800]
         dark:[&_strong]:text-white
         dark:[&_em]:text-gray-400
         dark:[&_del]:text-gray-600">
      </div>
  </template>
  
  <script setup lang="ts">
  import { computed } from 'vue';
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  
  const props = defineProps<{ column: any; record: any }>();
  
  const purifiedHtml = computed(() => {

    if (!props.record[props.column.name]) return '-';
    const html = marked(String(props.record[props.column.name]));
    if (html instanceof Promise) {
      console.error("Async rendering is not supported in this setup.");
      return '';
    }
    return DOMPurify.sanitize(html);
  });
  </script>
  