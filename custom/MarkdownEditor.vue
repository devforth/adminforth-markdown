<template>
  <div class="mb-2"></div>
  <div
    ref="editorContainer"
    id="editor"
    :class="[
      'text-sm rounded-lg block w-full transition-all box-border overflow-hidden',
      isFocused
        ? 'ring-1 ring-lightPrimary border ring-lightPrimary border-lightPrimary dark:ring-darkPrimary dark:border-darkPrimary'
        : 'border border-gray-300 dark:border-gray-600',
    ]"
  ></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { callAdminForthApi } from '@/utils';
import * as monaco from 'monaco-editor';
import TurndownService from 'turndown';
import { gfm, tables } from 'turndown-plugin-gfm';

const props = defineProps<{
  column: any,
  record: any,
  meta: any,
}>()

const emit = defineEmits(['update:value']);
const editorContainer = ref<HTMLElement | null>(null);
const content = ref(String(props.record?.[props.column.name] ?? ''));

const isFocused = ref(false);

const debug = (...args: any[]) => console.warn('[adminforth-markdown]', ...args);
debug('MarkdownEditor module loaded');

let turndownService: TurndownService | null = null;

function normalizeTableCellText(text: string): string {
  let value = text;
  value = value.replace(/\u00a0/g, ' ');
  value = value.replace(/\r\n/g, '\n');
  value = value.replace(/\r/g, '\n');
  value = value.trim();
  value = value.replace(/\n+/g, '<br>');
  value = value.replace(/\|/g, '\\|');
  return value;
}

function extractRowCells(row: HTMLTableRowElement): string[] {
  const cells: string[] = [];
  const rowCells = Array.from(row.cells);
  for (const cell of rowCells) {
    const text = cell.textContent ? cell.textContent : '';
    cells.push(normalizeTableCellText(text));
    const span = (cell as HTMLTableCellElement).colSpan;
    if (span && span > 1) {
      for (let i = 1; i < span; i += 1) cells.push('');
    }
  }
  return cells;
}

function padRow(cells: string[], columnCount: number): string[] {
  if (cells.length >= columnCount) return cells;
  const out = cells.slice();
  while (out.length < columnCount) out.push('');
  return out;
}

function markdownTableLine(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function htmlTableToMarkdown(table: HTMLTableElement): string {
  const thead = table.tHead;
  let headerRow: HTMLTableRowElement | null = null;
  if (thead && thead.rows && thead.rows.length) headerRow = thead.rows[0];

  const bodyRows: HTMLTableRowElement[] = [];
  const bodies = Array.from(table.tBodies);
  for (const body of bodies) {
    bodyRows.push(...Array.from(body.rows));
  }

  // If no <tbody>, fall back to all rows not in <thead>.
  if (!bodyRows.length) {
    const allRows = Array.from(table.rows);
    for (const row of allRows) {
      if (thead && thead.contains(row)) continue;
      bodyRows.push(row);
    }
  }

  // If no explicit <thead>, treat the first row as the header.
  if (!headerRow) {
    if (bodyRows.length) {
      headerRow = bodyRows.shift() || null;
    } else {
      const allRows = Array.from(table.rows);
      if (allRows.length) headerRow = allRows[0];
    }
  }

  if (!headerRow) return '';

  const headerCells = extractRowCells(headerRow);
  const dataCells = bodyRows.map(extractRowCells);

  let columnCount = headerCells.length;
  for (const row of dataCells) {
    if (row.length > columnCount) columnCount = row.length;
  }
  if (columnCount < 1) columnCount = 1;

  const header = padRow(headerCells, columnCount);
  const separator: string[] = [];
  for (let i = 0; i < columnCount; i += 1) separator.push(':---');

  const lines: string[] = [];
  lines.push(markdownTableLine(header));
  lines.push(markdownTableLine(separator));
  for (const row of dataCells) {
    lines.push(markdownTableLine(padRow(row, columnCount)));
  }

  return `\n\n${lines.join('\n')}\n\n`;
}

function stripOneTrailingNewline(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  if (text.endsWith('\r')) return text.slice(0, -1);
  return text;
}

function escapeMarkdownLinkTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fenceForCodeBlock(text: string): string {
  let maxBackticks = 0;
  let current = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '`') {
      current += 1;
      if (current > maxBackticks) maxBackticks = current;
    } else {
      current = 0;
    }
  }

  let fenceLen = maxBackticks + 1;
  if (fenceLen < 3) fenceLen = 3;
  return '`'.repeat(fenceLen);
}

