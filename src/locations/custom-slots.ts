import type { GeocodingPlace, LocationSlot } from './types';

// Pure domain helpers for the two custom location slots (STORY-009).
// No IO, no DOM, no console — `src/storage/custom-slots-store.ts` owns
// persistence, `src/main.ts` owns the wiring (CLAUDE.md › Architecture).

export const MAX_CUSTOM_SLOTS = 2;
export const CUSTOM_SLOT_ID_PREFIX = 'custom-';
export const CUSTOM_SLOT_COORD_PRECISION = 4;

export function buildCustomSlotId(latitude: number, longitude: number): string {
  const lat = latitude.toFixed(CUSTOM_SLOT_COORD_PRECISION);
  const lon = longitude.toFixed(CUSTOM_SLOT_COORD_PRECISION);
  return `${CUSTOM_SLOT_ID_PREFIX}${lat}-${lon}`;
}

export type PlaceToSlotResult =
  | { ok: true; slot: LocationSlot }
  | { ok: false; reason: 'invalid-coords' | 'invalid-name' };

export function placeToSlot(place: GeocodingPlace): PlaceToSlotResult {
  if (
    typeof place.latitude !== 'number' ||
    !Number.isFinite(place.latitude) ||
    place.latitude < -90 ||
    place.latitude > 90
  ) {
    return { ok: false, reason: 'invalid-coords' };
  }
  if (
    typeof place.longitude !== 'number' ||
    !Number.isFinite(place.longitude) ||
    place.longitude < -180 ||
    place.longitude > 180
  ) {
    return { ok: false, reason: 'invalid-coords' };
  }
  const name = typeof place.name === 'string' ? place.name.trim() : '';
  if (name === '') {
    return { ok: false, reason: 'invalid-name' };
  }
  // Round coords to the persisted precision so the on-disk slot's
  // latitude/longitude match the id seed exactly. Avoids floating-point
  // drift on re-add and keeps the forecast-cache key stable.
  const latitude = Number(place.latitude.toFixed(CUSTOM_SLOT_COORD_PRECISION));
  const longitude = Number(place.longitude.toFixed(CUSTOM_SLOT_COORD_PRECISION));
  return {
    ok: true,
    slot: {
      id: buildCustomSlotId(latitude, longitude),
      name,
      latitude,
      longitude,
      kind: 'custom',
    },
  };
}

export function findExistingCustomSlot(
  customSlots: readonly LocationSlot[],
  place: GeocodingPlace,
): LocationSlot | null {
  if (
    typeof place.latitude !== 'number' ||
    !Number.isFinite(place.latitude) ||
    typeof place.longitude !== 'number' ||
    !Number.isFinite(place.longitude)
  ) {
    return null;
  }
  const id = buildCustomSlotId(
    Number(place.latitude.toFixed(CUSTOM_SLOT_COORD_PRECISION)),
    Number(place.longitude.toFixed(CUSTOM_SLOT_COORD_PRECISION)),
  );
  return customSlots.find((s) => s.id === id) ?? null;
}

export function canAddCustomSlot(customSlots: readonly LocationSlot[]): boolean {
  return customSlots.length < MAX_CUSTOM_SLOTS;
}

export type AddSlotResult =
  | { ok: true; slots: LocationSlot[] }
  | { ok: false; reason: 'capacity-full' | 'duplicate' };

export function addCustomSlot(
  customSlots: readonly LocationSlot[],
  slot: LocationSlot,
): AddSlotResult {
  if (customSlots.length >= MAX_CUSTOM_SLOTS) {
    return { ok: false, reason: 'capacity-full' };
  }
  if (customSlots.some((s) => s.id === slot.id)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, slots: [...customSlots, slot] };
}

export function removeCustomSlot(
  customSlots: readonly LocationSlot[],
  id: string,
): LocationSlot[] {
  return customSlots.filter((s) => s.id !== id);
}
