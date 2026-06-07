import type { LocationSlot } from '../locations/types';

export function renderDetailPlaceholder(slot: LocationSlot): HTMLElement {
  const section = document.createElement('section');
  section.className = 'detail-placeholder';
  section.id = `detail-${slot.id}`;
  section.hidden = true;
  section.setAttribute('aria-label', `${slot.name} detailed view`);

  const heading = document.createElement('p');
  heading.className = 'detail-placeholder__heading';
  heading.textContent = `${slot.name} — detailed view`;

  const note = document.createElement('p');
  note.className = 'detail-placeholder__note';
  note.textContent = 'Hourly chart and 7-day forecast coming in the next story.';

  section.append(heading, note);
  return section;
}
