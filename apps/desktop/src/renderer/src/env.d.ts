import type { TesseraBridge } from '@tessera/protocol';

declare global {
  interface Window {
    readonly tessera: TesseraBridge;
  }
}
