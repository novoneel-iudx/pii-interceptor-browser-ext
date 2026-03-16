import { detectPII, resolveOverlaps } from './detector'
import { TabMapper } from './mapper'
import { getSettings } from './settings'
import { analyzeNearCursor } from './analyzer'
import { buildSuggestions } from './suggestionEngine'
import { showSuggestion, hideSuggestion } from './suggestionUI'
import type { Detection, NerEntity, RuntimeMessage, Suggestion } from './types'
import { showMaskConfirmation, showToast } from './ui'

const mapper = new TabMapper()

const typingTimers = new WeakMap<HTMLInputElement | HTMLTextAreaElement, number>()
const internalMutationTargets = new WeakSet<HTMLInputElement | HTMLTextAreaElement>()

type InputTarget = HTMLInputElement | HTMLTextAreaElement

type InsertContext =
  | { kind: 'input'; target: InputTarget; start: number; end: number }
  | { kind: 'contenteditable'; target: HTMLElement; range: Range }

type SavedSelection =
  | { kind: 'input'; target: InputTarget; start: number; end: number }
  | { kind: 'contenteditable'; range: Range | null }

let savedHoverSelection: SavedSelection | null = null

/* -------------------------------------------------
   Hybrid detection (Regex + local NER)
-------------------------------------------------- */

function isChatGptHost(): boolean {
  const host = window.location.host
  return host === 'chat.openai.com' || host === 'chatgpt.com'
}

function mapNerEntityGroupToPiiType(group: string): Detection['type'] | null {
  const g = String(group).toUpperCase()
  switch (g) {
    case 'PER':
      return 'PERSON_NAME'
    case 'ORG':
      return 'ORG'
    case 'LOC':
      return 'LOCATION'
    default:
      break
  }

  if (g === 'PERSON' || g === 'PERS' || g === 'I-PER' || g === 'B-PER') return 'PERSON_NAME'
  if (g === 'I-ORG' || g === 'B-ORG') return 'ORG'
  if (g === 'I-LOC' || g === 'B-LOC') return 'LOCATION'

  // Many common NER models do not output an ADDRESS class. Keep this mapping for
  // custom models that do, and allow some common address-like tags.
  if (g === 'ADDRESS' || g === 'I-ADDRESS' || g === 'B-ADDRESS') return 'ADDRESS'

  return null
}

function confidenceFromScore(score: number): Detection['confidence'] {
  if (score >= 0.9) return 'high'
  if (score >= 0.75) return 'medium'
  return 'low'
}

async function runNerLocal(text: string): Promise<NerEntity[]> {
  return await new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        type: 'NER_REQUEST',
        payload: { text }
      } satisfies RuntimeMessage,
      (response: RuntimeMessage | undefined) => {
        if (!response || response.type !== 'NER_RESPONSE') {
          resolve([])
          return
        }
        resolve(response.payload?.entities ?? [])
      }
    )
  })
}

async function detectPIIHybrid(text: string, settings: Awaited<ReturnType<typeof getSettings>>): Promise<Detection[]> {
  const regexDetections = detectPII(text, settings)

  const entities = await runNerLocal(text)

  const nerDetections: Detection[] = []
  let idx = 0
  for (const e of entities) {
    if (typeof e.score !== 'number' || e.score < settings.nerMinConfidence) continue

    const mappedType = mapNerEntityGroupToPiiType(String(e.entity_group))
    if (!mappedType) continue
    if (!settings.enabledTypes[mappedType]) continue

    const start = Math.max(0, Number(e.start) || 0)
    const end = Math.max(start, Number(e.end) || start)
    if (end <= start || start >= text.length) continue

    const clampedEnd = Math.min(text.length, end)
    const slice = text.slice(start, clampedEnd)
    if (!slice.trim()) continue

    const trimmed = slice.trim()
    if (/^PII_[a-z_]+_\d+$/.test(trimmed) || /^\{\{PII_[A-Z_]+_\d+\}\}$/.test(trimmed)) {
      continue
    }

    nerDetections.push({
      id: `NER_${idx++}`,
      type: mappedType,
      start,
      end: clampedEnd,
      text: slice,
      normalized: slice.trim().replace(/\s+/g, ' '),
      confidence: confidenceFromScore(e.score)
    })
  }

  return resolveOverlaps([...regexDetections, ...nerDetections])
}

