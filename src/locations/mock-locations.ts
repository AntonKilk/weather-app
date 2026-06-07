import type { LocationSlot } from './types';

// Placeholder location slots for the Phase-1 UI skeleton.
// STORY-005 replaces these with real defaults injected from VITE_DEFAULT_LOCATIONS
// at build time. Real city names must NOT be committed (CLAUDE.md → Security).

export const MOCK_LOCATIONS: LocationSlot[] = [
  { id: 'mock-1', name: 'Sample City A', latitude: 0, longitude: 0, kind: 'default' },
  { id: 'mock-2', name: 'Sample City B', latitude: 0, longitude: 0, kind: 'default' },
  { id: 'mock-3', name: 'Sample Town C', latitude: 0, longitude: 0, kind: 'default' },
  { id: 'mock-4', name: 'Sample Town D', latitude: 0, longitude: 0, kind: 'default' },
];
