import * as monaco from 'monaco-editor';

function trimTrailingEolSelection(
  m: monaco.editor.ITextModel,
  sel: monaco.Selection,
): monaco.Selection {
  if (!sel.isEmpty() && sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber) {
    const prevLine = sel.endLineNumber - 1;
    const endCol = m.getLineMaxColumn(prevLine); // after last char
    return new monaco.Selection(sel.startLineNumber, sel.startColumn, prevLine, endCol);
  }
  return sel;
}

function rangeFromOffsets(m: monaco.editor.ITextModel, startOffset: number, endOffset: number): monaco.Range {
  const s = m.getPositionAt(startOffset);
  const e = m.getPositionAt(endOffset);
  return new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column);
}

export function toggleWrapSmart(
  ed: monaco.editor.IStandaloneCodeEditor,
  left: string,
  right: string = left,
) {
  let m = ed.getModel();
  if (!m) return;

  const selections = ed.getSelections() || [];
  if (!selections.length) return;

  const leftLen = left.length;
  const rightLen = right.length;

  const indexed = selections.map((s, idx) => ({ s, idx }));

  indexed.sort((a, b) => {
    const ma = ed.getModel();
    if (!ma) return 0;
    const ao = ma.getOffsetAt(a.s.getStartPosition());
    const bo = ma.getOffsetAt(b.s.getStartPosition());
    if (ao !== bo) return bo - ao;
    const ae = ma.getOffsetAt(a.s.getEndPosition());
    const be = ma.getOffsetAt(b.s.getEndPosition());
    return be - ae;
  });

  const nextSelections: Array<monaco.Selection | null> = new Array(selections.length).fill(null);

  const getTextByOffsets = (startOffset: number, endOffset: number) => {
    const mm = ed.getModel();
    if (!mm) return '';
    return mm.getValueInRange(rangeFromOffsets(mm, startOffset, endOffset));
  };

  ed.pushUndoStop();

  for (const item of indexed) {
    m = ed.getModel();
    if (!m) break;

    let sel = item.s;
    sel = trimTrailingEolSelection(m, sel);

    const startPos = sel.getStartPosition();
    const endPos = sel.getEndPosition();
    const startOffset = m.getOffsetAt(startPos);
    const endOffset = m.getOffsetAt(endPos);

    const isEmpty = sel.isEmpty();
    const modelLen = m.getValueLength();

    const hasAdjacentWrap = () => {
      if (startOffset < leftLen) return false;
      if (endOffset + rightLen > modelLen) return false;

      const l = getTextByOffsets(startOffset - leftLen, startOffset);
      const r = getTextByOffsets(endOffset, endOffset + rightLen);
      return l === left && r === right;
    };

    const removeAdjacentWrap = () => {
      const leftRange = rangeFromOffsets(m!, startOffset - leftLen, startOffset);
      const rightRange = rangeFromOffsets(m!, endOffset, endOffset + rightLen);

      ed.executeEdits('md-toggle-wrap', [
        { range: rightRange, text: '', forceMoveMarkers: true },
        { range: leftRange, text: '', forceMoveMarkers: true },
      ]);

      const mm = ed.getModel()!;
      const ns = startOffset - leftLen;
      const ne = endOffset - leftLen;

      const s = mm.getPositionAt(ns);
      const e = mm.getPositionAt(ne);
      nextSelections[item.idx] = new monaco.Selection(s.lineNumber, s.column, e.lineNumber, e.column);
    };

    if (isEmpty) {
      if (startOffset >= leftLen && startOffset + rightLen <= modelLen) {
        const l = getTextByOffsets(startOffset - leftLen, startOffset);
        const r = getTextByOffsets(startOffset, startOffset + rightLen);
        if (l === left && r === right) {
          const leftRange = rangeFromOffsets(m, startOffset - leftLen, startOffset);
          const rightRange = rangeFromOffsets(m, startOffset, startOffset + rightLen);

          ed.executeEdits('md-toggle-wrap', [
            { range: rightRange, text: '', forceMoveMarkers: true },
            { range: leftRange, text: '', forceMoveMarkers: true },
          ]);

          const mm = ed.getModel()!;
          const p = mm.getPositionAt(startOffset - leftLen);
          nextSelections[item.idx] = new monaco.Selection(p.lineNumber, p.column, p.lineNumber, p.column);
          continue;
        }
      }

      const insertRange = rangeFromOffsets(m, startOffset, startOffset);
      ed.executeEdits('md-toggle-wrap', [
        { range: insertRange, text: `${left}${right}`, forceMoveMarkers: true },
      ]);

      const mm = ed.getModel()!;
      const p = mm.getPositionAt(startOffset + leftLen);
      nextSelections[item.idx] = new monaco.Selection(p.lineNumber, p.column, p.lineNumber, p.column);
      continue;
    }

    const selectedText = m.getValueInRange(sel);

    const isExplicitWrapped =
      selectedText.length >= leftLen + rightLen &&
      selectedText.startsWith(left) &&
      selectedText.endsWith(right);

    if (isExplicitWrapped) {
      const unwrapped = selectedText.slice(leftLen, selectedText.length - rightLen);

      ed.executeEdits('md-toggle-wrap', [
        { range: sel, text: unwrapped, forceMoveMarkers: true },
      ]);

      const mm = ed.getModel()!;
      const s = mm.getPositionAt(startOffset);
      const e = mm.getPositionAt(startOffset + unwrapped.length);
      nextSelections[item.idx] = new monaco.Selection(s.lineNumber, s.column, e.lineNumber, e.column);
      continue;
    }

    if (hasAdjacentWrap()) {
      removeAdjacentWrap();
      continue;
    }

    ed.executeEdits('md-toggle-wrap', [
      { range: sel, text: `${left}${selectedText}${right}`, forceMoveMarkers: true },
    ]);

    const mm = ed.getModel()!;
    const ns = startOffset + leftLen;
    const ne = endOffset + leftLen;
    const s = mm.getPositionAt(ns);
    const e = mm.getPositionAt(ne);
    nextSelections[item.idx] = new monaco.Selection(s.lineNumber, s.column, e.lineNumber, e.column);
  }

  ed.pushUndoStop();

  const finalSelections = nextSelections.map((s, i) => s ?? selections[i]);
  ed.setSelections(finalSelections);
}