/* -------------------------------------------------
   Helpers
-------------------------------------------------- */

function isEditableElement(
  target: EventTarget | null
): target is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!(target instanceof HTMLElement)) return false

  if (target instanceof HTMLInputElement) {
    return target.type !== 'password' && !target.readOnly && !target.disabled
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled
  }

  return target.isContentEditable
}

function resolveEditableHost(
  target: EventTarget | null
): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return isEditableElement(target) ? target : null
  }

  if (target.isContentEditable) return target

  const parent = target.closest('[contenteditable="true"]') as HTMLElement | null
  return parent && parent.isContentEditable ? parent : null
}

function getEditableText(target: HTMLElement): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value
  }

  if (target.isContentEditable) {
    return target.innerText || ''
  }

  return ''
}

function getSelectionTextForEditable(target: InputTarget): string {
  const start = target.selectionStart ?? 0
  const end = target.selectionEnd ?? 0
  return target.value.slice(start, end)
}

function replaceSelectionInEditable(target: InputTarget, replacement: string): void {
  const start = target.selectionStart ?? 0
  const end = target.selectionEnd ?? 0

  target.setRangeText(replacement, start, end, 'end')

  target.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: replacement
    })
  )
}

function captureInsertContext(
  target: HTMLInputElement | HTMLTextAreaElement | HTMLElement
): InsertContext | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return {
      kind: 'input',
      target,
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0
    }
  }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  return {
    kind: 'contenteditable',
    target,
    range: selection.getRangeAt(0).cloneRange()
  }
}

function applyInsertContext(context: InsertContext, text: string): void {
  if (context.kind === 'input') {
    context.target.focus()
    context.target.setSelectionRange(context.start, context.end)
    replaceSelectionInEditable(context.target, text)
    return
  }

  context.target.focus()

  const selection = window.getSelection()
  if (!selection) return

  const range = context.range.cloneRange()

  selection.removeAllRanges()
  selection.addRange(range)

  const inserted = document.execCommand('insertText', false, text)

  if (!inserted) {
    range.deleteContents()

    const node = document.createTextNode(text)
    range.insertNode(node)

    range.setStartAfter(node)
    range.collapse(true)

    selection.removeAllRanges()
    selection.addRange(range)
  }

  context.target.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    })
  )
}

function saveSelectionForHover(target: HTMLElement): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    savedHoverSelection = {
      kind: 'input',
      target,
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0
    }
    return
  }

  const sel = window.getSelection()
  savedHoverSelection = { kind: 'contenteditable', range: sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null }
}

function restoreSelectionAfterHover(): void {
  if (!savedHoverSelection) return

  if (savedHoverSelection.kind === 'input') {
    const { target, start, end } = savedHoverSelection
    try {
      target.setSelectionRange(start, end)
    } catch {
      // ignore
    }
    savedHoverSelection = null
    return
  }

  const sel = window.getSelection()
  if (!sel) {
    savedHoverSelection = null
    return
  }

  sel.removeAllRanges()
  if (savedHoverSelection.range) sel.addRange(savedHoverSelection.range)
  savedHoverSelection = null
}

function highlightRangeInTarget(target: HTMLElement, start: number, end: number): void {
  if (start < 0 || end <= start) return

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    saveSelectionForHover(target)
    target.focus()
    target.setSelectionRange(Math.min(start, target.value.length), Math.min(end, target.value.length))
    return
  }

  if (!target.isContentEditable) return
  saveSelectionForHover(target)
  target.focus()

  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  const node = target.childNodes[0] || target

  const maxLen = node.textContent?.length ?? 0
  range.setStart(node, Math.min(start, maxLen))
  range.setEnd(node, Math.min(end, maxLen))

  selection.removeAllRanges()
  selection.addRange(range)
}

