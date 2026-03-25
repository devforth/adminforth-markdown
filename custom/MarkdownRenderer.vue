<template>
    <div 
      v-html="purifiedHtml"   
      class="prose
         prose-p:my-0
         prose-headings:my-0
         prose-ul:my-0
         prose-ol:my-0
         prose-li:my-0
         prose-pre:my-0
         prose-hr:my-1
         leading-tight
         "
      ></div>
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
  