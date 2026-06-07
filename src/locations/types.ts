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