function applyMaskingWithSelection(
  text: string,
  detections: Detection[],
  acceptedDetectionIds: Set<string>,
  selectionStart: number,
  selectionEnd: number
) {
  let maskedCount = 0
  let nextStart = selectionStart
  let nextEnd = selectionEnd
  let result = text

  const sorted = [...detections].sort((a, b) => b.start - a.start)

  for (const detection of sorted) {
    if (!acceptedDetectionIds.has(detection.id)) continue

    const token = mapper.getOrCreateToken(detection.type, detection.text, detection.normalized)
    result = `${result.slice(0, detection.start)}${token}${result.slice(detection.end)}`

    const originalLength = detection.end - detection.start
    const delta = token.length - originalLength

    if (detection.end <= nextStart) nextStart += delta
    else if (detection.start < nextStart) nextStart = detection.start + token.length

    if (detection.end <= nextEnd) nextEnd += delta
    else if (detection.start < nextEnd) nextEnd = detection.start + token.length

    maskedCount += 1
  }

  return {
    text: result,
    maskedCount,
    nextSelectionStart: Math.max(0, nextStart),
    nextSelectionEnd: Math.max(0, nextEnd)
  }
}

function shouldTriggerTypeMask(event: InputEvent): boolean {
  if (event.isComposing) return false

  if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
    return true
  }

  if (event.inputType !== 'insertText') return false

  const ch = event.data ?? ''
  return /[\s,.;:!?)]/.test(ch)
}

function scheduleAutoMask(target: InputTarget): void {
  const existing = typingTimers.get(target)
  if (typeof existing === 'number') window.clearTimeout(existing)

  const timerId = window.setTimeout(async () => {
    const settings = await getSettings()

    if (!settings.maskOnType) return

    const currentText = target.value
    if (!currentText || currentText.length > settings.maxPasteSize) return

    const detections = await detectPIIHybrid(currentText, settings)
    const accepted = new Set<string>()

    for (const detection of detections) {
      const isStructured =
        detection.type === 'EMAIL' ||
        detection.type === 'PHONE' ||
        detection.type === 'SSN' ||
        detection.type === 'CREDIT_CARD'

      if (isStructured && detection.confidence === 'high') accepted.add(detection.id)
    }

    if (accepted.size === 0) return

    const selectionStart = target.selectionStart ?? currentText.length
    const selectionEnd = target.selectionEnd ?? currentText.length

    const result = applyMaskingWithSelection(currentText, detections, accepted, selectionStart, selectionEnd)
    if (result.maskedCount === 0 || result.text === currentText) return

    internalMutationTargets.add(target)

    try {
      target.value = result.text
      target.setSelectionRange(result.nextSelectionStart, result.nextSelectionEnd)
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '' }))
    } finally {
      internalMutationTargets.delete(target)
    }

    showToast(`Auto-masked ${result.maskedCount} item(s) while typing.`)
  }, 220)

  typingTimers.set(target, timerId)
}

/* -------------------------------------------------
   Suggestion system
-------------------------------------------------- */

