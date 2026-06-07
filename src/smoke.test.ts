import { describe, expect, it } from 'vitest';

// Smoke test — proves Vitest + jsdom + TS pipeline is wired up.
// Real domain tests land alongside their modules in later stories.
describe('scaffold smoke', () => {
  it('runs arithmetic (Vitest is alive)', () => {
    expect(1 + 1).toBe(2);
  });

  it('renders into a jsdom document with textContent (DOM env wired)', () => {
    const el = document.createElement('div');
    el.textContent = 'hello';
    expect(el.textContent).toBe('hello');
    expect(el.innerHTML).toBe('hello'); // textContent escaped path — no HTML parsing
  });
});
