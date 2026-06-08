/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_LOCATIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