async function handleSuggestions(target: HTMLElement) {
  const settings = await getSettings()

  const text = getEditableText(target)
  if (!text) {
    hideSuggestion()
    return
  }

  let cursor = text.length

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    cursor = target.selectionStart ?? text.length
  }

  const nearDetections = analyzeNearCursor(text, cursor, settings)
  const windowDetections = await detectPIIHybrid(text, settings)

  const suggestionsAll = buildSuggestions(text, resolveOverlaps([...nearDetections, ...windowDetections]), mapper)

  const maskSuggestions: Suggestion[] = []
  const unmaskSuggestions: Suggestion[] = []

  for (const s of suggestionsAll) {
    if (s.type === 'MASK') {
      if (maskSuggestions.length < 10) maskSuggestions.push(s)
    } else {
      if (unmaskSuggestions.length < 10) unmaskSuggestions.push(s)
    }
  }

  if (maskSuggestions.length === 0 && unmaskSuggestions.length === 0) {
    hideSuggestion()
    return
  }

  const anchorRect = target.getBoundingClientRect()

  const stats = mapper.getStats()

  const actions = {
    onMaskAll: async () => {
      const detections = resolveOverlaps([...nearDetections, ...windowDetections])
      const accepted = new Set(detections.map(d => d.id))
      const result = applyMaskingWithSelection(text, detections, accepted, cursor, cursor)

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = result.text
        const next = Math.min(result.nextSelectionStart, target.value.length)
        target.setSelectionRange(next, next)
        target.dispatchEvent(new InputEvent('input', { bubbles: true }))
      } else if (target.isContentEditable) {
        target.innerText = result.text
        target.dispatchEvent(new InputEvent('input', { bubbles: true }))
      }

      showToast(`Masked ${result.maskedCount} item(s).`)
    },
    onUnmaskAll: async () => {
      const result = mapper.unmaskText(text)
      if (result.restoredCount === 0) {
        showToast('No known tokens found.')
        return
      }

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = result.text
        const next = Math.min(cursor, target.value.length)
        target.setSelectionRange(next, next)
        target.dispatchEvent(new InputEvent('input', { bubbles: true }))
      } else if (target.isContentEditable) {
        target.innerText = result.text
        target.dispatchEvent(new InputEvent('input', { bubbles: true }))
      }

      showToast(`Restored ${result.restoredCount} token(s).`)
    },
    onCopyMasked: async () => {
      try {
        await navigator.clipboard.writeText(text)
        showToast('Copied current text to clipboard.')
      } catch {
        showToast('Unable to write to clipboard.')
      }
    },
    onClearSession: () => {
      mapper.clearSession()
      hideSuggestion()
      showToast('Session cleared.')
    }
  }

  showSuggestion(anchorRect, maskSuggestions, unmaskSuggestions, (suggestion) => {
    const before = text.slice(0, suggestion.start)
    const after = text.slice(suggestion.end)

    let replacement = suggestion.replacement
    if (suggestion.type === 'MASK' && suggestion.piiType && suggestion.normalized) {
      replacement = mapper.getOrCreateToken(suggestion.piiType, suggestion.original, suggestion.normalized)
    }

    const newText = before + replacement + after

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.value = newText

      const newCursor = suggestion.start + replacement.length
      target.setSelectionRange(newCursor, newCursor)

      target.dispatchEvent(new InputEvent('input', { bubbles: true }))
    } else if (target instanceof HTMLElement && target.isContentEditable) {
      target.innerText = newText

      const selection = window.getSelection()
      if (!selection) return

      const range = document.createRange()

      const node = target.childNodes[0] || target
      const nextCursor = suggestion.start + replacement.length

      range.setStart(node, Math.min(nextCursor, node.textContent?.length || nextCursor))

      range.collapse(true)

      selection.removeAllRanges()
      selection.addRange(range)

      target.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }
  }, (hovered) => {
    if (!hovered) {
      restoreSelectionAfterHover()
      return
    }

    highlightRangeInTarget(target, hovered.start, hovered.end)
  }, stats, actions)
}

async function maskAllInActiveEditable(): Promise<void> {
  const active = resolveEditableHost(document.activeElement)
  if (!active) return

  const settings = await getSettings()
  const text = getEditableText(active as HTMLElement)
  if (!text) return

  const cursor =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active.selectionStart ?? text.length
      : text.length

  const nearDetections = analyzeNearCursor(text, cursor, settings)
  const windowDetections = await detectPIIHybrid(text, settings)
  const detections = resolveOverlaps([...nearDetections, ...windowDetections])
  const accepted = new Set(detections.map(d => d.id))
  const result = applyMaskingWithSelection(text, detections, accepted, cursor, cursor)

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    active.value = result.text
    const next = Math.min(result.nextSelectionStart, active.value.length)
    active.setSelectionRange(next, next)
    active.dispatchEvent(new InputEvent('input', { bubbles: true }))
  } else if (active.isContentEditable) {
    active.innerText = result.text
    active.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  showToast(`Masked ${result.maskedCount} item(s).`)
}

