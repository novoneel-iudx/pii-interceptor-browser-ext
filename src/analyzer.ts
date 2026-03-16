import { detectPII } from './detector'
import type { Detection, ExtensionSettings } from './types'

export interface AnalysisWindow {
  text: string
  offset: number
}

export function extractAnalysisWindow(
  fullText: string,
  cursor: number,
  windowSize = 250
): AnalysisWindow {

  const start = Math.max(0, cursor - windowSize)
  const end = Math.min(fullText.length, cursor + 50)

  return {
    text: fullText.slice(start, end),
    offset: start
  }
}

export function analyzeNearCursor(
  text: string,
  cursor: number,
  settings: ExtensionSettings
): Detection[] {

  const { text: windowText, offset } = extractAnalysisWindow(text, cursor)

  const detections = detectPII(windowText, settings)

  return detections.map(d => ({
    ...d,
    start: d.start + offset,
    end: d.end + offset
  }))
}