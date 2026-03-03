import type { Detection, PiiType, TabMappingState } from './types';

function createCounters(): Record<PiiType, number> {
  return {
    EMAIL: 0,
    PHONE: 0,
    SSN: 0,
    CREDIT_CARD: 0,
    PERSON_NAME: 0
  };
}

function simpleHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export class TabMapper {
  private state: TabMappingState = {
    tokenToOriginal: new Map<string, string>(),
    originalToToken: new Map<string, string>(),
    countersByType: createCounters()
  };

  getOrCreateToken(type: PiiType, original: string, normalized: string): string {
    const key = `${type}:${simpleHash(normalized)}`;
    const existingToken = this.state.originalToToken.get(key);
    if (existingToken) {
      return existingToken;
    }

    this.state.countersByType[type] += 1;
    const token = `{{PII_${type}_${this.state.countersByType[type]}}}`;
    this.state.originalToToken.set(key, token);
    this.state.tokenToOriginal.set(token, original);
    return token;
  }

  restoreToken(token: string): string | undefined {
    return this.state.tokenToOriginal.get(token);
  }

  unmaskText(text: string): { text: string; restoredCount: number } {
    let restoredCount = 0;
    const replaced = text.replace(/\{\{PII_[A-Z_]+_\d+\}\}/g, (token) => {
      const original = this.restoreToken(token);
      if (!original) {
        return token;
      }

      restoredCount += 1;
      return original;
    });

    return { text: replaced, restoredCount };
  }
}

export function applyMasking(
  text: string,
  detections: Detection[],
  acceptedDetectionIds: Set<string>,
  mapper: TabMapper
): { text: string; maskedCount: number } {
  let maskedCount = 0;
  const sorted = [...detections].sort((a, b) => b.start - a.start);
  let result = text;

  for (const detection of sorted) {
    if (!acceptedDetectionIds.has(detection.id)) {
      continue;
    }

    const token = mapper.getOrCreateToken(detection.type, detection.text, detection.normalized);
    result = `${result.slice(0, detection.start)}${token}${result.slice(detection.end)}`;
    maskedCount += 1;
  }

  return { text: result, maskedCount };
}
