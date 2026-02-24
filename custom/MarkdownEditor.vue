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
import { toggleWrapSmart } from './utils/monacoMarkdownToggle';

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
  turndownService.escape = (s: string) => s;
  return turndownService;
}


let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
const disposables: monaco.IDisposable[] = [];
let removePasteListener: (() => void) | null = null;
let removePasteListenerSecondary: (() => void) | null = null;
let removeGlobalPasteListener: (() => void) | null = null;
let removeGlobalKeydownListener: (() => void) | null = null;
let removeDragOverListener: (() => void) | null = null;
let removeDropListener: (() => void) | null = null;

type MarkdownImageRef = {
  lineNumber: number;
  src: string;
};

let imageViewZoneIds: string[] = [];
let imagePreviewUpdateTimer: number | null = null;

function normalizeMarkdownImageSrc(raw: string): string {
  let src = raw.trim();
  if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1).trim();
  return src;
}

function findImagesInModel(textModel: monaco.editor.ITextModel): MarkdownImageRef[] {
  const images: MarkdownImageRef[] = [];
  const lineCount = textModel.getLineCount();

  // Minimal image syntax: ![alt](src) or ![alt](src "title")
  // This intentionally keeps parsing simple and line-based.
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
    const line = textModel.getLineContent(lineNumber);
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    // Allow multiple images on the same line.
    while ((match = re.exec(line))) {
      const src = normalizeMarkdownImageSrc(match[1] ?? '');
      if (!src) continue;
      images.push({ lineNumber, src });
    }
  }

  return images;
}

function clearImagePreviews() {
  if (!editor) return;
  if (!imageViewZoneIds.length) return;

  editor.changeViewZones((accessor) => {
    for (const zoneId of imageViewZoneIds) accessor.removeZone(zoneId);
  });
  imageViewZoneIds = [];
}

function updateImagePreviews() {
  if (!editor || !model) return;
  const images = findImagesInModel(model);

  clearImagePreviews();

  // View zones reserve vertical space and thus shift lines down.
  // We keep the implementation minimal: one zone per image ref.
  editor.changeViewZones((accessor) => {
    const newZoneIds: string[] = [];

    images.forEach((img) => {
      const wrapper = document.createElement('div');
      wrapper.style.padding = '6px 0';
      wrapper.style.pointerEvents = 'none';

      const preview = document.createElement('div');
      preview.style.display = 'inline-block';
      preview.style.borderRadius = '6px';
      preview.style.overflow = 'hidden';
      preview.style.maxWidth = '440px';
      preview.style.maxHeight = '280px';


      const imageEl = document.createElement('img');
      imageEl.src = img.src;
      imageEl.style.maxWidth = '440px';
      imageEl.style.maxHeight = '280px';
      imageEl.style.display = 'block';
      imageEl.style.opacity = '0.95';

      preview.appendChild(imageEl);
      wrapper.appendChild(preview);

      const zone: monaco.editor.IViewZone = {
        afterLineNumber: img.lineNumber,
        heightInPx: 320,
        domNode: wrapper,
      };

      const zoneId = accessor.addZone(zone);
      newZoneIds.push(zoneId);

      // Once image loads, adjust zone height to the rendered node.
      imageEl.onload = () => {
        if (!editor) return;
        const measured = wrapper.offsetHeight;
        const nextHeight = Math.max(60, Math.min(520, measured || 320));
        if (zone.heightInPx !== nextHeight) {
          zone.heightInPx = nextHeight;
          editor.changeViewZones((a) => a.layoutZone(zoneId));
        }
      };

      imageEl.onerror = () => {
        // Keep the zone small if the image can't be loaded.
        if (!editor) return;
        zone.heightInPx = 40;
        editor.changeViewZones((a) => a.layoutZone(zoneId));
      };
    });

    imageViewZoneIds = newZoneIds;
  });
}

function scheduleImagePreviewUpdate() {
  if (imagePreviewUpdateTimer !== null) {
    window.clearTimeout(imagePreviewUpdateTimer);
  }
  imagePreviewUpdateTimer = window.setTimeout(() => {
    imagePreviewUpdateTimer = null;
    updateImagePreviews();
  }, 120);
}

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

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[\[\]\\]/g, '\\$&');
}

