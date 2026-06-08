import { describe, expect, it } from 'vitest';
import { parseDefaultLocations } from './default-locations';

describe('parseDefaultLocations — missing input', () => {
  it.each([[undefined], [''], ['   ']])('rejects %o with kind:missing', (raw) => {
    const result = parseDefaultLocations(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('missing');
      expect(result.error.message).toContain('VITE_DEFAULT_LOCATIONS');
    }
  });
});

describe('parseDefaultLocations — invalid JSON', () => {
  it('rejects non-JSON text with kind:invalid-json', () => {
    const result = parseDefaultLocations('not json at all');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-json');
      expect(result.error.message.toLowerCase()).toContain('json');
    }
  });

  it('rejects truncated JSON with kind:invalid-json', () => {
    const result = parseDefaultLocations('[{"name":');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-json');
  });
});

describe('parseDefaultLocations — wrong top-level shape', () => {
  it('rejects a JSON object (not array) with kind:invalid-shape mentioning "array"', () => {
    const result = parseDefaultLocations('{"name":"x","lat":0,"lon":0}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('array');
    }
  });

  it('rejects a JSON primitive with kind:invalid-shape', () => {
    const result = parseDefaultLocations('"just a string"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-shape');
  });

  it('rejects an empty array with kind:invalid-shape mentioning "no entries"', () => {
    const result = parseDefaultLocations('[]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('no entries');
    }
  });
});

describe('parseDefaultLocations — invalid entry fields', () => {
  it('rejects entry missing name', () => {
    const result = parseDefaultLocations('[{"lat":0,"lon":0}]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('entry 0');
      expect(result.error.message).toContain('name');
    }
  });

  it('rejects entry with empty name after trim', () => {
    const result = parseDefaultLocations('[{"name":"   ","lat":0,"lon":0}]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('empty');
    }
  });

  it('rejects entry with non-number lat', () => {
    const result = parseDefaultLocations('[{"name":"X","lat":"oops","lon":0}]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('lat');
    }
  });

  it('rejects entry with out-of-range lat', () => {
    const result = parseDefaultLocations('[{"name":"X","lat":91,"lon":0}]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('range');
    }
  });

  it('rejects entry with out-of-range lon', () => {
    const result = parseDefaultLocations('[{"name":"X","lat":0,"lon":-181}]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('range');
    }
  });

  it('rejects entry with non-finite lat (Infinity / NaN are not valid JSON literals, but null parses)', () => {
    // JSON has no NaN/Infinity literal, but `null` is the common stand-in.
    const result = parseDefaultLocations('[{"name":"X","lat":null,"lon":0}]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('lat');
    }
  });

  it('rejects non-object entry (e.g., array element)', () => {
    const result = parseDefaultLocations('[42]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-shape');
      expect(result.error.message).toContain('entry 0');
    }
  });
});

describe('parseDefaultLocations — valid input', () => {
  it('parses a single valid entry into LocationSlot with id "default-0"', () => {
    const result = parseDefaultLocations('[{"name":"Sample","lat":1.5,"lon":-2.5}]');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: 'default-0',
        name: 'Sample',
        latitude: 1.5,
        longitude: -2.5,
        kind: 'default',
      });
    }
  });

  it('parses four valid entries with positional ids in input order and trims names', () => {
    const raw = JSON.stringify([
      { name: '  A  ', lat: 10, lon: 20 },
      { name: 'B', lat: -45.5, lon: 100 },
      { name: 'C', lat: 0, lon: 0 },
      { name: 'D', lat: 89.999, lon: -179.999 },
    ]);
    const result = parseDefaultLocations(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(4);
      expect(result.data.map((s) => s.id)).toEqual([
        'default-0',
        'default-1',
        'default-2',
        'default-3',
      ]);
      expect(result.data[0]?.name).toBe('A');
      expect(result.data[0]?.kind).toBe('default');
      expect(result.data[1]?.latitude).toBe(-45.5);
      expect(result.data[3]?.longitude).toBe(-179.999);
    }
  });

  it('ignores unknown extra fields on a valid entry (forward-compat)', () => {
    const result = parseDefaultLocations(
      '[{"name":"X","lat":0,"lon":0,"country":"DE","timezone":"Europe/Berlin"}]',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data[0] ?? {}).sort()).toEqual(
        ['id', 'kind', 'latitude', 'longitude', 'name'].sort(),
      );
    }
  });

  it('accepts boundary lat/lon values (±90, ±180)', () => {
    const raw = JSON.stringify([
      { name: 'NP', lat: 90, lon: 180 },
      { name: 'SP', lat: -90, lon: -180 },
    ]);
    const result = parseDefaultLocations(raw);
    expect(result.ok).toBe(true);
  });
});
