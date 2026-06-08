// CC-BY 4.0 attribution footer for Open-Meteo. License requirement, not
// optional (CLAUDE.md › Notes). Rendered as plain DOM with textContent —
// no innerHTML, no API-sourced strings.

export function renderFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'app-footer';

  const link = document.createElement('a');
  link.className = 'app-footer__link';
  link.href = 'https://open-meteo.com/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Weather data by Open-Meteo';

  footer.appendChild(link);
  return footer;
}
