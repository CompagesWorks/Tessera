import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  ipcName,
  requestSchemas,
  type EventChannel,
  type EventPayloads,
  type InvokeChannel,
  type InvokeResponse,
} from '@tessera/protocol';
import type { z } from 'zod';

type Handler<C extends InvokeChannel> = (
  request: z.output<(typeof requestSchemas)[C]>,
  event: IpcMainInvokeEvent,
) => InvokeResponse<C> | Promise<InvokeResponse<C>>;

export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>, isTrusted: (url: string) => boolean) {
  ipcMain.handle(ipcName(channel), async (event, payload: unknown) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !isTrusted(frame.url)) {
      throw new Error(`[ipc] ${channel}: untrusted sender`);
    }

    const parsed = requestSchemas[channel].safeParse(payload);
    if (!parsed.success) {
      throw new Error(`[ipc] ${channel}: invalid request (${parsed.error.issues.map((i) => i.message).join(', ')})`);
    }
    return handler(parsed.data as z.output<(typeof requestSchemas)[C]>, event);
  });
}

export function send<E extends EventChannel>(target: WebContents, event: E, payload: EventPayloads[E]) {
  if (!target.isDestroyed()) target.send(ipcName(event), payload);
}
