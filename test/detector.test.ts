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

  it('detects Indian 10-digit phone numbers', () => {
    const text = 'Call me on 9826476738 tomorrow.';
    const detections = detectPII(text, DEFAULT_SETTINGS);
    expect(detections.some((d) => d.type === 'PHONE')).toBe(true);
  });

  it('detects lowercase names in "my name is ..." patterns', () => {
    const text = 'Hello, my name is vrushabh.';
    const detections = detectPII(text, DEFAULT_SETTINGS);
    expect(detections.some((d) => d.type === 'PERSON_NAME')).toBe(true);
  });

  it('detects addresses in "address is ..." patterns when enabled', () => {
    const text = 'My address is banashankari, 3rd main 7th cross gurunivasa.';
    const settings = {
      ...DEFAULT_SETTINGS,
      enabledTypes: {
        ...DEFAULT_SETTINGS.enabledTypes,
        ADDRESS: true
      }
    };
    const detections = detectPII(text, settings);
    expect(detections.some((d) => d.type === 'ADDRESS')).toBe(true);
  });
});