function getTurndownService(): TurndownService {
  if (turndownService) return turndownService;
  turndownService = new TurndownService();
  // Enable GitHub Flavored Markdown features like tables.
  (turndownService as any).use(gfm);
  (turndownService as any).use(tables);

  // Convert <pre> without nested <code> into fenced code blocks.
  turndownService.addRule('pre-fenced-code', {
    filter(node) {
      if (!node) return false;
      if (node.nodeName !== 'PRE') return false;
      const el = node as HTMLElement;
      return el.querySelector('code') === null;
    },
    replacement(_content, node) {
      const el = node as HTMLElement;
      const raw = el.textContent ? el.textContent : '';
      const code = stripOneTrailingNewline(raw);
      const fence = fenceForCodeBlock(code);
      return `\n\n${fence}\n${code}\n${fence}\n\n`;
    },
  });

  // Custom table conversion: emit classic Markdown tables with a header separator.
  // This rule is added last, so it takes precedence over plugin table handling.
  turndownService.addRule('table-classic-markdown', {
    filter(node) {
      return Boolean(node && node.nodeName === 'TABLE');
    },
    replacement(_content, node) {
      const table = node as HTMLTableElement;
      return htmlTableToMarkdown(table);
    },
  });

  turndownService.addRule('image-with-title', {
    filter(node) {
      return Boolean(node && node.nodeName === 'IMG');
    },
    replacement(_content, node) {
      const img = node as HTMLImageElement;

      const srcAttr = img.getAttribute('src');
      const src = srcAttr ? srcAttr.trim() : '';
      if (!src) return '';

      const altAttr = img.getAttribute('alt');
      const titleAttr = img.getAttribute('title');

      const alt = altAttr ? altAttr.trim() : '';
      const title = titleAttr ? titleAttr.trim() : '';

      let altFinal = '';
      let titleFinal = '';

      if (alt && title) {
        altFinal = alt;
        titleFinal = title;
      } else if (alt && !title) {
        altFinal = alt;
        titleFinal = alt;
      } else if (!alt && title) {
        altFinal = title;
        titleFinal = title;
      } else {
        return `![](${src})`;
      }

      const escapedTitle = escapeMarkdownLinkTitle(titleFinal);
      return `![${altFinal}](${src} "${escapedTitle}")`;
    },
  });

  return turndownService;
}

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
const disposables: monaco.IDisposable[] = [];
let removePasteListener: (() => void) | null = null;
let removePasteListenerSecondary: (() => void) | null = null;
let removeGlobalPasteListener: (() => void) | null = null;
let removeGlobalKeydownListener: (() => void) | null = null;

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

function insertAtCursor(text: string) {
  if (!editor) return;
  const selection = editor.getSelection();
  if (selection) {
    editor.executeEdits('insert', [{ range: selection, text, forceMoveMarkers: true }]);
    return;
  }
  const position = editor.getPosition();
  if (!position) return;
  const range = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
  editor.executeEdits('insert', [{ range, text, forceMoveMarkers: true }]);
}

function fileFromClipboardImage(blob: Blob): File {
  const type = blob.type || 'image/png';
  const ext = type.split('/')[1] || 'png';
  const filename = `pasted-image-${Date.now()}.${ext}`;
  return new File([blob], filename, { type });
}

