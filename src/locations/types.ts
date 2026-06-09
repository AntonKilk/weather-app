// A location slot rendered on the home screen.
// 'default' slots come from env at build time (STORY-005); 'custom' slots
// are user-added via geocoding autocomplete (STORY-008/009).

export interface LocationSlot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: 'default' | 'custom';
}

// A single hit from the Open-Meteo geocoding API. `country` and `admin1` are
// optional because the API omits them for some results. STORY-009 will lift
// this into a custom LocationSlot.

export interface GeocodingPlace {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}
