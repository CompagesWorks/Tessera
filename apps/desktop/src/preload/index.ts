import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, ipcName, type EventChannel, type InvokeChannel } from '@tessera/protocol/channels';

const invokable = new Set<string>(INVOKE_CHANNELS);
const events = new Set<string>(EVENT_CHANNELS);

contextBridge.exposeInMainWorld('tessera', {
  invoke(channel: InvokeChannel, request?: unknown) {
    if (!invokable.has(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`));
    return ipcRenderer.invoke(ipcName(channel), request);
  },
  on(event: EventChannel, listener: (payload: unknown) => void) {
    if (!events.has(event)) throw new Error(`Unknown event: ${event}`);
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(ipcName(event), wrapped);
    return () => {
      ipcRenderer.removeListener(ipcName(event), wrapped);
    };
  },
});