async function unmaskAllInActiveEditable(): Promise<void> {
  const active = resolveEditableHost(document.activeElement)
  if (!active) return

  const text = getEditableText(active as HTMLElement)
  if (!text) return

  const result = mapper.unmaskText(text)
  if (result.restoredCount === 0) {
    showToast('No known tokens found.')
    return
  }

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const cursor = active.selectionStart ?? result.text.length
    active.value = result.text
    const next = Math.min(cursor, active.value.length)
    active.setSelectionRange(next, next)
    active.dispatchEvent(new InputEvent('input', { bubbles: true }))
  } else if (active.isContentEditable) {
    active.innerText = result.text
    active.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  showToast(`Restored ${result.restoredCount} token(s).`)
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  const target = resolveEditableHost(event.target)
  if (!target) return

  const insertContext = captureInsertContext(target)
  if (!insertContext) return

  const clipboardText = event.clipboardData?.getData('text/plain')
  if (!clipboardText) return

  // Prevent the browser/site from performing the default paste while we decide
  // whether to mask. This avoids duplicate insertion (raw + masked).
  event.preventDefault()
  event.stopPropagation()

  const settings = await getSettings()

  if (clipboardText.length > settings.maxPasteSize) {
    showToast(`Paste skipped: over max size (${settings.maxPasteSize} chars).`)
    applyInsertContext(insertContext, clipboardText)
    return
  }

  const detections = await detectPIIHybrid(clipboardText, settings)
  if (detections.length === 0) {
    applyInsertContext(insertContext, clipboardText)
    return
  }

  const acceptedIds = await showMaskConfirmation(detections)

  if (!acceptedIds) {
    applyInsertContext(insertContext, clipboardText)
    showToast('Paste kept unchanged.')
    return
  }

  const masked = applyMaskingWithSelection(
    clipboardText,
    detections,
    acceptedIds,
    clipboardText.length,
    clipboardText.length
  )

  applyInsertContext(insertContext, masked.text)
  showToast(`Masked ${masked.maskedCount} item(s).`)
}

/* -------------------------------------------------
   Input handling
-------------------------------------------------- */

async function onInput(event: InputEvent): Promise<void> {
  const editable = resolveEditableHost(event.target)
  if (!editable) {
    hideSuggestion()
    return
  }

  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    if (internalMutationTargets.has(editable)) return
  }

  await handleSuggestions(editable as HTMLElement)

  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    const settings = await getSettings()

    if (!settings.maskOnType) return
    if (!shouldTriggerTypeMask(event)) return

    scheduleAutoMask(editable)
  }
}

/* -------------------------------------------------
   Unmask command
-------------------------------------------------- */

async function handleUnmaskRequest() {
  const active = document.activeElement

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const selectedText = getSelectionTextForEditable(active)

    if (!selectedText) {
      return { success: false, restoredCount: 0, message: 'No selection to unmask.' }
    }

    const result = mapper.unmaskText(selectedText)

    if (result.restoredCount > 0) {
      replaceSelectionInEditable(active, result.text)

      try {
        await navigator.clipboard.writeText(result.text)
        return {
          success: true,
          restoredCount: result.restoredCount,
          message: `Restored ${result.restoredCount} token(s) and copied to clipboard.`
        }
      } catch {
        return {
          success: true,
          restoredCount: result.restoredCount,
          message: `Restored ${result.restoredCount} token(s).`
        }
      }
    }

    return { success: false, restoredCount: 0, message: 'No known tokens found in selection.' }
  }

  const selection = window.getSelection()
  const selectedText = selection?.toString() ?? ''

  if (!selectedText) {
    return { success: false, restoredCount: 0, message: 'No selection to unmask.' }
  }

  const result = mapper.unmaskText(selectedText)

  if (result.restoredCount === 0) {
    return { success: false, restoredCount: 0, message: 'No known tokens found in selection.' }
  }

  try {
    await navigator.clipboard.writeText(result.text)

    return {
      success: true,
      restoredCount: result.restoredCount,
      message: `Restored ${result.restoredCount} token(s) and copied to clipboard.`
    }
  } catch {
    return {
      success: false,
      restoredCount: 0,
      message: 'Unable to write restored text to clipboard.'
    }
  }
}

/* -------------------------------------------------
   Event listeners
-------------------------------------------------- */

document.addEventListener('paste', event => void onPaste(event), true)

document.addEventListener('input', event => void onInput(event as InputEvent), true)

document.addEventListener('keydown', (event) => {
  const e = event as KeyboardEvent
  const isMod = e.metaKey || e.ctrlKey
  if (!isMod || !e.shiftKey) return

  if (e.key === 'M' || e.key === 'm') {
    e.preventDefault()
    void maskAllInActiveEditable()
    return
  }

  if (e.key === 'U' || e.key === 'u') {
    e.preventDefault()
    void unmaskAllInActiveEditable()
    return
  }
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type !== 'UNMASK_SELECTION_REQUEST') return

  void handleUnmaskRequest().then(result => {
    showToast(result.message)

    sendResponse({
      type: 'UNMASK_SELECTION_RESULT',
      payload: {
        success: result.success,
        restoredCount: result.restoredCount,
        message: result.message
      }
    })
  })

  return true
})