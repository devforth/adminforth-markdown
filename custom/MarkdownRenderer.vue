<template>
    <div v-html="purifiedHtml" class="prose"></div>
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
  