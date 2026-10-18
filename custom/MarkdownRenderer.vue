<template>
  <div>
    <div
      :class="{ 'overflow-hidden': !expanded && isOverflowing }"
      :style="!expanded && isOverflowing ? computedMaxHeight : {}"
    >
      <div
        ref="contentRef"
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
           prose-table:my-0
           leading-[1.5]
           dark:[&_th]:text-darkShowTableBodyText
           dark:[&_td]:text-darkShowTableBodyText
           [&_thead]:border-b-lightInputBorder
           dark:[&_thead]:border-b-darkInputBorder
           dark:[&_code]:text-darkShowTableBodyText
           dark:[&_h1]:text-darkShowTableBodyText
           dark:[&_h2]:text-darkShowTableBodyText
           dark:[&_h3]:text-darkShowTableBodyText
           dark:[&_strong]:text-darkShowTableBodyText
           [&_a]:text-lightPrimary
           dark:[&_a]:text-darkPrimary
           [&_pre]:bg-lightSecondaryDarken
           [&_pre]:text-lightInputText
           dark:[&_pre]:bg-darkSecondaryLighten
           dark:[&_pre]:text-darkInputText
           [&_del]:text-lightInputIconColor
           dark:[&_del]:text-darkInputIconColor
           prose-h1:text-lightShowTableBodyText
           prose-h2:text-lightShowTableBodyText
           prose-h3:text-lightShowTableBodyText
           prose-ul:text-lightShowTableBodyText
           prose-ol:text-lightShowTableBodyText
           prose-th:text-lightShowTableBodyText
           prose-td:text-lightShowTableBodyText
           prose-strong:text-lightShowTableBodyText
           prose-hr:leading-none
           text-lightShowTableBodyText
           dark:text-darkShowTableBodyText
           prose-p:text-lightShowTableBodyText
           dark:prose-p:text-darkShowTableBodyText
           "
           :class="compactPreviewStyles"
      ></div>
    </div>
    <button
      v-if="isOverflowing || expanded"
      @click="expanded = !expanded"
      type="button"
      class="af-markdown-show-more mt-1 text-sm font-medium text-lightPrimary underline decoration-lightPrimary/30 underline-offset-[3px] hover:decoration-lightPrimary dark:text-darkPrimary dark:decoration-darkPrimary/40 dark:hover:decoration-darkPrimary"
    >
      {{ expanded ? $t('Show less') : $t('Show more') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { marked } from "marked";
import DOMPurify from "dompurify";
  
  const props = defineProps<{ 
    column: any; 
    record: any; 
    meta: {
      pluginInstanceId: string;
      compactShowPreview?: boolean;
      maxShowViewContainerHeightPx?: number;
    }
  }>();

  const compactPreviewStyles = computed(() => {
    if (props.meta.compactShowPreview) {
      return `
        prose-ul:leading-[0.2]
        prose-ol:leading-[0.2]
        prose-li:leading-[1]
        prose-h1:leading-[1]
        prose-h2:leading-[1]
        prose-h3:leading-[1]
        prose-h1:text-[1.2rem]
        prose-h2:text-[1.1rem]
        prose-h3:text-[1rem]
        prose-p:text-sm
        prose-p:leading-[1.5]
        prose-ul:text-sm
        prose-blockquote:my-0
      `
    } else {
      return '';
    }
  });

  const computedMaxHeight = computed(() => {
    if (props.meta.maxShowViewContainerHeightPx) {
      return { maxHeight: `${props.meta.maxShowViewContainerHeightPx}px` };
    }
    return {};
  });

  const contentRef = ref<HTMLElement | null>(null);
  const expanded = ref(false);
  const isOverflowing = ref(false);

  let resizeObserver: ResizeObserver | null = null;

  function checkOverflow() {
    if (!props.meta.maxShowViewContainerHeightPx || !contentRef.value) {
      isOverflowing.value = false;
      return;
    }
    isOverflowing.value = contentRef.value.scrollHeight > props.meta.maxShowViewContainerHeightPx;
  }

  function setupObserver() {
    resizeObserver?.disconnect();
    if (!props.meta.maxShowViewContainerHeightPx || !contentRef.value) return;

    resizeObserver = new ResizeObserver(() => checkOverflow());
    resizeObserver.observe(contentRef.value);
  }

  onMounted(async () => {
    await nextTick();
    checkOverflow();
    setupObserver();
  });

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
  });

  const purifiedHtml = computed(() => {
    if (!props.record[props.column.name]) return '-';
    const html = marked(String(props.record[props.column.name]));
    if (html instanceof Promise) {
      console.error("Async rendering is not supported in this setup.");
      return '';
    }
    return DOMPurify.sanitize(html);
  });

  // Re-check overflow whenever content changes
  watch(purifiedHtml, async () => {
    expanded.value = false;
    await nextTick();
    checkOverflow();
    setupObserver();
  });
  </script>
  