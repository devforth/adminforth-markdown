<script setup lang="ts">
import { markRaw } from 'vue';
import * as monaco from 'monaco-editor';
import { toggleWrapSmart } from './utils/monacoMarkdownToggle';

import { 
  IconLinkOutline, IconCodeOutline, IconRectangleListOutline, 
  IconOrderedListOutline, IconLetterBoldOutline, IconLetterUnderlineOutline, 
  IconLetterItalicOutline, IconTextSlashOutline 
} from '@iconify-prerendered/vue-flowbite';
import { IconH116Solid, IconH216Solid, IconH316Solid } from '@iconify-prerendered/vue-heroicons';

const props = defineProps<{
  editor: monaco.editor.IStandaloneCodeEditor | null;
  meta: any;
}>();

const isBtnVisible = (btnKey: string) => {
  const settings = props.meta?.topPanelSettings;
  if (!settings || Object.keys(settings).length === 0) return true;
  return settings[btnKey] !== undefined ? settings[btnKey] : true;
};

const btnClass = 'flex items-center justify-center h-8 px-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors duration-200';

const fenceForCodeBlock = (text: string): string => {
  let maxBackticks = 0;
  let current = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') { current++; if (current > maxBackticks) maxBackticks = current; }
    else { current = 0; }
  }
  return '`'.repeat(Math.max(3, maxBackticks + 1));
};

const applyFormat = (type: string) => {
  const editor = props.editor;
  if (!editor) return;
  
  const model = editor.getModel();
  if (!model) return;

  editor.focus();
  const rawSelection = editor.getSelection();
  if (!rawSelection) return;

  const selection = rawSelection.startLineNumber !== rawSelection.endLineNumber && rawSelection.endColumn === 1 
    ? new monaco.Selection(rawSelection.startLineNumber, rawSelection.startColumn, rawSelection.endLineNumber - 1, model.getLineMaxColumn(rawSelection.endLineNumber - 1)) 
    : rawSelection;

  const selectedText = model.getValueInRange(selection);

  const applyEdits = (id: string, edits: monaco.editor.IIdentifiedSingleEditOperation[]) => {
    editor.executeEdits(id, edits);
  };

  switch (type) {
    case 'bold':      toggleWrapSmart(editor, '**'); break;
    case 'italic':    toggleWrapSmart(editor, '*'); break;
    case 'strike':    toggleWrapSmart(editor, '~~'); break;
    case 'underline': toggleWrapSmart(editor, '<u>', '</u>'); break;
    case 'codeBlock': {
      const trimmed = selectedText.trim();
      const match = trimmed.match(/^(`{3,})[^\n]*\n([\s\S]*)\n\1$/);
      if (match) {
        applyEdits('unwrap-code', [{ range: selection, text: match[2], forceMoveMarkers: true }]);
      } else {
        const fence = fenceForCodeBlock(selectedText);
        applyEdits('wrap-code', [{ range: selection, text: `\n${fence}\n${selectedText}\n${fence}\n`, forceMoveMarkers: true }]);
      }
      break;
    }
    case 'link': {
      const match = selectedText.trim().match(/^\[(.*?)\]\(.*?\)$/);
      if (match) {
        applyEdits('unlink', [{ range: selection, text: match[1], forceMoveMarkers: true }]);
      } else {
        applyEdits('insert-link', [{ range: selection, text: `[${selectedText}](url)`, forceMoveMarkers: true }]);
      }
      break;
    }
    case 'h1': case 'h2': case 'h3': case 'ul': case 'ol': {
      const prefixMap: any = { h1: '# ', h2: '## ', h3: '### ', ul: '* ' };
      const edits: any[] = [];
      for (let i = selection.startLineNumber; i <= selection.endLineNumber; i++) {
        const line = model.getLineContent(i);
        const targetPrefix = type === 'ol' ? `${i - selection.startLineNumber + 1}. ` : prefixMap[type];
        const match = line.match(/^(#{1,6}\s+|[*+-]\s+|\d+[.)]\s+)/);
        if (match) {
          edits.push({ range: new monaco.Range(i, 1, i, match[0].length + 1), text: match[0].trim() === targetPrefix.trim() ? '' : targetPrefix });
        } else {
          edits.push({ range: new monaco.Range(i, 1, i, 1), text: targetPrefix });
        }
      }
      applyEdits('format-block', edits);
      break;
    }
  }
};

const buttons = [
  { id: 'bold', title: 'Bold', icon: markRaw(IconLetterBoldOutline), group: 1 },
  { id: 'italic', title: 'Italic', icon: markRaw(IconLetterItalicOutline), group: 1 },
  { id: 'underline', title: 'Underline', icon: markRaw(IconLetterUnderlineOutline), group: 1 },
  { id: 'strike', title: 'Strike', icon: markRaw(IconTextSlashOutline), group: 1, separator: true },
  { id: 'h1', title: 'H1', icon: markRaw(IconH116Solid), group: 2 },
  { id: 'h2', title: 'H2', icon: markRaw(IconH216Solid), group: 2 },
  { id: 'h3', title: 'H3', icon: markRaw(IconH316Solid), group: 2, separator: true },
  { id: 'ul', title: 'UL', icon: markRaw(IconRectangleListOutline), group: 3 },
  { id: 'ol', title: 'OL', icon: markRaw(IconOrderedListOutline), group: 3 },
  { id: 'link', title: 'Link', icon: markRaw(IconLinkOutline), group: 3 },
  { id: 'codeBlock', title: 'Code', icon: markRaw(IconCodeOutline), group: 3 },
];
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 p-1.5 border border-gray-300 dark:border-gray-600 rounded-t-lg bg-gray-50 dark:bg-gray-800 w-full box-border">
    <template v-for="btn in buttons" :key="btn.id">
      <button 
        v-if="isBtnVisible(btn.id)" 
        type="button" 
        @click="applyFormat(btn.id)" 
        :class="btnClass" 
        :title="btn.title"
      >
        <component :is="btn.icon" class="w-5 h-5" />
      </button>
      <div v-if="btn.separator && isBtnVisible(btn.id)" class="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1"></div>
    </template>
  </div>
</template>