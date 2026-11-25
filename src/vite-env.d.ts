/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The hosted app share links point at (ShareButton); unset = this page. */
  readonly VITE_SHARE_BASE_URL?: string;
}