onMounted(async () => {
  if (!editorContainer.value) return;
  try {
    monaco.editor.setTheme(isDarkMode() ? 'vs-dark' : 'vs');

    model = monaco.editor.createModel(content.value, 'markdown');
    editor = monaco.editor.create(editorContainer.value, {
      model,
      language: 'markdown',
      automaticLayout: true,
    });

    debug('Monaco editor created', {
      hasUploadPluginInstanceId: Boolean(props.meta?.uploadPluginInstanceId),
    });

    disposables.push(
      editor.onDidChangeModelContent(() => {
        const markdown = model?.getValue() ?? '';
        content.value = markdown;
        emit('update:value', markdown);
      }),
    );

    disposables.push(
      editor.onDidFocusEditorText(() => {
        isFocused.value = true;
      }),
    );
    disposables.push(
      editor.onDidBlurEditorText(() => {
        isFocused.value = false;
      }),
    );

    const domNode = editor.getDomNode();
    // NOTE: Monaco may stop propagation at document-level capture, so editor DOM listeners
    // may never fire. We'll still attach them, but the real handling is done in the
    // global (document capture) paste listener below.
    if (domNode) {
      const noopPaste = () => {};
      domNode.addEventListener('paste', noopPaste, true);
      removePasteListener = () => domNode.removeEventListener('paste', noopPaste, true);
    }
    if (editorContainer.value) {
      const noopPaste = () => {};
      editorContainer.value.addEventListener('paste', noopPaste, true);
      removePasteListenerSecondary = () => editorContainer.value?.removeEventListener('paste', noopPaste, true);
    }

    // Global listeners for diagnostics: if these don't fire,
    // the component isn't running or logs are being stripped.
    const onGlobalPaste = async (e: ClipboardEvent) => {
      if ((e as any).__adminforthMarkdownHandled) return;
      (e as any).__adminforthMarkdownHandled = true;

      const targetEl = e.target as HTMLElement | null;
      const dt = e.clipboardData;
      debug('GLOBAL paste', {
        target: targetEl?.tagName,
        hasClipboardData: Boolean(dt),
        types: dt ? Array.from(dt.types) : [],
        items: dt ? dt.items.length : 0,
        files: dt ? dt.files.length : 0,
        editorHasTextFocus: Boolean(editor?.hasTextFocus?.()),
      });

      if (!editor || !domNode) return;
      if (!targetEl || !domNode.contains(targetEl)) return;
      if (!(editor.hasTextFocus?.() || isFocused.value)) return;
      if (!dt) return;

      const imageBlobs: Blob[] = [];

      for (const item of Array.from(dt.items)) {
        debug('clipboard item', { kind: item.kind, type: item.type });
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) imageBlobs.push(blob);
        }
      }

      if (!imageBlobs.length && dt.files?.length) {
        for (const file of Array.from(dt.files)) {
          debug('clipboard file', { name: file.name, type: file.type, size: file.size });
          if (file.type?.startsWith('image/')) {
            imageBlobs.push(file);
          }
        }
      }

      if (imageBlobs.length) {
        if (!props.meta?.uploadPluginInstanceId) {
          console.error('[adminforth-markdown] uploadPluginInstanceId is missing; cannot upload pasted image.');
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        editor.focus();
        debug('uploading pasted images', { count: imageBlobs.length });

        const markdownTags: string[] = [];
        for (const blob of imageBlobs) {
          const file = blob instanceof File ? blob : fileFromClipboardImage(blob);
          try {
            const url = await uploadFileToS3(file);
            debug('upload result', { url });
            if (typeof url === 'string' && url.length) {
              markdownTags.push(`![](${url})`);
            }
          } catch (err) {
            console.error('[adminforth-markdown] upload failed', err);
          }
        }

        if (markdownTags.length) {
          insertAtCursor(`${markdownTags.join('\n')}\n`);
        }
        return;
      }

      const html = dt.getData('text/html');
      if (html && html.trim()) {
        e.preventDefault();
        e.stopPropagation();

        editor.focus();
        try {
          const markdown = getTurndownService().turndown(html);
          if (markdown && markdown.trim()) {
            insertAtCursor(markdown);
          } else {
            const text = dt.getData('text/plain');
            if (text) insertAtCursor(text);
          }
        } catch (err) {
          console.error('[adminforth-markdown] failed to convert HTML clipboard to markdown', err);
          const text = dt.getData('text/plain');
          if (text) insertAtCursor(text);
        }
      }
    };

    // Use document capture only (avoid duplicates).
    document.addEventListener('paste', onGlobalPaste, true);
    removeGlobalPasteListener = () => {
      document.removeEventListener('paste', onGlobalPaste, true);
    };

    const onGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        debug('GLOBAL keydown Ctrl+V', {
          target: (e.target as HTMLElement | null)?.tagName,
          editorHasTextFocus: Boolean(editor?.hasTextFocus?.()),
        });
      }
    };
    document.addEventListener('keydown', onGlobalKeydown, true);
    removeGlobalKeydownListener = () => {
      document.removeEventListener('keydown', onGlobalKeydown, true);
    };
  } catch (error) {
    console.error('Failed to initialize editor:', error);
  }
});

async function uploadFileToS3(file: File): Promise<string | undefined> {
  if (!file || !file.name) {
    console.error('File or file name is undefined');
    return;
  }

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

  return new Promise<string>((resolve, reject) => {
    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(previewUrl as string);
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
  removePasteListener?.();
  removePasteListener = null;

  removePasteListenerSecondary?.();
  removePasteListenerSecondary = null;

  removeGlobalPasteListener?.();
  removeGlobalPasteListener = null;

  removeGlobalKeydownListener?.();
  removeGlobalKeydownListener = null;

  for (const d of disposables) d.dispose();
  disposables.length = 0;

  editor?.dispose();
  editor = null;
  model?.dispose();
  model = null;
});
</script>

<style lang="scss">

#editor {
  min-height: 20rem;
  height: 42rem;
}

</style>
