import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addCustomSlot,
  canAddCustomSlot,
  findExistingCustomSlot,
  placeToSlot,
  removeCustomSlot,
} from './locations/custom-slots';
import type { GeocodingPlace, LocationSlot } from './locations/types';
import { createCustomSlotsStore } from './storage/custom-slots-store';
import { createForecastCache } from './storage/forecast-cache';
import { SAMPLE_FORECAST } from './weather/fixtures/open-meteo-forecast.fixture';

// End-to-end (JSDOM) walk-through of the STORY-009 flow tying together
// custom-slots domain logic + storage IO + forecast cache. Mirrors what
// `main.ts` does on add/remove/reload, without spinning up Vite.

const HELSINKI: GeocodingPlace = {
  name: 'Helsinki',
  latitude: 60.1695,
  longitude: 24.9354,
  country: 'Finland',
};

const TALLINN: GeocodingPlace = {
  name: 'Tallinn',
  latitude: 59.4372,
  longitude: 24.7536,
  country: 'Estonia',
};

const RIGA: GeocodingPlace = {
  name: 'Riga',
  latitude: 56.9496,
  longitude: 24.1052,
  country: 'Latvia',
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('STORY-009 end-to-end (domain + storage)', () => {
  it('AC1: add → persisted → re-added produces same slot id (cache-friendly)', () => {
    const store = createCustomSlotsStore();
    let slots: LocationSlot[] = [];

    const r1 = placeToSlot(HELSINKI);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const add = addCustomSlot(slots, r1.slot);
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    slots = add.slots;
    expect(store.write(slots).ok).toBe(true);

    // Re-create the store to simulate a reload — read returns the slot
    // with the same id, latitude, longitude and kind: 'custom'.
    const reloaded = createCustomSlotsStore().read();
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.data).toHaveLength(1);
    expect(reloaded.data[0]).toEqual({
      id: 'custom-60.1695-24.9354',
      name: 'Helsinki',
      latitude: 60.1695,
      longitude: 24.9354,
      kind: 'custom',
    });
  });

  it('AC2: at the cap, canAddCustomSlot is false and addCustomSlot returns capacity-full', () => {
    const store = createCustomSlotsStore();
    let slots: LocationSlot[] = [];
    for (const p of [HELSINKI, TALLINN]) {
      const r = placeToSlot(p);
      if (!r.ok) throw new Error('fixture broken');
      const add = addCustomSlot(slots, r.slot);
      if (!add.ok) throw new Error('expected add to succeed');
      slots = add.slots;
    }
    store.write(slots);
    expect(canAddCustomSlot(slots)).toBe(false);

    const third = placeToSlot(RIGA);
    if (!third.ok) throw new Error('fixture broken');
    const rejected = addCustomSlot(slots, third.slot);
    expect(rejected).toEqual({ ok: false, reason: 'capacity-full' });
  });

  it('AC2: duplicate add is silently rejected', () => {
    const r = placeToSlot(HELSINKI);
    if (!r.ok) throw new Error('fixture broken');
    const slots = [r.slot];
    expect(findExistingCustomSlot(slots, HELSINKI)?.id).toBe('custom-60.1695-24.9354');
    expect(addCustomSlot(slots, r.slot)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('AC3: remove evicts both the slot list AND the forecast cache entry', () => {
    const store = createCustomSlotsStore();
    const cache = createForecastCache();
    const r = placeToSlot(HELSINKI);
    if (!r.ok) throw new Error('fixture broken');
    let slots = [r.slot];
    store.write(slots);
    cache.writeSlot(r.slot.id, { forecast: SAMPLE_FORECAST, fetchedAt: 1_700_000_000_000 });

    // Both stores have the slot.
    expect(store.read().ok && (store.read() as { data: LocationSlot[] }).data).toBeTruthy();
    const beforeCache = cache.read();
    expect(beforeCache.ok && beforeCache.data[r.slot.id]).toBeTruthy();

    // Remove.
    slots = removeCustomSlot(slots, r.slot.id);
    store.write(slots);
    cache.removeSlot(r.slot.id);

    // Both stores no longer have the slot.
    expect(store.read()).toEqual({ ok: false, reason: { kind: 'absent' } });
    const afterCache = cache.read();
    if (afterCache.ok) {
      expect(afterCache.data[r.slot.id]).toBeUndefined();
    }
  });

  it('AC4: reload (re-create store) restores the slot list in insertion order', () => {
    const store = createCustomSlotsStore();
    const rh = placeToSlot(HELSINKI);
    const rt = placeToSlot(TALLINN);
    if (!rh.ok || !rt.ok) throw new Error('fixture broken');
    store.write([rh.slot, rt.slot]);

    const reloaded = createCustomSlotsStore().read();
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.data.map((s) => s.id)).toEqual([
      'custom-60.1695-24.9354',
      'custom-59.4372-24.7536',
    ]);
    expect(reloaded.data.every((s) => s.kind === 'custom')).toBe(true);
  });

  it('AC5: full add→remove→reload cycle leaves no orphaned cache entry', () => {
    const store = createCustomSlotsStore();
    const cache = createForecastCache();
    const r = placeToSlot(HELSINKI);
    if (!r.ok) throw new Error('fixture broken');

    // Add + persist + cache.
    store.write([r.slot]);
    cache.writeSlot(r.slot.id, { forecast: SAMPLE_FORECAST, fetchedAt: 1_700_000_000_000 });

    // Remove + persist + evict.
    store.write(removeCustomSlot([r.slot], r.slot.id));
    cache.removeSlot(r.slot.id);

    // Simulate reload.
    const slotsReread = createCustomSlotsStore().read();
    const cacheReread = createForecastCache().read();
    expect(slotsReread).toEqual({ ok: false, reason: { kind: 'absent' } });
    // Cache may be absent (only slot removed) — both are fine, neither
    // surfaces the removed slot.
    if (cacheReread.ok) {
      expect(cacheReread.data[r.slot.id]).toBeUndefined();
    }
  });
});
