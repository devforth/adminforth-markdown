<template>
    <div v-html="purifiedHtml" class="mdwn"></div>
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
      return '-';
    }
    return DOMPurify.sanitize(html);
  });
  </script>
  
  <style lang="scss">
  
    .mdwn h1 {
      @apply text-2xl font-bold mt-2 mb-2;
    }

    .mdwn h2 {
      @apply text-xl font-bold mt-2 mb-2;
    }

    .mdwn h3 {
      @apply text-lg font-bold mt-2 mb-2;
    }

    .mdwn h4 {
      @apply text-base font-bold mt-2 mb-2;
    }

    .mdwn h5 {
      @apply text-sm font-bold mt-2 mb-2;
    }

    .mdwn h6 {
      @apply text-xs font-bold mt-2 mb-2;
    }

    .mdwn p {
      @apply mb-2 leading-relaxed;
    }

    .mdwn ul {
      @apply list-disc pl-5 mb-2;
    }

    .mdwn ol {
      @apply list-decimal pl-5 mb-2;
    }

    .mdwn li {
      @apply mb-1;
    }

    .mdwn blockquote {
      @apply border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 mb-2;
    }

    .mdwn code {
      @apply bg-gray-100 dark:bg-gray-800 text-red-600 dark:text-red-400 font-mono px-1 py-0.5 rounded;
    }

    .mdwn pre {
      @apply bg-gray-100 dark:bg-gray-900 text-sm font-mono p-4 rounded overflow-x-auto mb-2;
    }
    .mdwn pre code {
      @apply bg-transparent p-0 text-inherit;
    }

    .mdwn table {
      @apply w-full border-collapse text-left text-sm mb-2;
    }

    .mdwn thead {
      @apply bg-gray-100 dark:bg-gray-700;
    }

    .mdwn th,
    .mdwn td {
      @apply border border-gray-300 dark:border-gray-700 px-4 py-2;
    }

    .mdwn th {
      @apply font-semibold;
    }

    .mdwn hr {
      @apply border-t border-gray-300 dark:border-gray-700 my-6;
    }

    .mdwn img {
      @apply max-w-full h-auto rounded;
    }

    .mdwn a {
      @apply text-blue-600 hover:underline dark:text-blue-400;
    }

  </style>