import { detectPII } from './detector';
import { TabMapper } from './mapper';
import { getSettings } from './settings';
import type { Detection, RuntimeMessage } from './types';
import { showMaskConfirmation, showToast } from './ui';

const mapper = new TabMapper();
const typingTimers = new WeakMap<HTMLInputElement | HTMLTextAreaElement, number>();
const internalMutationTargets = new WeakSet<HTMLInputElement | HTMLTextAreaElement>();

type InputTarget = HTMLInputElement | HTMLTextAreaElement;

type InsertContext =
  | {
      kind: 'input';
      target: InputTarget;
      start: number;
      end: number;
    }
  | {
      kind: 'contenteditable';
      target: HTMLElement;
      range: Range;
    };

function isEditableElement(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target instanceof HTMLInputElement) {
    return target.type !== 'password' && !target.readOnly && !target.disabled;
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }

  return target.isContentEditable;
}

function getSelectionTextForEditable(target: InputTarget): string {
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  return target.value.slice(start, end);
}

function replaceSelectionInEditable(target: InputTarget, replacement: string): void {
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  target.setRangeText(replacement, start, end, 'end');
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replacement }));
}

function captureInsertContext(target: HTMLInputElement | HTMLTextAreaElement | HTMLElement): InsertContext | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return {
      kind: 'input',
      target,
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0
    };
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  return {
    kind: 'contenteditable',
    target,
    range: selection.getRangeAt(0).cloneRange()
  };
}

function applyInsertContext(context: InsertContext, text: string): void {
  if (context.kind === 'input') {
    context.target.focus();
    context.target.setSelectionRange(context.start, context.end);
    replaceSelectionInEditable(context.target, text);
    return;
  }

  context.target.focus();
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = context.range.cloneRange();
  selection.removeAllRanges();
  selection.addRange(range);

  const inserted = document.execCommand('insertText', false, text);
  if (!inserted) {
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  context.target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function buildAcceptedIdsForAutoMask(detections: Detection[]): Set<string> {
  const accepted = new Set<string>();
  for (const detection of detections) {
    if (detection.confidence === 'high' && detection.type !== 'PERSON_NAME') {
      accepted.add(detection.id);
    }
  }
  return accepted;
}

function applyMaskingWithSelection(
  text: string,
  detections: Detection[],
  acceptedDetectionIds: Set<string>,
  selectionStart: number,
  selectionEnd: number
): { text: string; maskedCount: number; nextSelectionStart: number; nextSelectionEnd: number } {
  let maskedCount = 0;
  let nextStart = selectionStart;
  let nextEnd = selectionEnd;
  let result = text;

  const sorted = [...detections].sort((a, b) => b.start - a.start);

  for (const detection of sorted) {
    if (!acceptedDetectionIds.has(detection.id)) {
      continue;
    }

    const token = mapper.getOrCreateToken(detection.type, detection.text, detection.normalized);
    result = `${result.slice(0, detection.start)}${token}${result.slice(detection.end)}`;

    const originalLength = detection.end - detection.start;
    const delta = token.length - originalLength;

    if (detection.end <= nextStart) {
      nextStart += delta;
    } else if (detection.start < nextStart) {
      nextStart = detection.start + token.length;
    }

    if (detection.end <= nextEnd) {
      nextEnd += delta;
    } else if (detection.start < nextEnd) {
      nextEnd = detection.start + token.length;
    }

    maskedCount += 1;
  }

  return {
    text: result,
    maskedCount,
    nextSelectionStart: Math.max(0, nextStart),
    nextSelectionEnd: Math.max(0, nextEnd)
  };
}

function shouldTriggerTypeMask(event: InputEvent): boolean {
  if (event.isComposing) {
    return false;
  }

  if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
    return true;
  }

  if (event.inputType !== 'insertText') {
    return false;
  }

  const ch = event.data ?? '';
  return /[\s,.;:!?)]/.test(ch);
}