function showAdminforthError(message: string) {
  const api = (window as any).adminforth;
  if (api && typeof api.alert === 'function') {
    api.alert({
      message,
      variant: 'danger',
      timeout: 30,
    });
    return;
  }
  console.error('[adminforth-markdown]', message);
}

function extractErrorMessage(error: any): string {
  if (!error) return 'Upload failed';
  if (typeof error === 'string') return error;
  if (typeof error?.error === 'string') return error.error;
  if (typeof error?.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Upload failed';
  }
}

function markdownForUploadedFile(file: File, url: string): string {
  if (file.type?.startsWith('image/')) {
    return `![](${url})`;
  }

  if (file.type?.startsWith('video/')) {
    const mediaType = file.type || 'video/mp4';
    return `<figure>\n  <!-- For gif-like videos use: <video width="500" autoplay loop muted playsinline> -->\n  <video width="500" controls>\n    <source src="${url}" type="${mediaType}">\n  </video>\n  <figcaption>Demo</figcaption>\n</figure>`;
  }

  // alert that file cant be uploaded
  showAdminforthError(`Uploaded file "${file.name}" is not an image or video and cannot be embedded. It has been uploaded and can be accessed at: ${url}`);
}

async function uploadFileAndGetMarkdownTag(file: File): Promise<string | undefined> {
  try {
    const url = await uploadFileToS3(file);
    if (!url) return;
    return markdownForUploadedFile(file, url);
  } catch (error) {
    const message = extractErrorMessage(error);
    showAdminforthError(message);
    console.error('[adminforth-markdown] upload failed', error);
    return;
  }
}
function getSelectedPlainText(): string {
  if (!editor || !model) return '';

  const sels = editor.getSelections() || [];
  if (!sels.length) return '';
  return sels
    .map((sel) => model!.getValueInRange(sel))
    .join('\n');
}

const onEditorCopy = (e: ClipboardEvent) => {
  if (!editor || !model) return;
  if (!e.clipboardData) return;

  if (!(editor.hasTextFocus?.() || isFocused.value)) return;

  const text = getSelectedPlainText();
  if (!text) return;

  e.clipboardData.setData('text/plain', text);
  e.clipboardData.setData('text/html', '');
  e.preventDefault();
  e.stopPropagation();
};

const onEditorCut = (e: ClipboardEvent) => {
  if (!editor || !model) return;
  if (!e.clipboardData) return;
  if (!(editor.hasTextFocus?.() || isFocused.value)) return;

  const text = getSelectedPlainText();
  if (!text) return;

  e.clipboardData.setData('text/plain', text);
  e.clipboardData.setData('text/html', '');
  e.preventDefault();
  e.stopPropagation();

  const sels = editor.getSelections() || [];
  editor.executeEdits(
    'cut',
    sels.map((range) => ({ range, text: '' })),
  );
};

