// Tests for `parseDefaultLocations` — the env-boundary validator.
//
// Covers the contract documented in env.ts: missing, malformed JSON,
// invalid root shape, per-entry validation (name / lat / lon).

import { describe, expect, it } from 'vitest';
import { parseDefaultLocations } from './env';

function expectErr(
  result: ReturnType<typeof parseDefaultLocations>,
): { kind: string; message: string } {
  if (result.ok) {
    throw new Error(`expected error, got ok with ${result.locations.length} locations`);
  }
  return { kind: result.error.kind, message: result.error.message };
}

describe('parseDefaultLocations', () => {
  describe('missing', () => {
    it('returns missing for undefined', () => {
      const err = expectErr(parseDefaultLocations(undefined));
      expect(err.kind).toBe('missing');
      expect(err.message).toMatch(/not set/);
    });

    it('returns missing for empty string', () => {
      const err = expectErr(parseDefaultLocations(''));
      expect(err.kind).toBe('missing');
    });

    it('returns missing for whitespace-only', () => {
      const err = expectErr(parseDefaultLocations('   \n\t  '));
      expect(err.kind).toBe('missing');
    });
  });

  describe('malformed JSON', () => {
    it('flags trailing comma', () => {
      const err = expectErr(parseDefaultLocations('[{"name":"X","lat":1,"lon":2},]'));
      expect(err.kind).toBe('malformed-json');
      expect(err.message).toMatch(/not valid JSON/);
    });

    it('flags non-JSON garbage', () => {
      const err = expectErr(parseDefaultLocations('not-json-at-all'));
      expect(err.kind).toBe('malformed-json');
    });
  });

  describe('invalid root shape', () => {
    it('rejects a top-level object', () => {
      const err = expectErr(parseDefaultLocations('{"name":"X","lat":1,"lon":2}'));
      expect(err.kind).toBe('invalid-shape');
      expect(err.message).toMatch(/array/);
    });

    it('rejects a top-level number', () => {
      const err = expectErr(parseDefaultLocations('42'));
      expect(err.kind).toBe('invalid-shape');
    });

    it('rejects a top-level string', () => {
      const err = expectErr(parseDefaultLocations('"hello"'));
      expect(err.kind).toBe('invalid-shape');
    });

    it('rejects a top-level null', () => {
      const err = expectErr(parseDefaultLocations('null'));
      expect(err.kind).toBe('invalid-shape');
    });
  });

  describe('invalid entry', () => {
    it('rejects non-object entry', () => {
      const err = expectErr(parseDefaultLocations('[42]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/entry\[0\]/);
      expect(err.message).toMatch(/JSON object/);
    });

    it('rejects null entry', () => {
      const err = expectErr(parseDefaultLocations('[null]'));
      expect(err.kind).toBe('invalid-entry');
    });

    it('rejects missing name', () => {
      const err = expectErr(parseDefaultLocations('[{"lat":1,"lon":2}]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/name/);
    });

    it('rejects empty name', () => {
      const err = expectErr(parseDefaultLocations('[{"name":"","lat":1,"lon":2}]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/name/);
    });

    it('rejects non-string name', () => {
      const err = expectErr(parseDefaultLocations('[{"name":7,"lat":1,"lon":2}]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/name/);
    });

    it('rejects non-numeric lat', () => {
      const err = expectErr(parseDefaultLocations('[{"name":"X","lat":"1","lon":2}]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/lat/);
    });

    it('rejects NaN lat (sent as null in JSON)', () => {
      // NaN can't survive JSON; the more realistic bad value is `null`.
      const err = expectErr(parseDefaultLocations('[{"name":"X","lat":null,"lon":2}]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/lat/);
    });

    it('rejects lat out of range (high)', () => {
      const err = expectErr(parseDefaultLocations('[{"name":"X","lat":91,"lon":2}]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/lat/);
      expect(err.message).toMatch(/range/);
    });

    it('rejects lat out of range (low)', () => {
      const err = expectErr(parseDefaultLocations('[{"name":"X","lat":-91,"lon":2}]'));
      expect(err.kind).toBe('invalid-entry');
    });

    it('rejects lon out of range', () => {
      const err = expectErr(parseDefaultLocations('[{"name":"X","lat":1,"lon":181}]'));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/lon/);
    });

    it('reports the index of the bad entry', () => {
      const raw = JSON.stringify([
        { name: 'A', lat: 0, lon: 0 },
        { name: 'B', lat: 200, lon: 0 },
        { name: 'C', lat: 0, lon: 0 },
      ]);
      const err = expectErr(parseDefaultLocations(raw));
      expect(err.kind).toBe('invalid-entry');
      expect(err.message).toMatch(/entry\[1\]/);
    });
  });

  describe('happy path', () => {
    it('parses a 4-entry valid array', () => {
      const raw = JSON.stringify([
        { name: 'City One', lat: 10, lon: 20 },
        { name: 'City Two', lat: -10, lon: -20 },
        { name: 'City Three', lat: 0, lon: 0 },
        { name: 'City Four', lat: 60.5, lon: 25.5 },
      ]);
      const result = parseDefaultLocations(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.locations.length).toBe(4);
      expect(result.locations[0]).toEqual({ name: 'City One', lat: 10, lon: 20 });
      expect(result.locations[3]?.name).toBe('City Four');
    });

    it('allows an empty array (renders 0 cards rather than crashing)', () => {
      const result = parseDefaultLocations('[]');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.locations.length).toBe(0);
    });

    it('accepts boundary latitudes (-90, 90) and longitudes (-180, 180)', () => {
      const raw = JSON.stringify([
        { name: 'NP', lat: 90, lon: 180 },
        { name: 'SP', lat: -90, lon: -180 },
      ]);
      const result = parseDefaultLocations(raw);
      expect(result.ok).toBe(true);
    });

    it('ignores extra fields on entries (forward compatible)', () => {
      const raw = JSON.stringify([{ name: 'X', lat: 1, lon: 2, extra: 'ignored' }]);
      const result = parseDefaultLocations(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const first = result.locations[0];
      expect(first).toEqual({ name: 'X', lat: 1, lon: 2 });
      // No leakage of `extra` onto the typed Location.
      expect((first as unknown as Record<string, unknown>)['extra']).toBeUndefined();
    });

    it('tolerates surrounding whitespace', () => {
      const raw = '  [{"name":"X","lat":1,"lon":2}]  ';
      const result = parseDefaultLocations(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.locations.length).toBe(1);
    });
  });
});
