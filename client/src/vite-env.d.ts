/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" when the app runs fully in the browser (GitHub Pages / static hosting). */
  readonly VITE_LOCAL_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
