import type { Confidence, Detection, ExtensionSettings, PiiType } from './types';

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX = /(?<!\w)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\w)/g;
const IN_PHONE_REGEX = /(?<!\d)[6-9]\d{9}(?!\d)/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_REGEX = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
const NAME_REGEX = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?\b/g;
const MY_NAME_IS_REGEX = /\bmy\s+name\s+is\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{1,30}){0,2})\b/gi;
const ADDRESS_IS_REGEX = /\b(?:my\s+)?address\s+is\s+([^\n.]{8,140})/gi;

const CANONICAL_TOKEN_REGEX = /^PII_[a-z_]+_\d+$/;
const LEGACY_TOKEN_REGEX = /^\{\{PII_[A-Z_]+_\d+\}\}$/;

function isTokenLike(value: string): boolean {
  const v = value.trim();
  return CANONICAL_TOKEN_REGEX.test(v) || LEGACY_TOKEN_REGEX.test(v);
}

function containsFieldKeyword(value: string): boolean {
  return /\b(phone|number|email|address|ssn|credit|card)\b/i.test(value);
}

const NAME_STOPWORDS = new Set([
  'United', 'States', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December', 'Please', 'Thanks', 'Hello', 'Regards'
]);

const CONFIDENCE_SCORE: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1
};

function makeId(type: PiiType, index: number): string {
  return `${type}_${index}`;
}

function normalize(type: PiiType, value: string): string {
  switch (type) {
    case 'EMAIL':
      return value.trim().toLowerCase();
    case 'PHONE':
      return value.replace(/\D/g, '');
    case 'SSN':
      return value.replace(/\D/g, '');
    case 'CREDIT_CARD':
      return value.replace(/\D/g, '');
    case 'PERSON_NAME':
      return value.trim().replace(/\s+/g, ' ');
    case 'ADDRESS':
      return value.trim().replace(/\s+/g, ' ');
    default:
      return value;
  }
}

function collectGroupMatches(
  text: string,
  type: PiiType,
  regex: RegExp,
  confidence: Confidence,
  groupIndex: number,
  predicate?: (value: string) => boolean
): Detection[] {
  const detections: Detection[] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    const group = match[groupIndex];
    if (!group) {
      continue;
    }

    const full = match[0];
    const rel = full.toLowerCase().indexOf(String(group).toLowerCase());
    const start = match.index + Math.max(0, rel);
    const end = start + group.length;

    const value = text.slice(start, end);
    if (isTokenLike(value)) {
      continue;
    }
    if (predicate && !predicate(value)) {
      continue;
    }

    detections.push({
      id: makeId(type, index++),
      type,
      start,
      end,
      text: value,
      normalized: normalize(type, value),
      confidence
    });
  }

  return detections;
}

function collectMatches(
  text: string,
  type: PiiType,
  regex: RegExp,
  confidence: Confidence,
  predicate?: (value: string) => boolean
): Detection[] {
  const detections: Detection[] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    if (isTokenLike(value)) {
      continue;
    }
    if (predicate && !predicate(value)) {
      continue;
    }

    detections.push({
      id: makeId(type, index++),
      type,
      start: match.index,
      end: match.index + value.length,
      text: value,
      normalized: normalize(type, value),
      confidence
    });
  }

  return detections;
}

export function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (Number.isNaN(digit)) {
      return false;
    }

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function isLikelyPersonName(value: string): boolean {
  const tokens = value.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 3) {
    return false;
  }

  if (tokens.some((token) => NAME_STOPWORDS.has(token))) {
    return false;
  }

  return true;
}

export function resolveOverlaps(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((a, b) => {
    const confidenceDiff = CONFIDENCE_SCORE[b.confidence] - CONFIDENCE_SCORE[a.confidence];
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }

    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) {
      return lengthDiff;
    }

    return a.start - b.start;
  });

  const accepted: Detection[] = [];
  for (const candidate of sorted) {
    const conflicts = accepted.some((existing) => candidate.start < existing.end && candidate.end > existing.start);
    if (!conflicts) {
      accepted.push(candidate);
    }
  }

  return accepted.sort((a, b) => a.start - b.start);
}

export function detectPIIRegex(text: string): Detection[] {
  const defaultSettings: ExtensionSettings = {
    enabledTypes: {
      EMAIL: true,
      PHONE: true,
      SSN: true,
      CREDIT_CARD: true,
      PERSON_NAME: true,
      ORG: false,
      LOCATION: false,
      ADDRESS: false
    },
    maxPasteSize: 50000,
    maskOnType: false,
    nerMinConfidence: 0.85
  };

  return detectPII(text, defaultSettings);
}

export function detectPII(text: string, settings: ExtensionSettings): Detection[] {
  const detections: Detection[] = [];

  if (settings.enabledTypes.EMAIL) {
    detections.push(...collectMatches(text, 'EMAIL', EMAIL_REGEX, 'high'));
  }

  if (settings.enabledTypes.PHONE) {
    detections.push(...collectMatches(text, 'PHONE', PHONE_REGEX, 'high'));
    detections.push(...collectMatches(text, 'PHONE', IN_PHONE_REGEX, 'high'));
  }

  if (settings.enabledTypes.SSN) {
    detections.push(...collectMatches(text, 'SSN', SSN_REGEX, 'high'));
  }

  if (settings.enabledTypes.CREDIT_CARD) {
    detections.push(...collectMatches(text, 'CREDIT_CARD', CREDIT_CARD_REGEX, 'high', passesLuhn));
  }

  if (settings.enabledTypes.PERSON_NAME) {
    detections.push(...collectMatches(text, 'PERSON_NAME', NAME_REGEX, 'low', isLikelyPersonName));
    detections.push(
      ...collectGroupMatches(text, 'PERSON_NAME', MY_NAME_IS_REGEX, 'medium', 1, (value) => {
        if (containsFieldKeyword(value)) return false;
        if (/[\d.,]/.test(value)) return false;
        return true;
      })
    );
  }

  if (settings.enabledTypes.ADDRESS) {
    detections.push(
      ...collectGroupMatches(text, 'ADDRESS', ADDRESS_IS_REGEX, 'medium', 1, (value) => {
        if (isTokenLike(value)) return false;
        return true;
      })
    );
  }

  return resolveOverlaps(detections);
}
