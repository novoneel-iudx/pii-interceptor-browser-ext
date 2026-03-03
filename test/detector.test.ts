import { describe, expect, it } from 'vitest';
import { detectPII, passesLuhn } from '../src/detector';
import { DEFAULT_SETTINGS } from '../src/settings';

describe('passesLuhn', () => {
  it('accepts valid credit card numbers', () => {
    expect(passesLuhn('4111 1111 1111 1111')).toBe(true);
  });

  it('rejects invalid credit card numbers', () => {
    expect(passesLuhn('4111 1111 1111 1112')).toBe(false);
  });
});

describe('detectPII', () => {
  it('detects email and phone', () => {
    const text = 'Reach me at john.doe@example.com or (415) 555-2671.';
    const detections = detectPII(text, DEFAULT_SETTINGS);
    const types = detections.map((d) => d.type);

    expect(types).toContain('EMAIL');
    expect(types).toContain('PHONE');
  });

  it('skips invalid card that fails luhn', () => {
    const text = 'Card: 4111 1111 1111 1112';
    const detections = detectPII(text, DEFAULT_SETTINGS);

    expect(detections.some((d) => d.type === 'CREDIT_CARD')).toBe(false);
  });

  it('returns low confidence person-name detections', () => {
    const text = 'Please contact John Smith for updates.';
    const detections = detectPII(text, DEFAULT_SETTINGS);
    const names = detections.filter((d) => d.type === 'PERSON_NAME');

    expect(names.length).toBeGreaterThanOrEqual(1);
    expect(names[0].confidence).toBe('low');
  });
});
