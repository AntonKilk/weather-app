import { describe, expect, it } from 'vitest';
import {
  CUSTOM_SLOT_COORD_PRECISION,
  CUSTOM_SLOT_ID_PREFIX,
  MAX_CUSTOM_SLOTS,
  addCustomSlot,
  buildCustomSlotId,
  canAddCustomSlot,
  findExistingCustomSlot,
  placeToSlot,
  removeCustomSlot,
} from './custom-slots';
import type { GeocodingPlace, LocationSlot } from './types';

function customSlot(id: string, name = id): LocationSlot {
  return { id, name, latitude: 0, longitude: 0, kind: 'custom' };
}

describe('constants', () => {
  it('caps custom slots at 2', () => {
    expect(MAX_CUSTOM_SLOTS).toBe(2);
  });

  it('uses 4-decimal precision (~11 m)', () => {
    expect(CUSTOM_SLOT_COORD_PRECISION).toBe(4);
  });
});

describe('buildCustomSlotId', () => {
  it('rounds to 4 decimals and prefixes with custom-', () => {
    expect(buildCustomSlotId(60.169512, 24.93545)).toBe(`${CUSTOM_SLOT_ID_PREFIX}60.1695-24.9354`);
  });

  it('preserves negative coords (double-dash retained)', () => {
    expect(buildCustomSlotId(-60.169512, -24.93545)).toBe(
      `${CUSTOM_SLOT_ID_PREFIX}-60.1695--24.9354`,
    );
  });

  it('emits 0.0000 for true zero (not "0")', () => {
    expect(buildCustomSlotId(0, 0)).toBe(`${CUSTOM_SLOT_ID_PREFIX}0.0000-0.0000`);
  });
});

describe('placeToSlot', () => {
  it('builds a typed LocationSlot from a geocoding hit (happy path)', () => {
    const place: GeocodingPlace = {
      name: '  Helsinki  ',
      latitude: 60.169512,
      longitude: 24.93545,
      country: 'Finland',
    };
    const result = placeToSlot(place);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slot).toEqual({
        id: 'custom-60.1695-24.9354',
        name: 'Helsinki',
        latitude: 60.1695,
        longitude: 24.9354,
        kind: 'custom',
      });
    }
  });

  it('rejects name that is empty after trim', () => {
    const result = placeToSlot({ name: '   ', latitude: 0, longitude: 0 });
    expect(result).toEqual({ ok: false, reason: 'invalid-name' });
  });

  it.each([
    ['NaN lat', Number.NaN, 0],
    ['+Infinity lat', Number.POSITIVE_INFINITY, 0],
    ['lat > 90', 91, 0],
    ['lat < -90', -91, 0],
  ])('rejects invalid latitude (%s)', (_label, lat, lon) => {
    const result = placeToSlot({ name: 'X', latitude: lat, longitude: lon });
    expect(result).toEqual({ ok: false, reason: 'invalid-coords' });
  });

  it.each([
    ['NaN lon', 0, Number.NaN],
    ['lon > 180', 0, 181],
    ['lon < -180', 0, -181],
  ])('rejects invalid longitude (%s)', (_label, lat, lon) => {
    const result = placeToSlot({ name: 'X', latitude: lat, longitude: lon });
    expect(result).toEqual({ ok: false, reason: 'invalid-coords' });
  });

  it('accepts boundary coords (±90, ±180)', () => {
    expect(placeToSlot({ name: 'NP', latitude: 90, longitude: 180 }).ok).toBe(true);
    expect(placeToSlot({ name: 'SP', latitude: -90, longitude: -180 }).ok).toBe(true);
  });
});

describe('findExistingCustomSlot', () => {
  it('returns the existing slot when ids match (by rounded coords)', () => {
    const slot: LocationSlot = {
      id: 'custom-60.1695-24.9354',
      name: 'Helsinki',
      latitude: 60.1695,
      longitude: 24.9354,
      kind: 'custom',
    };
    const place: GeocodingPlace = { name: 'Helsinki', latitude: 60.169512, longitude: 24.93545 };
    expect(findExistingCustomSlot([slot], place)).toBe(slot);
  });

  it('returns null when no slot matches', () => {
    const slot: LocationSlot = {
      id: 'custom-60.1695-24.9354',
      name: 'Helsinki',
      latitude: 60.1695,
      longitude: 24.9354,
      kind: 'custom',
    };
    const place: GeocodingPlace = { name: 'Tallinn', latitude: 59.4372, longitude: 24.7536 };
    expect(findExistingCustomSlot([slot], place)).toBeNull();
  });

  it('returns null when the place has invalid coords (defensive)', () => {
    expect(
      findExistingCustomSlot(
        [{ id: 'x', name: 'x', latitude: 0, longitude: 0, kind: 'custom' }],
        { name: 'X', latitude: Number.NaN, longitude: 0 },
      ),
    ).toBeNull();
  });
});

describe('canAddCustomSlot', () => {
  it('returns true when the list is empty', () => {
    expect(canAddCustomSlot([])).toBe(true);
  });

  it('returns true when below the cap', () => {
    expect(canAddCustomSlot([customSlot('a')])).toBe(true);
  });

  it('returns false at the cap', () => {
    expect(canAddCustomSlot([customSlot('a'), customSlot('b')])).toBe(false);
  });

  it('returns false above the cap (defensive)', () => {
    expect(canAddCustomSlot([customSlot('a'), customSlot('b'), customSlot('c')])).toBe(false);
  });
});

describe('addCustomSlot', () => {
  it('appends and returns a NEW array (no mutation)', () => {
    const input: readonly LocationSlot[] = [customSlot('a')];
    const result = addCustomSlot(input, customSlot('b'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slots).not.toBe(input);
      expect(input).toHaveLength(1);
      expect(result.slots.map((s) => s.id)).toEqual(['a', 'b']);
    }
  });

  it('rejects when at capacity (capacity-full)', () => {
    const input = [customSlot('a'), customSlot('b')];
    expect(addCustomSlot(input, customSlot('c'))).toEqual({
      ok: false,
      reason: 'capacity-full',
    });
  });

  it('rejects duplicate ids (duplicate)', () => {
    const input = [customSlot('a')];
    expect(addCustomSlot(input, customSlot('a'))).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('removeCustomSlot', () => {
  it('returns a new array minus the named id', () => {
    const input: readonly LocationSlot[] = [customSlot('a'), customSlot('b')];
    const result = removeCustomSlot(input, 'a');
    expect(result).not.toBe(input);
    expect(result.map((s) => s.id)).toEqual(['b']);
    expect(input.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('absent id is a silent no-op (still returns a new array)', () => {
    const input = [customSlot('a')];
    const result = removeCustomSlot(input, 'missing');
    expect(result).not.toBe(input);
    expect(result.map((s) => s.id)).toEqual(['a']);
  });

  it('returns an empty array when removing the last slot', () => {
    expect(removeCustomSlot([customSlot('a')], 'a')).toEqual([]);
  });
});
