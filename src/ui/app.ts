// Top-level app shell: list ↔ detail navigation.
//
// No router. Two views are rendered into `root` based on local state:
//   - list view: header + cards + footer attribution
//   - detail view: built lazily when a card is tapped
// `root.replaceChildren` swaps the whole subtree — keeps it simple and avoids
// any leak from stale event listeners.

import type { LocationSlot } from '../locations/types';
import type { OpenMeteoForecast } from '../weather/types';
import { renderLocationCard } from './card';
import { renderLocationDetail } from './detail';

export interface AppItem {
  readonly slot: LocationSlot;
  readonly forecast: OpenMeteoForecast | null;
}

export interface RenderAppOptions {
  /**
   * Optional "Updated N ago" stamp rendered in the list view header. The
   * caller computes this string from the oldest `fetchedAt` across slots
   * (see `src/storage/freshness.ts`). When omitted/empty, no stamp is
   * rendered — the header stays clean.
   */
  readonly lastUpdatedLabel?: string;
}

export function renderApp(
  root: HTMLElement,
  items: ReadonlyArray<AppItem>,
  opts: RenderAppOptions = {},
): void {
  function showList(): void {
    root.replaceChildren(buildListView(items, opts, showDetailFor));
  }

  function showDetailFor(index: number): void {
    const item = items[index];
    if (item === undefined || item.slot.location === null || item.forecast === null) {
      // Nothing to show — stay on the list. (Empty / unavailable slots have no
      // detail content in Phase 1; future stories may expand this.)
      showList();
      return;
    }
    root.replaceChildren(
      renderLocationDetail({ slot: item.slot, forecast: item.forecast }, showList),
    );
  }

  showList();
}

function buildListView(
  items: ReadonlyArray<AppItem>,
  opts: RenderAppOptions,
  onTap: (index: number) => void,
): HTMLElement {
  const view = document.createElement('div');
  view.className = 'list-view';

  const header = document.createElement('header');
  header.className = 'app-header';
  const title = document.createElement('h1');
  title.textContent = 'Weather';
  header.appendChild(title);

  // CLAUDE.md > Error handling: "Showing stale data" is a normal state. The
  // freshness stamp is a quiet indicator, not an error overlay.
  const label = opts.lastUpdatedLabel;
  if (typeof label === 'string' && label.length > 0) {
    const stamp = document.createElement('p');
    stamp.className = 'last-updated';
    stamp.textContent = label;
    header.appendChild(stamp);
  }

  view.appendChild(header);

  const main = document.createElement('main');
  main.className = 'list';
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item === undefined) continue; // noUncheckedIndexedAccess guard
    const index = i;
    const card = renderLocationCard(item, () => onTap(index));
    main.appendChild(card);
  }
  view.appendChild(main);

  view.appendChild(buildFooter());
  return view;
}

function buildFooter(): HTMLElement {
  // CC-BY 4.0 attribution — Open-Meteo license requirement (CLAUDE.md › Notes).
  const footer = document.createElement('footer');
  footer.className = 'app-footer';

  const link = document.createElement('a');
  link.href = 'https://open-meteo.com/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Weather data by Open-Meteo';
  footer.appendChild(link);

  return footer;
}
