// Location and slot types.
//
// `default` slots are seeded at build time from `VITE_DEFAULT_LOCATIONS` (STORY-005);
// `custom` slots are user-added via geocoding autocomplete (STORY-008/009) and may
// be empty until the user picks something.
//
// Domain types only — no I/O, no UI concerns.

export interface Location {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export type LocationSlot =
  | { readonly kind: 'default'; readonly location: Location }
  | { readonly kind: 'custom'; readonly location: Location | null };