onMounted(async () => {
  if (!editorContainer.value) return;
  try {
    monaco.editor.setTheme(isDarkMode() ? 'vs-dark' : 'vs');

    model = monaco.editor.createModel(content.value, 'markdown');
    editor = monaco.editor.create(editorContainer.value, {
      model,
      language: 'markdown',
      automaticLayout: true,
      wordWrap: 'on',
      wrappingStrategy: 'advanced',
      wrappingIndent: 'same',
      scrollbar: {
        horizontal: 'hidden',
      },
      scrollBeyondLastColumn: 0,
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => {
      toggleWrapSmart(editor!, '**');
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
      toggleWrapSmart(editor!, '*');
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, () => {
      toggleWrapSmart(editor!, '`');
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyX, () => {
      toggleWrapSmart(editor!, '~~');
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU, () => {
      toggleWrapSmart(editor!, '<u>', '</u>');
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      const selection = editor!.getSelection();
      if (!selection) return;
      const text = model?.getValueInRange(selection) || '';
      const escaped = escapeMarkdownLinkText(text);
      const markdownLink = `[${escaped}](url)`;
      editor!.executeEdits('insert-link', [{ range: selection, text: markdownLink, forceMoveMarkers: true }]);
    });

    debug('Monaco editor created', {
      hasUploadPluginInstanceId: Boolean(props.meta?.uploadPluginInstanceId),
    });

    disposables.push(
      editor.onDidChangeModelContent(() => {
        const markdown = model?.getValue() ?? '';
        content.value = markdown;
        emit('update:value', markdown);

        // Keep image previews in sync with markdown edits.
        scheduleImagePreviewUpdate();
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

      const onDragOver = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      };

      const onDrop = async (e: DragEvent) => {
        const dt = e.dataTransfer;
        if (!dt) return;
        if (!dt.files || !dt.files.length) return;

        e.preventDefault();
        e.stopPropagation();

        if (!editor) return;
        editor.focus();

        const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
        const dropPosition = target?.position || target?.range?.getStartPosition?.();
        if (dropPosition) {
          editor.setPosition(dropPosition);
          editor.setSelection(new monaco.Selection(
            dropPosition.lineNumber,
            dropPosition.column,
            dropPosition.lineNumber,
            dropPosition.column,
          ));
        }

        if (!props.meta?.uploadPluginInstanceId) {
          const msg = 'uploadPluginInstanceId is missing; cannot upload dropped file.';
          showAdminforthError(msg);
          console.error('[adminforth-markdown]', msg);
          return;
        }

        const markdownTags: string[] = [];
        for (const file of Array.from(dt.files)) {
          const tag = await uploadFileAndGetMarkdownTag(file);
          if (tag) markdownTags.push(tag);
        }

        if (markdownTags.length) {
          insertAtCursor(`${markdownTags.join('\n\n')}\n`);
        }
      };
      domNode.addEventListener('copy', onEditorCopy, true);
      domNode.addEventListener('cut', onEditorCut, true);
      domNode.addEventListener('dragover', onDragOver, true);
      domNode.addEventListener('drop', onDrop, true);
      removeDragOverListener = () => domNode.removeEventListener('dragover', onDragOver, true);
      removeDropListener = () => domNode.removeEventListener('drop', onDrop, true);
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
          const tag = await uploadFileAndGetMarkdownTag(file);
          if (!tag) continue;
          markdownTags.push(tag);
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

    // Initial render of previews.
    scheduleImagePreviewUpdate();
  } catch (error) {
    console.error('Failed to initialize editor:', error);
  }
});

async function uploadFileToS3(file: File): Promise<string | undefined> {
  if (!file || !file.name) {
    console.error('File or file name is undefined');
    return;
  }

  const originalFilename = file.name.split('.').slice(0, -1).join('.') + `_${Date.now()}`;
  const originalExtension = file.name.split('.').pop();

  const { uploadUrl, tagline, previewUrl, error } = await callAdminForthApi({
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
    const message = extractErrorMessage(error);
    if (/too\s*large|max\s*file\s*size|size\s*limit|limit\s*reached|exceed/i.test(message)) {
      showAdminforthError(message);
    } else {
      showAdminforthError(message);
    }
    throw new Error(message);
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
        const message = `Error uploading to S3 (status ${xhr.status})`;
        showAdminforthError(message);
        reject(message);
      }
    };

    xhr.onerror = () => {
      const message = 'Error uploading to S3';
      showAdminforthError(message);
      reject(message);
    };
  });
}

onBeforeUnmount(() => {
  if (imagePreviewUpdateTimer !== null) {
    window.clearTimeout(imagePreviewUpdateTimer);
    imagePreviewUpdateTimer = null;
  }

  clearImagePreviews();

  removePasteListener?.();
  removePasteListener = null;

  removePasteListenerSecondary?.();
  removePasteListenerSecondary = null;

  removeGlobalPasteListener?.();
  removeGlobalPasteListener = null;

  removeGlobalKeydownListener?.();
  removeGlobalKeydownListener = null;

  removeDragOverListener?.();
  removeDragOverListener = null;

  removeDropListener?.();
  removeDropListener = null;

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
