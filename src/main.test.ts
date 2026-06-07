// Integration tests for `bootstrap()` — wires env parsing + Open-Meteo client
// + UI rendering. No real network: `fetchImpl` is stubbed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import lahtiFixture from './weather/__fixtures__/forecast-lahti.json' with { type: 'json' };
import { bootstrap } from './main';

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TWO_LOCATIONS = JSON.stringify([
  { name: 'Alpha', lat: 60, lon: 25 },
  { name: 'Beta', lat: 59, lon: 24 },
]);

const FOUR_LOCATIONS = JSON.stringify([
  { name: 'A', lat: 60, lon: 25 },
  { name: 'B', lat: 59, lon: 24 },
  { name: 'C', lat: 58, lon: 23 },
  { name: 'D', lat: 57, lon: 22 },
]);

describe('bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one card per parsed location, with per-slot isolation on failure', async () => {
    const root = document.createElement('div');

    // Alpha → 200 OK with fixture; Beta → 404 → forecast=null.
    // (404 is in the 4xx range and is never retried by the client, keeping
    // the test fast — see open-meteo-client.ts retry policy.)
    const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('latitude=60')) {
        return makeResponse(200, lahtiFixture);
      }
      return makeResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;

    await bootstrap(root, { rawEnv: TWO_LOCATIONS, fetchImpl });

    const cards = root.querySelectorAll('main.list button.card');
    expect(cards.length).toBe(2);

    const names = Array.from(root.querySelectorAll('.card-name')).map((n) => n.textContent);
    expect(names).toEqual(['Alpha', 'Beta']);

    // Alpha has a full forecast → temp + meta render.
    const alphaCard = cards[0];
    expect(alphaCard?.querySelector('.card-temp')?.textContent).toMatch(/^-?\d+°$/);

    // Beta failed → "Unavailable" state.
    const betaCard = cards[1];
    expect(betaCard?.textContent).toContain('Unavailable');
    expect(betaCard?.querySelector('.card-temp')).toBeNull();
  });

  it('logs an error and renders zero cards when env is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, { rawEnv: undefined, fetchImpl });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/VITE_DEFAULT_LOCATIONS/);
    expect(message).toMatch(/missing/);

    // App still rendered (header + footer present), just no cards.
    expect(root.querySelector('.app-header')).not.toBeNull();
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
    expect(root.querySelectorAll('main.list button.card').length).toBe(0);

    // No fetch calls were made.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('logs an error and renders zero cards when env JSON is malformed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, { rawEnv: 'not-json', fetchImpl });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/malformed-json/);
    expect(root.querySelectorAll('main.list button.card').length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('renders zero cards and makes no fetches for an empty array env', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, { rawEnv: '[]', fetchImpl });

    expect(root.querySelectorAll('main.list button.card').length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    // Header + footer (attribution) still render — empty list is a normal state.
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
  });

  it('fetches once per location and renders 4 cards on full success', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    await bootstrap(root, { rawEnv: FOUR_LOCATIONS, fetchImpl });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
    expect(root.querySelectorAll('main.list button.card').length).toBe(4);
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
  });
});
