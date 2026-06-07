/// <reference types="vite/client" />

// Augment `import.meta.env` with the project's own build-time env vars.
//
// `VITE_DEFAULT_LOCATIONS` is the JSON string declaring the four default
// location slots (see `.env.example` for the contract, and `.env.local` for
// the owner's actual list — never committed). Parsing + validation lives in
// `src/locations/env.ts` so the rest of the app can rely on a typed result.
//
// Marked `readonly ... | undefined`: when the var is missing at build time,
// Vite inlines `undefined`, and the parser distinguishes "missing" from
// "malformed" so the UI can surface a friendly empty state rather than crash.

interface ImportMetaEnv {
  readonly VITE_DEFAULT_LOCATIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
