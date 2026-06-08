import { describe, expect, it } from 'vitest';
import { renderFooter } from './footer';

describe('renderFooter', () => {
  it('returns a <footer> with class app-footer', () => {
    const footer = renderFooter();
    expect(footer.tagName).toBe('FOOTER');
    expect(footer.className).toBe('app-footer');
  });

  it('contains exactly one anchor with the attribution text', () => {
    const footer = renderFooter();
    const links = footer.querySelectorAll('a');
    expect(links.length).toBe(1);
    expect(links[0]?.textContent).toBe('Weather data by Open-Meteo');
  });

  it('links to open-meteo.com with target=_blank and a safe rel', () => {
    const link = renderFooter().querySelector<HTMLAnchorElement>('a.app-footer__link');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://open-meteo.com/');
    expect(link!.target).toBe('_blank');
    expect(link!.rel).toContain('noopener');
    expect(link!.rel).toContain('noreferrer');
  });

  it('does not inject any <script> content (regression guard against innerHTML drift)', () => {
    const footer = renderFooter();
    expect(footer.querySelector('script')).toBeNull();
  });
});
