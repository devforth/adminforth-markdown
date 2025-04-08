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
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { gfm } from '@milkdown/kit/preset/gfm';
import { commonmark } from '@milkdown/preset-commonmark';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { Crepe } from '@milkdown/crepe';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame-dark.css';

const props = defineProps<{ column: any; record: any }>();
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
      listener.markdownUpdated(() => {
        const markdownContent = crepeInstance.getMarkdown();
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
