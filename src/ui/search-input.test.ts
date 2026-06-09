import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeocodingResult } from '../locations/geocoding-client';
import type { GeocodingPlace } from '../locations/types';
import { renderSearchInput, type SearchInputDeps } from './search-input';

type SearchFn = SearchInputDeps['searchGeocoding'];

const HELSINKI: GeocodingPlace = {
  name: 'Helsinki',
  latitude: 60.17,
  longitude: 24.94,
  country: 'Finland',
  admin1: 'Uusimaa',
};

function ok(data: GeocodingPlace[]): GeocodingResult {
  return { ok: true, data };
}

function setValueAndInput(field: HTMLInputElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('input'));
}

async function flushMicrotasks(): Promise<void> {
  // Resolves after pending microtasks (.then callbacks queued by the debounce
  // timer firing). Using real timer here is fine — it queues to the next tick.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderSearchInput — structure', () => {
  it('renders one input field and an empty list + status', () => {
    const search = vi.fn<SearchFn>(async () => ok([]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field');
    expect(field).not.toBeNull();
    expect(field!.type).toBe('search');
    expect(field!.autocomplete).toBe('off');
    expect(wrapper.querySelector<HTMLElement>('.search-input__list')!.hidden).toBe(true);
    expect(wrapper.querySelector<HTMLElement>('.search-input__status')!.hidden).toBe(true);
  });
});

describe('renderSearchInput — query length gating', () => {
  it('does NOT call searchGeocoding when the query is shorter than minQueryLength', async () => {
    const search = vi.fn<SearchFn>(async () => ok([HELSINKI]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'a');
    await vi.advanceTimersByTimeAsync(500);
    expect(search).not.toHaveBeenCalled();
  });

  it('treats whitespace-only input as too short', async () => {
    const search = vi.fn<SearchFn>(async () => ok([HELSINKI]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, '   ');
    await vi.advanceTimersByTimeAsync(500);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('renderSearchInput — debounce', () => {
  it('fires the search after exactly debounceMs (default 300)', async () => {
    const search = vi.fn<SearchFn>(async () => ok([HELSINKI]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'He');
    await vi.advanceTimersByTimeAsync(299);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![0]).toBe('He');
    expect(search.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it('cancels the previous in-flight request on the next keystroke', async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (v: GeocodingResult) => void;
    const firstPromise = new Promise<GeocodingResult>((res) => {
      resolveFirst = res;
    });
    const search = vi.fn<SearchFn>(async (_query, signal) => {
      signals.push(signal);
      if (signals.length === 1) return firstPromise;
      return ok([HELSINKI]);
    });
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;

    setValueAndInput(field, 'He');
    await vi.advanceTimersByTimeAsync(300);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    setValueAndInput(field, 'Hel');
    expect(signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(signals).toHaveLength(2);

    // Resolve the first (now-aborted) request — UI must not render its
    // results because a newer query has started.
    resolveFirst!(ok([{ name: 'STALE', latitude: 0, longitude: 0 }]));
    await flushMicrotasks();
    const list = wrapper.querySelector<HTMLElement>('.search-input__list')!;
    expect(list.textContent ?? '').not.toContain('STALE');
  });
});

describe('renderSearchInput — render states', () => {
  it('renders suggestions with name + meta (admin1, country)', async () => {
    const search = vi.fn<SearchFn>(async () => ok([HELSINKI]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'Hels');
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    const list = wrapper.querySelector<HTMLElement>('.search-input__list')!;
    expect(list.hidden).toBe(false);
    const options = list.querySelectorAll<HTMLButtonElement>('.search-input__option');
    expect(options.length).toBe(1);
    const opt = options[0]!;
    expect(opt.querySelector('.search-input__option-name')!.textContent).toBe('Helsinki');
    expect(opt.querySelector('.search-input__option-meta')!.textContent).toBe('Uusimaa, Finland');
  });

  it('omits the meta span gracefully when country/admin1 are missing', async () => {
    const search = vi.fn<SearchFn>(async () =>
      ok([{ name: 'Nowhere', latitude: 0, longitude: 0 }]),
    );
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'Nowhere');
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    const opt = wrapper.querySelector<HTMLButtonElement>('.search-input__option')!;
    expect(opt.querySelector('.search-input__option-name')!.textContent).toBe('Nowhere');
    expect(opt.querySelector('.search-input__option-meta')).toBeNull();
  });

  it('shows "No results" status when the API returns an empty array', async () => {
    const search = vi.fn<SearchFn>(async () => ok([]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'zzzz');
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    const status = wrapper.querySelector<HTMLElement>('.search-input__status')!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('No results');
    expect(wrapper.querySelector<HTMLElement>('.search-input__list')!.hidden).toBe(true);
  });

  it('shows a generic error status for network/timeout/server/parse errors (no raw error text)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const search = vi.fn<SearchFn>(async () => ({
      ok: false,
      error: { kind: 'network', message: 'Failed to fetch' },
    }));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'Hels');
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    const status = wrapper.querySelector<HTMLElement>('.search-input__status')!;
    expect(status.textContent).toBe('Search unavailable, try again');
    expect(status.textContent ?? '').not.toContain('Failed to fetch');
    expect(warn).toHaveBeenCalled();
  });

  it('treats kind:aborted as silent — does NOT replace the prior status with an error', async () => {
    const search = vi.fn<SearchFn>(async () => ({
      ok: false,
      error: { kind: 'aborted', message: 'cancelled' },
    }));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'Hels');
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    const status = wrapper.querySelector<HTMLElement>('.search-input__status')!;
    expect(status.textContent ?? '').not.toContain('Search unavailable');
    expect(status.textContent ?? '').not.toContain('No results');
  });

  it('shows "Search needs a connection" when offline; does NOT call searchGeocoding', async () => {
    const search = vi.fn<SearchFn>(async () => ok([HELSINKI]));
    const wrapper = renderSearchInput({
      searchGeocoding: search,
      onSelect: () => {},
      isOnline: () => false,
    });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'Hels');
    await vi.advanceTimersByTimeAsync(500);

    expect(search).not.toHaveBeenCalled();
    const status = wrapper.querySelector<HTMLElement>('.search-input__status')!;
    expect(status.textContent).toBe('Search needs a connection');
  });
});

describe('renderSearchInput — selection', () => {
  it('fires onSelect with the chosen place, then clears input + list', async () => {
    const onSelect = vi.fn<(place: GeocodingPlace) => void>();
    const search = vi.fn<SearchFn>(async () => ok([HELSINKI]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'Hels');
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    const option = wrapper.querySelector<HTMLButtonElement>('.search-input__option')!;
    option.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toEqual(HELSINKI);
    expect(field.value).toBe('');
    expect(wrapper.querySelector<HTMLElement>('.search-input__list')!.hidden).toBe(true);
  });
});

describe('renderSearchInput — XSS safety', () => {
  it('renders an API-supplied <script> tag as inert text, never as live HTML', async () => {
    const malicious: GeocodingPlace = {
      name: '<script>alert(1)</script>',
      latitude: 0,
      longitude: 0,
      country: '<img src=x onerror=1>',
    };
    const search = vi.fn<SearchFn>(async () => ok([malicious]));
    const wrapper = renderSearchInput({ searchGeocoding: search, onSelect: () => {} });
    document.body.append(wrapper);
    const field = wrapper.querySelector<HTMLInputElement>('.search-input__field')!;
    setValueAndInput(field, 'X<script>');
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    expect(wrapper.querySelector('script')).toBeNull();
    expect(wrapper.querySelector('img')).toBeNull();
    expect(wrapper.outerHTML).toContain('&lt;script&gt;');
    const nameSpan = wrapper.querySelector<HTMLElement>('.search-input__option-name')!;
    expect(nameSpan.textContent).toBe('<script>alert(1)</script>');
  });
});
