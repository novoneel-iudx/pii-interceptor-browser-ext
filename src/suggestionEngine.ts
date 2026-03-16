import type { Detection, Suggestion } from './types'
import { TabMapper } from './mapper'

const CANONICAL_TOKEN_REGEX = /PII_[a-z_]+_\d+/g
const LEGACY_TOKEN_REGEX = /\{\{PII_[A-Z_]+_\d+\}\}/g

export function buildSuggestions(
  text: string,
  detections: Detection[],
  mapper: TabMapper
): Suggestion[] {

  const suggestions: Suggestion[] = []

  for (const d of detections) {

    const existing = mapper.getExistingToken(d.type, d.normalized)
    const token = existing ?? mapper.peekNextToken(d.type)

    suggestions.push({
      id: crypto.randomUUID(),
      type: "MASK",
      piiType: d.type,
      original: d.text,
      replacement: token,
      normalized: d.normalized,
      confidence: d.confidence,
      start: d.start,
      end: d.end
    })
  }

  const tokenRegexes = [CANONICAL_TOKEN_REGEX, LEGACY_TOKEN_REGEX]
  for (const re of tokenRegexes) {
    re.lastIndex = 0

    let m
    while ((m = re.exec(text))) {
      const token = m[0]
      const original = mapper.restoreToken(token)
      if (!original) continue

      suggestions.push({
        id: crypto.randomUUID(),
        type: "UNMASK",
        original: token,
        replacement: original,
        start: m.index,
        end: m.index + token.length
      })
    }
  }

  return suggestions
}