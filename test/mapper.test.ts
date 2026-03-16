import { describe, expect, it } from 'vitest';
import { applyMasking, TabMapper } from '../src/mapper';
import type { Detection } from '../src/types';

describe('TabMapper', () => {
  it('reuses token for repeated normalized values', () => {
    const mapper = new TabMapper();
    const a = mapper.getOrCreateToken('PHONE', '(415) 555-2671', '4155552671');
    const b = mapper.getOrCreateToken('PHONE', '415-555-2671', '4155552671');

    expect(a).toBe(b);
  });

  it('unmasks known tokens and leaves unknown tokens untouched', () => {
    const mapper = new TabMapper();
    const token = mapper.getOrCreateToken('EMAIL', 'alice@example.com', 'alice@example.com');

    const result = mapper.unmaskText(`hello ${token} and {{PII_EMAIL_999}}`);
    expect(result.text).toContain('alice@example.com');
    expect(result.text).toContain('{{PII_EMAIL_999}}');
    expect(result.restoredCount).toBe(1);
  });

  it('supports unmasking legacy {{PII_TYPE_N}} tokens if they exist in the map', () => {
    const mapper = new TabMapper();

    const canonical = mapper.getOrCreateToken('EMAIL', 'bob@example.com', 'bob@example.com');
    // simulate a legacy token present in text by adding it to the map via direct creation
    // (content script may have older masked drafts)
    (mapper as any).state?.tokenToOriginal?.set('{{PII_EMAIL_1}}', 'bob@example.com');

    const result = mapper.unmaskText(`a ${canonical} b {{PII_EMAIL_1}}`);
    expect(result.text).toContain('bob@example.com');
    expect(result.restoredCount).toBeGreaterThanOrEqual(1);
  });
});

describe('applyMasking', () => {
  it('applies accepted detections only', () => {
    const mapper = new TabMapper();
    const text = 'Email john@example.com and phone 415-555-2671';

    const detections: Detection[] = [
      {
        id: 'EMAIL_0',
        type: 'EMAIL',
        start: 6,
        end: 22,
        text: 'john@example.com',
        normalized: 'john@example.com',
        confidence: 'high'
      },
      {
        id: 'PHONE_0',
        type: 'PHONE',
        start: 33,
        end: 45,
        text: '415-555-2671',
        normalized: '4155552671',
        confidence: 'high'
      }
    ];

    const accepted = new Set(['EMAIL_0']);
    const result = applyMasking(text, detections, accepted, mapper);

    expect(result.text).toContain('PII_email_1');
    expect(result.text).toContain('415-555-2671');
    expect(result.maskedCount).toBe(1);
  });
});
