/// <reference types="vite/client" />

import type { TiboWatchApi } from '../shared/api';

declare global {
  interface Window {
    tiboWatch?: TiboWatchApi;
  }
}

export {};