function scheduleAutoMask(target: InputTarget): void {
  const existing = typingTimers.get(target);
  if (typeof existing === 'number') {
    window.clearTimeout(existing);
  }

  const timerId = window.setTimeout(async () => {
    const settings = await getSettings();
    if (!settings.maskOnType) {
      return;
    }

    const currentText = target.value;
    if (!currentText || currentText.length > settings.maxPasteSize) {
      return;
    }

    const detections = detectPII(currentText, settings);
    const accepted = buildAcceptedIdsForAutoMask(detections);
    if (accepted.size === 0) {
      return;
    }

    const selectionStart = target.selectionStart ?? currentText.length;
    const selectionEnd = target.selectionEnd ?? currentText.length;

    const result = applyMaskingWithSelection(currentText, detections, accepted, selectionStart, selectionEnd);
    if (result.maskedCount === 0 || result.text === currentText) {
      return;
    }

    internalMutationTargets.add(target);
    try {
      target.value = result.text;
      target.setSelectionRange(result.nextSelectionStart, result.nextSelectionEnd);
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '' }));
    } finally {
      internalMutationTargets.delete(target);
    }

    showToast(`Auto-masked ${result.maskedCount} item(s) while typing.`);
  }, 220);

  typingTimers.set(target, timerId);
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  if (!isEditableElement(event.target)) {
    return;
  }

  const target = event.target;
  const insertContext = captureInsertContext(target);
  if (!insertContext) {
    return;
  }

  const clipboardText = event.clipboardData?.getData('text/plain');
  if (!clipboardText) {
    return;
  }

  const settings = await getSettings();
  if (clipboardText.length > settings.maxPasteSize) {
    showToast(`Paste skipped: over max size (${settings.maxPasteSize} chars).`);
    return;
  }

  const detections = detectPII(clipboardText, settings);
  if (detections.length === 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const acceptedIds = await showMaskConfirmation(detections);
  if (!acceptedIds) {
    applyInsertContext(insertContext, clipboardText);
    showToast('Paste kept unchanged.');
    return;
  }

  const masked = applyMaskingWithSelection(clipboardText, detections, acceptedIds, clipboardText.length, clipboardText.length);
  applyInsertContext(insertContext, masked.text);
  showToast(`Masked ${masked.maskedCount} item(s).`);
}

async function onInput(event: InputEvent): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (internalMutationTargets.has(target)) {
    return;
  }

  const settings = await getSettings();
  if (!settings.maskOnType) {
    return;
  }

  if (!shouldTriggerTypeMask(event)) {
    return;
  }

  scheduleAutoMask(target);
}

async function handleUnmaskRequest(): Promise<{ success: boolean; restoredCount: number; message: string }> {
  const active = document.activeElement;

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const selectedText = getSelectionTextForEditable(active);
    if (!selectedText) {
      return { success: false, restoredCount: 0, message: 'No selection to unmask.' };
    }

    const result = mapper.unmaskText(selectedText);
    if (result.restoredCount > 0) {
      replaceSelectionInEditable(active, result.text);
      return { success: true, restoredCount: result.restoredCount, message: `Restored ${result.restoredCount} token(s).` };
    }

    return { success: false, restoredCount: 0, message: 'No known tokens found in selection.' };
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString() ?? '';
  if (!selectedText) {
    return { success: false, restoredCount: 0, message: 'No selection to unmask.' };
  }

  const result = mapper.unmaskText(selectedText);
  if (result.restoredCount === 0) {
    return { success: false, restoredCount: 0, message: 'No known tokens found in selection.' };
  }

  try {
    await navigator.clipboard.writeText(result.text);
    return {
      success: true,
      restoredCount: result.restoredCount,
      message: `Restored ${result.restoredCount} token(s) and copied to clipboard.`
    };
  } catch {
    return {
      success: false,
      restoredCount: 0,
      message: 'Unable to write restored text to clipboard.'
    };
  }
}

document.addEventListener(
  'paste',
  (event) => {
    void onPaste(event as ClipboardEvent);
  },
  true
);

document.addEventListener(
  'input',
  (event) => {
    void onInput(event as InputEvent);
  },
  true
);

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type !== 'UNMASK_SELECTION_REQUEST') {
    return;
  }

  void handleUnmaskRequest().then((result) => {
    showToast(result.message);
    sendResponse({
      type: 'UNMASK_SELECTION_RESULT',
      payload: {
        success: result.success,
        restoredCount: result.restoredCount,
        message: result.message
      }
    } satisfies RuntimeMessage);
  });

  return true;
});
