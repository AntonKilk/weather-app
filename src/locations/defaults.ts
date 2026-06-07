// Mock default locations for the Phase-1 UI skeleton (STORY-002).
//
// These are PUBLIC city coordinates used only as placeholders so we can demo the
// visual without hitting the real API. STORY-005 replaces this with values read
// from `VITE_DEFAULT_LOCATIONS` at build time (kept out of the repo).
// Do NOT commit the owner's actual default-location list here.

import type { Location } from './types';

export const MOCK_DEFAULT_LOCATIONS: ReadonlyArray<Location> = [
  { name: 'Lahti', lat: 60.98, lon: 25.66 },
  { name: 'Helsinki', lat: 60.17, lon: 24.94 },
  { name: 'Tallinn', lat: 59.44, lon: 24.75 },
  { name: 'Käsmu', lat: 59.6, lon: 25.92 },
];
