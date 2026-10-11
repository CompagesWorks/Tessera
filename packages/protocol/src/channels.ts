export const INVOKE_CHANNELS = [
  'app:info',
  'app:open-external',
  'settings:get',
  'settings:update',
  'projects:home',
  'projects:create',
  'projects:pick-location',
  'projects:import',
  'projects:open',
  'projects:update',
  'projects:set-cover',
  'projects:remove-cover',
  'projects:forget',
  'projects:reveal',
  'tags:upsert',
  'tags:delete',
  'collections:upsert',
  'collections:delete',
  'layout:get',
  'layout:save',
  'files:list',
  'notes:list',
  'notes:read',
  'notes:write',
  'notes:create',
  'notes:delete',
  'files:read-text',
  'plugins:list',
  'plugins:inspect-local',
  'plugins:install-local',
  'plugins:set-enabled',
  'plugins:set-grants',
  'plugins:remove',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['settings:changed'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export const ipcName = (channel: InvokeChannel | EventChannel) => `tessera:${channel}` as const;
