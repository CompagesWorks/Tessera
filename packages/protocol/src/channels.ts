export const INVOKE_CHANNELS = ['app:info', 'app:open-external', 'settings:get', 'settings:update'] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['settings:changed'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export const ipcName = (channel: InvokeChannel | EventChannel) => `tessera:${channel}` as const;
