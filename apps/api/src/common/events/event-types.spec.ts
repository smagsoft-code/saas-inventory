import { describe, expect, it } from 'vitest';
import { ALL_KNOWN_EVENT_TYPES, CURRENT_EVENT_VERSIONS, EVENT_TYPES, isKnownEventType } from './event-types';

describe('event catalog', () => {
  it('every event type has a current contract version (§20)', () => {
    for (const type of ALL_KNOWN_EVENT_TYPES) {
      expect(CURRENT_EVENT_VERSIONS[type]).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(CURRENT_EVENT_VERSIONS).sort()).toEqual([...ALL_KNOWN_EVENT_TYPES].sort());
  });

  it('names are dotted module.aggregate.action, past tense (§12)', () => {
    for (const type of ALL_KNOWN_EVENT_TYPES) {
      expect(type).toMatch(/^sales\.[a-z_]+\.[a-z_]+$/);
      expect(type).toMatch(/(confirmed|cancelled|requested|approved|rejected|resolved)$/);
    }
  });

  it('exposes exactly the 8 FASE 14 SALES facts', () => {
    expect(ALL_KNOWN_EVENT_TYPES).toHaveLength(8);
    expect(ALL_KNOWN_EVENT_TYPES).toContain(EVENT_TYPES.ORDER_CONFIRMED);
  });

  it('isKnownEventType guards unknown strings', () => {
    expect(isKnownEventType(EVENT_TYPES.ORDER_CONFIRMED)).toBe(true);
    expect(isKnownEventType('inventory.low_stock')).toBe(false);
    expect(isKnownEventType('')).toBe(false);
  });
});
