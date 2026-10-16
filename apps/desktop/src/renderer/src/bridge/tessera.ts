import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EVENT_CHANNELS, INVOKE_CHANNELS, ipcName, type EventChannel, type InvokeChannel, type TesseraBridge } from '@tessera/protocol';

const invokable = new Set<string>(INVOKE_CHANNELS);
const events = new Set<string>(EVENT_CHANNELS);

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

export const tesseraBridge = {
  invoke(channel: InvokeChannel, request?: unknown) {
    if (!invokable.has(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`));
    return invoke('tessera_invoke', { channel, request: request ?? null }).catch((error: unknown) => Promise.reject(asError(error)));
  },
  on(event: EventChannel, listener: (payload: unknown) => void) {
    if (!events.has(event)) throw new Error(`Unknown event: ${event}`);
    let stopped = false;
    let unlisten: UnlistenFn | null = null;
    void listen(ipcName(event), (message) => listener(message.payload)).then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  },
} as TesseraBridge;
