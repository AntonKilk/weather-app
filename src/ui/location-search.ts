// Location search widget — the small DOM surface for STORY-008.
//
// Scope is intentionally minimal: an `<input>`, a status row, and a
// suggestions `<ul>`. STORY-002 owns the rest of the UI (cards, grid, global
// styles). This widget renders only what it needs to and uses inline style
// attributes for functional structure (block layout, no visual polish here).
//
// Security (CLAUDE.md › Security):
//   - API-sourced strings (location name / admin1 / country) are written
//     with `textContent` ONLY. We never call innerHTML for that data.
//   - Status copy is a fixed set of strings owned by this file. We never
//     surface a raw error from the API or the network.
//
// Accessibility:
//   - The input has type="search" and inputmode="search".
//   - The status div is role="status" aria-live="polite" so screen readers
//     announce "No results" and "Search needs a connection".
//   - The suggestions list is role="listbox" with role="option" children.
//   - Arrow Up/Down/Enter/Escape keyboard handling is OUT of scope for this
//     story (story #8 ACs only require click selection); leaves room for the
//     UI story to expand without conflict.

import { createGeocodingAutocomplete } from '../locations/geocoding-autocomplete';
import { searchLocations as defaultSearchLocations } from '../locations/open-meteo-geocoding-client';
import type {
  AutocompleteState,
  GeocodingResult,
  LocationSelection,
} from '../locations/types';

const STATUS_TEXT = {
  empty: 'No results',
  offline: 'Search needs a connection',
  error: 'Something went wrong',
} as const;

export interface LocationSearchWidgetOptions {
  /** Called when the user picks a suggestion. */
  onSelect(selection: LocationSelection): void;
  /** Override the search implementation — for tests. */
  search?: typeof defaultSearchLocations;
  /** Override debounce (~300 ms by default). */
  debounceMs?: number;
  /** Override the online check. */
  isOnline?: () => boolean;
}

export interface LocationSearchWidget {
  /** The root element to mount in the DOM. */
  readonly element: HTMLElement;
  /** Tear down listeners + controller. */
  destroy(): void;
}

export function createLocationSearchWidget(
  opts: LocationSearchWidgetOptions,
): LocationSearchWidget {
  const root = document.createElement('div');
  root.className = 'location-search';

  const label = document.createElement('label');
  label.className = 'location-search__label';
  label.textContent = 'Add a location';
  label.setAttribute('for', 'location-search-input');

  const input = document.createElement('input');
  input.id = 'location-search-input';
  input.className = 'location-search__input';
  input.type = 'search';
  input.placeholder = 'Search for a location';
  input.autocomplete = 'off';
  input.setAttribute('inputmode', 'search');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'location-search-suggestions');

  const status = document.createElement('div');
  status.className = 'location-search__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const list = document.createElement('ul');
  list.id = 'location-search-suggestions';
  list.className = 'location-search__suggestions';
  list.setAttribute('role', 'listbox');

  root.append(label, input, status, list);

  // Track the rows currently rendered so the click handler can map an
  // `<li>` back to the row it represents. Indices in this array align with
  // the children of `list`.
  let currentRows: readonly GeocodingResult[] = [];

  const controller = createGeocodingAutocomplete({
    onState: render,
    onSelect: (selection) => {
      opts.onSelect(selection);
    },
    ...(opts.search !== undefined ? { search: opts.search } : {}),
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
    ...(opts.isOnline !== undefined ? { isOnline: opts.isOnline } : {}),
  });

  function clearList(): void {
    while (list.firstChild !== null) {
      list.removeChild(list.firstChild);
    }
    currentRows = [];
  }

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function render(state: AutocompleteState): void {
    switch (state.kind) {
      case 'idle':
        setStatus('');
        clearList();
        return;
      case 'loading':
        // Keep the previous suggestions visible (avoids flicker on each
        // keystroke). Status row is cleared so stale "No results" / error
        // text doesn't linger.
        setStatus('');
        return;
      case 'empty':
        setStatus(STATUS_TEXT.empty);
        clearList();
        return;
      case 'offline':
        setStatus(STATUS_TEXT.offline);
        clearList();
        return;
      case 'error':
        setStatus(STATUS_TEXT.error);
        clearList();
        return;
      case 'results':
        setStatus('');
        renderResults(state.results);
        return;
    }
  }

  function renderResults(rows: readonly GeocodingResult[]): void {
    clearList();
    currentRows = rows;
    rows.forEach((row, index) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.className = 'location-search__suggestion';
      li.dataset['index'] = String(index);

      // Two-line display: primary name, secondary "admin1, country".
      const primary = document.createElement('span');
      primary.className = 'location-search__suggestion-name';
      // textContent — never innerHTML, regardless of what the API returned.
      primary.textContent = row.name;

      const secondary = document.createElement('span');
      secondary.className = 'location-search__suggestion-region';
      secondary.textContent = formatSecondary(row);

      li.append(primary);
      if (secondary.textContent !== '') {
        li.append(secondary);
      }
      list.append(li);
    });
  }

  function handleInput(): void {
    controller.query(input.value);
  }

  function handleListClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const li = target.closest('li.location-search__suggestion');
    if (li === null || !(li instanceof HTMLElement)) return;
    const raw = li.dataset['index'];
    if (raw === undefined) return;
    const index = Number.parseInt(raw, 10);
    if (!Number.isInteger(index)) return;
    const row = currentRows[index];
    if (row === undefined) return;
    controller.select(row);
  }

  input.addEventListener('input', handleInput);
  list.addEventListener('click', handleListClick);

  return {
    element: root,
    destroy(): void {
      input.removeEventListener('input', handleInput);
      list.removeEventListener('click', handleListClick);
      controller.destroy();
      clearList();
    },
  };
}

function formatSecondary(row: GeocodingResult): string {
  const parts: string[] = [];
  if (row.admin1 !== undefined && row.admin1.length > 0) parts.push(row.admin1);
  if (row.country !== undefined && row.country.length > 0) parts.push(row.country);
  return parts.join(', ');
}
