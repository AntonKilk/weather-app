import type { LocationSlot } from './types';

// Parses the build-time env var VITE_DEFAULT_LOCATIONS into a typed
// LocationSlot[]. Pure: it does not read import.meta.env, log, or throw —
// main.ts wires the env read and decides how to react to a failure
// (console.error + empty state, per CLAUDE.md › Error handling).
//
// Result type is defined locally so `locations/` stays independent of
// `weather/` — peer domain modules do not cross-import (CLAUDE.md ›
// Architecture).

export type ParseError =
  | { kind: 'missing'; message: string }
  | { kind: 'invalid-json'; message: string }
  | { kind: 'invalid-shape'; message: string };

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ParseError };

export function parseDefaultLocations(raw: string | undefined): ParseResult<LocationSlot[]> {
  if (raw === undefined || raw.trim() === '') {
    return {
      ok: false,
      error: { kind: 'missing', message: 'VITE_DEFAULT_LOCATIONS is not set' },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown JSON error';
    return {
      ok: false,
      error: { kind: 'invalid-json', message: `VITE_DEFAULT_LOCATIONS is not valid JSON: ${message}` },
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: 'VITE_DEFAULT_LOCATIONS must be a JSON array' },
    };
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: 'VITE_DEFAULT_LOCATIONS has no entries' },
    };
  }

  const slots: LocationSlot[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const entryResult = parseEntry(parsed[index], index);
    if (!entryResult.ok) {
      return entryResult;
    }
    slots.push(entryResult.data);
  }

  return { ok: true, data: slots };
}

function parseEntry(raw: unknown, index: number): ParseResult<LocationSlot> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: `entry ${index}: must be a JSON object` },
    };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== 'string') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: `entry ${index}: name must be a string` },
    };
  }
  const name = r.name.trim();
  if (name === '') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: `entry ${index}: name is empty` },
    };
  }

  if (typeof r.lat !== 'number' || !Number.isFinite(r.lat)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: `entry ${index}: lat must be a finite number` },
    };
  }
  if (r.lat < -90 || r.lat > 90) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: `entry ${index}: lat out of range [-90, 90]` },
    };
  }

  if (typeof r.lon !== 'number' || !Number.isFinite(r.lon)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: `entry ${index}: lon must be a finite number` },
    };
  }
  if (r.lon < -180 || r.lon > 180) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', message: `entry ${index}: lon out of range [-180, 180]` },
    };
  }

  return {
    ok: true,
    data: {
      id: `default-${index}`,
      name,
      latitude: r.lat,
      longitude: r.lon,
      kind: 'default',
    },
  };
}
