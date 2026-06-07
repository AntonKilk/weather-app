// Tests for the location search widget — jsdom + Vitest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  GeocodingFetchResult,
  GeocodingResult,
  LocationSelection,
} from '../locations/types';
import { createLocationSearchWidget } from './location-search';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HELSINKI_ROW: GeocodingResult = {
  name: 'Helsinki',
  latitude: 60.16952,
  longitude: 24.93545,
  country: 'Finland',
  admin1: 'Uusimaa',
  country_code: 'FI',
};

const TALLINN_ROW: GeocodingResult = {
  name: 'Tallinn',
  latitude: 59.43696,
  longitude: 24.75353,
  country: 'Estonia',
  admin1: 'Harjumaa',
  country_code: 'EE',
};

function okResult(rows: GeocodingResult[]): GeocodingFetchResult {
  return { ok: true, data: { results: rows } };
}

interface WidgetHarness {
  selections: LocationSelection[];
  widget: ReturnType<typeof createLocationSearchWidget>;
  input: HTMLInputElement;
  list: HTMLUListElement;
  status: HTMLDivElement;
}

function mount(
  resolver: (q: string) => Promise<GeocodingFetchResult>,
  opts: { isOnline?: () => boolean } = {},
): WidgetHarness {
  const selections: LocationSelection[] = [];
  const widget = createLocationSearchWidget({
    onSelect: (sel) => {
      selections.push(sel);
    },
    debounceMs: 300,
    isOnline: opts.isOnline,
    search: async (q) => await resolver(q),
  });
  document.body.append(widget.element);

  const input = widget.element.querySelector<HTMLInputElement>('input');
  const list = widget.element.querySelector<HTMLUListElement>('ul');
  const status = widget.element.querySelector<HTMLDivElement>('.location-search__status');
  if (input === null || list === null || status === null) {
    throw new Error('widget DOM missing expected nodes');
  }
  return { selections, widget, input, list, status };
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// 1. ≥2 chars → search → suggestions rendered
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — typing triggers search', () => {
  it('renders suggestions after a ≥2-char input + debounce', async () => {
    const h = mount(async () => okResult([HELSINKI_ROW, TALLINN_ROW]));

    typeInto(h.input, 'Hel');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    const items = h.list.querySelectorAll('li.location-search__suggestion');
    expect(items.length).toBe(2);
    const first = items[0];
    expect(first?.querySelector('.location-search__suggestion-name')?.textContent).toBe('Helsinki');
    expect(
      first?.querySelector('.location-search__suggestion-region')?.textContent,
    ).toBe('Uusimaa, Finland');
  });
});

// ---------------------------------------------------------------------------
// 2. XSS-safe rendering (AC5)
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — textContent only (AC5)', () => {
  it('renders a malicious name as text, not as parsed HTML', async () => {
    const evilRow: GeocodingResult = {
      name: '<img src=x onerror="window.__pwned=true">',
      latitude: 1,
      longitude: 2,
      country: '<b>X</b>',
      admin1: '<script>alert(1)</script>',
    };
    const h = mount(async () => okResult([evilRow]));

    typeInto(h.input, 'evil');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    const li = h.list.querySelector<HTMLLIElement>('li.location-search__suggestion');
    expect(li).not.toBeNull();
    if (li === null) return;

    const nameSpan = li.querySelector<HTMLSpanElement>('.location-search__suggestion-name');
    const regionSpan = li.querySelector<HTMLSpanElement>('.location-search__suggestion-region');

    // textContent preserves the raw, unparsed string.
    expect(nameSpan?.textContent).toBe('<img src=x onerror="window.__pwned=true">');
    expect(regionSpan?.textContent).toBe(
      '<script>alert(1)</script>, <b>X</b>',
    );

    // The DOM contains ZERO image / script / bold elements anywhere in the widget root.
    expect(h.widget.element.querySelector('img')).toBeNull();
    expect(h.widget.element.querySelector('script')).toBeNull();
    expect(h.widget.element.querySelector('b')).toBeNull();

    // innerHTML on the name span shows the escaped form (no parsed tags).
    if (nameSpan !== null) {
      // jsdom's innerHTML serialiser escapes the `<` properly.
      expect(nameSpan.innerHTML).not.toContain('<img');
      expect(nameSpan.innerHTML).toContain('&lt;img');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. No results (AC3)
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — empty results (AC3)', () => {
  it('renders "No results" and clears the list', async () => {
    const h = mount(async () => okResult([]));

    typeInto(h.input, 'xyzzy');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.status.textContent).toBe('No results');
    expect(h.list.querySelectorAll('li').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Offline (AC4)
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — offline state (AC4)', () => {
  it('renders "Search needs a connection" when network fails and isOnline=false', async () => {
    const h = mount(
      async () => ({ ok: false, error: { kind: 'network', message: 'fetch failed' } }),
      { isOnline: () => false },
    );

    typeInto(h.input, 'Hel');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.status.textContent).toBe('Search needs a connection');
    expect(h.list.querySelectorAll('li').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Other errors → generic copy (no leak)
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — generic error', () => {
  it('renders "Something went wrong" for timeout and HTTP errors', async () => {
    const h = mount(async () => ({ ok: false, error: { kind: 'timeout' } }));

    typeInto(h.input, 'Hel');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.status.textContent).toBe('Something went wrong');
    expect(h.list.querySelectorAll('li').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Selection emits exactly { name, lat, lon } (AC6)
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — selection callback (AC6)', () => {
  it('clicking a suggestion calls onSelect with exactly { name, lat, lon }', async () => {
    const h = mount(async () => okResult([HELSINKI_ROW, TALLINN_ROW]));

    typeInto(h.input, 'Hel');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    const second = h.list.querySelectorAll<HTMLLIElement>('li.location-search__suggestion')[1];
    expect(second).toBeDefined();
    second?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(h.selections).toHaveLength(1);
    const sel = h.selections[0];
    expect(sel).toBeDefined();
    if (sel) {
      expect(Object.keys(sel).sort()).toEqual(['lat', 'lon', 'name']);
      expect(sel.name).toBe('Tallinn');
      expect(sel.lat).toBeCloseTo(59.43696, 5);
      expect(sel.lon).toBeCloseTo(24.75353, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Clearing the input resets the widget
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — clearing input', () => {
  it('clearing the input empties the suggestion list and status', async () => {
    const h = mount(async () => okResult([HELSINKI_ROW]));

    typeInto(h.input, 'Hel');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();
    expect(h.list.querySelectorAll('li').length).toBe(1);

    typeInto(h.input, '');
    expect(h.status.textContent).toBe('');
    expect(h.list.querySelectorAll('li').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. destroy() detaches listeners
// ---------------------------------------------------------------------------

describe('LocationSearchWidget — destroy', () => {
  it('after destroy(), further input events do not trigger search', async () => {
    const searchSpy = vi.fn(async () => okResult([HELSINKI_ROW]));
    const widget = createLocationSearchWidget({
      onSelect: () => {},
      debounceMs: 300,
      search: searchSpy,
    });
    document.body.append(widget.element);
    const input = widget.element.querySelector<HTMLInputElement>('input');
    if (input === null) throw new Error('input missing');

    widget.destroy();
    typeInto(input, 'Helsinki');
    await vi.advanceTimersByTimeAsync(1000);

    expect(searchSpy).not.toHaveBeenCalled();
  });
});
