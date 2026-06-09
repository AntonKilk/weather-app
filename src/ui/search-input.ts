import type { GeocodingResult } from '../locations/geocoding-client';
import type { GeocodingPlace } from '../locations/types';

// Vanilla-DOM autocomplete component for the geocoding search.
// Takes its network function via deps so the UI layer doesn't depend on the
// `locations/` network client directly — `main.ts` wires the two together.
//
// Per CLAUDE.md › Security: all API-sourced strings are rendered via
// `textContent`, never innerHTML.

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MIN_QUERY_LENGTH = 2;

export interface SearchInputDeps {
  searchGeocoding: (query: string, signal: AbortSignal) => Promise<GeocodingResult>;
  onSelect: (place: GeocodingPlace) => void;
  isOnline?: () => boolean;
  debounceMs?: number;
  minQueryLength?: number;
}

export function renderSearchInput(deps: SearchInputDeps): HTMLElement {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const minQueryLength = deps.minQueryLength ?? DEFAULT_MIN_QUERY_LENGTH;
  const isOnline =
    deps.isOnline ??
    ((): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  const wrapper = document.createElement('section');
  wrapper.className = 'search-input';
  wrapper.setAttribute('aria-label', 'Search for a location');

  const field = document.createElement('input');
  field.className = 'search-input__field';
  field.type = 'search';
  field.autocomplete = 'off';
  field.placeholder = 'Search city or place…';
  field.setAttribute('aria-autocomplete', 'list');

  const status = document.createElement('p');
  status.className = 'search-input__status';
  status.hidden = true;

  const list = document.createElement('ul');
  list.className = 'search-input__list';
  list.hidden = true;
  list.setAttribute('role', 'listbox');

  wrapper.append(field, status, list);

  let currentResults: GeocodingPlace[] = [];
  let controller: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Monotonic counter — bail out if a newer keystroke has already started a
  // newer query (defence-in-depth alongside AbortController).
  let queryId = 0;

  function setStatus(text: string | null): void {
    if (text === null) {
      status.hidden = true;
      status.textContent = '';
    } else {
      status.textContent = text;
      status.hidden = false;
    }
  }

  function setOptions(places: GeocodingPlace[]): void {
    currentResults = places;
    list.replaceChildren();
    if (places.length === 0) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    places.forEach((place, idx) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-input__option';
      button.dataset.optionIndex = String(idx);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'search-input__option-name';
      nameSpan.textContent = place.name;
      button.append(nameSpan);

      const metaText = [place.admin1, place.country]
        .filter((s): s is string => typeof s === 'string' && s !== '')
        .join(', ');
      if (metaText !== '') {
        const metaSpan = document.createElement('span');
        metaSpan.className = 'search-input__option-meta';
        metaSpan.textContent = metaText;
        button.append(metaSpan);
      }

      li.append(button);
      list.append(li);
    });
  }

  function cancelInFlight(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (controller !== null) {
      controller.abort();
      controller = null;
    }
  }

  field.addEventListener('input', () => {
    const trimmed = field.value.trim();
    cancelInFlight();

    if (trimmed.length < minQueryLength) {
      setOptions([]);
      setStatus(null);
      return;
    }

    if (!isOnline()) {
      setOptions([]);
      setStatus('Search needs a connection');
      return;
    }

    setOptions([]);
    setStatus('Searching…');
    const id = ++queryId;
    debounceTimer = setTimeout(() => {
      const localController = new AbortController();
      controller = localController;
      void deps.searchGeocoding(trimmed, localController.signal).then((result) => {
        // Bail if a newer query has overtaken us.
        if (id !== queryId) return;
        if (!result.ok) {
          if (result.error.kind === 'aborted') return;
          // CLAUDE.md › Observability: log at the boundary, never leak raw
          // error text into the UI.
          console.warn('[geocoding] search failed', trimmed, result.error);
          setOptions([]);
          setStatus('Search unavailable, try again');
          return;
        }
        if (result.data.length === 0) {
          setOptions([]);
          setStatus('No results');
          return;
        }
        setOptions(result.data);
        setStatus(null);
      });
    }, debounceMs);
  });

  list.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('.search-input__option');
    if (button === null || !list.contains(button)) return;
    const idxStr = button.dataset.optionIndex;
    if (idxStr === undefined) return;
    const idx = Number(idxStr);
    const place = currentResults[idx];
    if (place === undefined) return;
    console.info('[geocoding] selected', place.name);
    deps.onSelect(place);
    field.value = '';
    cancelInFlight();
    setOptions([]);
    setStatus(null);
  });

  return wrapper;
}
