import type { FsScope, Permission, ProjectSummary } from '@tessera/protocol';
import { z } from 'zod';
import { getLanguage } from '../i18n';
import type { UiProvider } from '../ui/provider';

const MAX_STATE_BYTES = 64 * 1024;
const MAX_CALLS_PER_SECOND = 40;
const PING_EVERY = 3000;
const UNRESPONSIVE_AFTER = 8000;

interface FrameInfo {
  iframe: HTMLIFrameElement;
  pluginId: string;
  widgetId: string;
  project: ProjectSummary;
  getState(): Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
  onResponsive(responsive: boolean): void;
  calls: number[];
  greeted: boolean;
  lastPong: number;
  responsive: boolean;
  watching: boolean;
}

interface Method {
  schema: z.ZodType;
  permission?(params: unknown): Permission;
  run(frame: FrameInfo, params: never): unknown;
}

let ui: UiProvider | null = null;
let theme: 'dark' | 'light' = 'dark';
let tokens: Record<string, string> = {};
const frames = new Set<FrameInfo>();
const grants = new Map<string, Set<Permission>>();
const watchers = new Map<string, number>();

const MAX_LAB_ENTRIES = 300;
const LOG_LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug']);

export interface LabLog {
  time: number;
  level: string;
  text: string;
}

export interface LabTrace {
  time: number;
  method: string;
  outcome: 'ok' | 'denied' | 'error' | 'limited';
  ms: number;
  detail: string;
}

const lab = {
  enabled: false,
  logs: new Map<string, LabLog[]>(),
  traces: new Map<string, LabTrace[]>(),
  denied: new Map<string, Set<Permission>>(),
  listeners: new Set<() => void>(),
};

function pushLab<T>(store: Map<string, T[]>, pluginId: string, entry: T) {
  const list = store.get(pluginId) ?? [];
  list.push(entry);
  if (list.length > MAX_LAB_ENTRIES) list.splice(0, list.length - MAX_LAB_ENTRIES);
  store.set(pluginId, list);
  for (const listener of lab.listeners) listener();
}

export const labEnabled = () => lab.enabled;

export function setLabEnabled(enabled: boolean) {
  lab.enabled = enabled;
  if (!enabled) {
    lab.logs.clear();
    lab.traces.clear();
    lab.denied.clear();
  }
}

export const labLog = (pluginId: string): LabLog[] => lab.logs.get(pluginId) ?? [];
export const labTrace = (pluginId: string): LabTrace[] => lab.traces.get(pluginId) ?? [];
export const labDenied = (pluginId: string): ReadonlySet<Permission> => lab.denied.get(pluginId) ?? new Set();

export function clearLab(pluginId: string) {
  lab.logs.delete(pluginId);
  lab.traces.delete(pluginId);
  for (const listener of lab.listeners) listener();
}

export function setSimulatedDenial(pluginId: string, permission: Permission, denied: boolean) {
  const set = new Set(lab.denied.get(pluginId) ?? []);
  if (denied) set.add(permission);
  else set.delete(permission);
  if (set.size) lab.denied.set(pluginId, set);
  else lab.denied.delete(pluginId);
  for (const listener of lab.listeners) listener();
}

export function onLabChange(listener: () => void): () => void {
  lab.listeners.add(listener);
  return () => lab.listeners.delete(listener);
}

export function liveFrames(pluginId: string): number {
  return [...frames].filter((frame) => frame.pluginId === pluginId && frame.iframe.isConnected).length;
}

export function reloadPluginFrames(pluginId: string) {
  for (const frame of frames) {
    if (frame.pluginId !== pluginId || !frame.iframe.isConnected) continue;
    frame.greeted = false;
    frame.iframe.src = frame.iframe.src;
  }
}

function scopeOf(params: unknown): FsScope {
  const scope = (params as { scope?: unknown } | undefined)?.scope;
  return scope === 'private' || scope === 'external' ? scope : 'project';
}

const fsRead = (params: unknown): Permission => {
  const scope = scopeOf(params);
  return scope === 'project' ? 'fs.project.read' : scope === 'private' ? 'fs.project.write' : 'fs.external';
};
const fsWrite = (params: unknown): Permission => (scopeOf(params) === 'external' ? 'fs.external' : 'fs.project.write');

function forward(name: string, permission: (params: unknown) => Permission): Method {
  return {
    schema: z.unknown(),
    permission,
    run: ({ project, pluginId }, params: unknown) => window.tessera.invoke('plugin:call', { pluginId, projectId: project.id, method: name, params }),
  };
}

function watchKey(frame: FrameInfo) {
  return `${frame.pluginId}|${frame.project.id}`;
}

async function setWatching(frame: FrameInfo, watching: boolean) {
  if (frame.watching === watching) return;
  frame.watching = watching;
  const key = watchKey(frame);
  const count = (watchers.get(key) ?? 0) + (watching ? 1 : -1);
  if (count <= 0) watchers.delete(key);
  else watchers.set(key, count);
  if ((watching && count === 1) || (!watching && count <= 0)) {
    try {
      await window.tessera.invoke('plugin:watch', { pluginId: frame.pluginId, projectId: frame.project.id, watching });
    } catch (error) {
      if (watching) {
        frame.watching = false;
        watchers.delete(key);
      }
      throw error;
    }
  }
}

const methods: Record<string, Method> = {
  'ui.toast': {
    schema: z.object({ kind: z.enum(['success', 'info', 'warning', 'error']), message: z.string().min(1).max(300) }).strict(),
    run: (_frame, { kind, message }: { kind: 'success' | 'info' | 'warning' | 'error'; message: string }) => ui?.toast(kind, message),
  },
  'widget.getState': {
    schema: z.undefined(),
    run: (frame) => frame.getState(),
  },
  'widget.setState': {
    schema: z
      .object({ state: z.record(z.string(), z.unknown()) })
      .strict()
      .refine((value) => JSON.stringify(value.state).length <= MAX_STATE_BYTES, 'state too large'),
    run: (frame, { state }: { state: Record<string, unknown> }) => frame.setState(structuredClone(state)),
  },
  'project.info': {
    schema: z.undefined(),
    run: ({ project }) => ({ name: project.name, kind: project.kind, status: project.status }),
  },
  'files.watch': {
    schema: z.object({ watching: z.boolean() }).strict(),
    permission: () => 'fs.project.read',
    run: (frame, { watching }: { watching: boolean }) => setWatching(frame, watching),
  },
  'fs.list': forward('fs.list', fsRead),
  'fs.readText': forward('fs.readText', fsRead),
  'fs.writeText': forward('fs.writeText', fsWrite),
  'fs.mkdir': forward('fs.mkdir', fsWrite),
  'fs.remove': forward('fs.remove', fsWrite),
  'fs.rename': forward('fs.rename', fsWrite),
  'external.pick': forward('external.pick', () => 'fs.external'),
  'external.info': forward('external.info', () => 'fs.external'),
  'export.deploy': forward('export.deploy', () => 'fs.external'),
  'net.fetch': forward('net.fetch', () => 'net'),
  'secrets.get': forward('secrets.get', () => 'secrets'),
  'secrets.set': forward('secrets.set', () => 'secrets'),
  'secrets.delete': forward('secrets.delete', () => 'secrets'),
  'secrets.keys': forward('secrets.keys', () => 'secrets'),
  'exec.run': forward('exec.run', () => 'exec'),
  'exec.runSystem': forward('exec.runSystem', () => 'exec.system'),
  'exec.pickSystem': forward('exec.pickSystem', () => 'exec.system'),
  'exec.systemInfo': forward('exec.systemInfo', () => 'exec.system'),
  'fs.readBytes': forward('fs.readBytes', fsRead),
  'fs.writeBytes': forward('fs.writeBytes', fsWrite),
  'discord.setActivity': forward('discord.setActivity', () => 'discord.rpc'),
  'clipboard.writeText': forward('clipboard.writeText', () => 'clipboard.write'),
  'notify.show': forward('notify.show', () => 'notify.system'),
  'shell.openUrl': forward('shell.openUrl', () => 'open.external'),
  'shell.reveal': forward('shell.reveal', () => 'open.external'),
  'projects.list': forward('projects.list', () => 'projects.list'),
  'settings.set': {
    schema: z.object({ key: z.string().min(1).max(40), value: z.union([z.boolean(), z.string().max(500), z.number().finite()]) }).strict(),
    run: ({ pluginId }, { key, value }: { key: string; value: boolean | string | number }) =>
      window.tessera.invoke('plugins:settings-set', { id: pluginId, key, value }),
  },
  'settings.reset': {
    schema: z.object({ key: z.string().min(1).max(40).optional() }).strict(),
    run: ({ pluginId }, { key }: { key?: string }) => window.tessera.invoke('plugins:settings-reset', { id: pluginId, ...(key ? { key } : {}) }),
  },
};

function post(frame: FrameInfo, message: Record<string, unknown>) {
  frame.iframe.contentWindow?.postMessage({ tessera: 1, ...message }, '*');
}

function overLimit(frame: FrameInfo) {
  const now = performance.now();
  frame.calls = frame.calls.filter((time) => now - time < 1000);
  frame.calls.push(now);
  return frame.calls.length > MAX_CALLS_PER_SECOND;
}

function hasGrant(pluginId: string, permission: Permission) {
  return grants.get(pluginId)?.has(permission) ?? false;
}

async function onRequest(frame: FrameInfo, id: unknown, name: unknown, params: unknown) {
  if (typeof id !== 'number') return;
  const started = performance.now();
  const label = typeof name === 'string' ? name.slice(0, 40) : '?';
  const reply = (result: { result?: unknown; error?: string }, outcome: LabTrace['outcome'] = result.error ? 'error' : 'ok') => {
    post(frame, { id, ...result });
    if (lab.enabled) pushLab(lab.traces, frame.pluginId, { time: Date.now(), method: label, outcome, ms: Math.round(performance.now() - started), detail: result.error ?? '' });
  };
  if (overLimit(frame)) return reply({ error: 'rate limited' }, 'limited');
  const method = typeof name === 'string' && Object.hasOwn(methods, name) ? methods[name] : undefined;
  if (!method) return reply({ error: 'unknown method' });
  const permission = method.permission?.(params);
  if (permission && lab.denied.get(frame.pluginId)?.has(permission)) return reply({ error: `permission denied: ${permission} (simulated)` }, 'denied');
  if (permission && !hasGrant(frame.pluginId, permission)) return reply({ error: `permission denied: ${permission}` }, 'denied');
  const parsed = method.schema.safeParse(params);
  if (!parsed.success) return reply({ error: 'invalid params' });
  try {
    reply({ result: await method.run(frame, parsed.data as never) });
  } catch (error) {
    reply({ error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'failed' });
  }
}

async function sendInit(frame: FrameInfo) {
  const settings = await window.tessera.invoke('plugins:settings-get', { id: frame.pluginId }).catch(() => ({}));
  post(frame, { event: 'init', payload: { ...themePayload(), language: getLanguage(), widgetId: frame.widgetId, settings } });
}

function themePayload() {
  return { theme, tokens };
}

function onMessage(event: MessageEvent) {
  if (!event.source) return;
  const frame = [...frames].find((info) => info.iframe.contentWindow === event.source);
  if (!frame) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data['tessera'] !== 1) return;
  if (data['hello'] === true) {
    frame.greeted = true;
    frame.lastPong = performance.now();
    setResponsive(frame, true);
    void sendInit(frame);
  } else if (data['log'] && typeof data['log'] === 'object') {
    const { level, text } = data['log'] as { level?: unknown; text?: unknown };
    if (lab.enabled && typeof level === 'string' && LOG_LEVELS.has(level) && typeof text === 'string') {
      pushLab(lab.logs, frame.pluginId, { time: Date.now(), level, text: text.slice(0, 2000) });
    }
  } else if ('pong' in data) {
    frame.lastPong = performance.now();
    setResponsive(frame, true);
  } else void onRequest(frame, data['id'], data['method'], data['params']);
}

function setResponsive(frame: FrameInfo, responsive: boolean) {
  if (frame.responsive === responsive) return;
  frame.responsive = responsive;
  frame.onResponsive(responsive);
}

function watch() {
  const now = performance.now();
  for (const frame of frames) {
    if (!frame.greeted || !frame.iframe.isConnected) continue;
    if (now - frame.lastPong > UNRESPONSIVE_AFTER) setResponsive(frame, false);
    post(frame, { event: 'ping', payload: Math.round(now) });
  }
}

export function initPluginBridge(provider: UiProvider, initialTheme: 'dark' | 'light') {
  ui = provider;
  theme = initialTheme;
  window.addEventListener('message', onMessage);
  window.setInterval(watch, PING_EVERY);
  window.tessera.on('keyboard:shortcut', (input) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLIFrameElement) || ![...frames].some((frame) => frame.iframe === focused)) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { ...input, bubbles: true }));
  });
  window.tessera.on('plugins:settings-changed', ({ id, values }) => {
    for (const frame of frames) if (frame.pluginId === id) post(frame, { event: 'settings.changed', payload: values });
  });
  window.tessera.on('plugin:files-changed', ({ projectId, paths }) => {
    for (const frame of frames) {
      if (frame.watching && frame.project.id === projectId && hasGrant(frame.pluginId, 'fs.project.read')) post(frame, { event: 'files.changed', payload: { paths } });
    }
  });
}

export function whenFramesReady(timeout: number): Promise<void> {
  const started = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const waiting = [...frames].some((frame) => frame.iframe.isConnected && !frame.greeted);
      if (!waiting || performance.now() - started > timeout) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

export function setPluginGrants(pluginId: string, granted: Permission[]) {
  grants.set(pluginId, new Set(granted));
}

export function broadcastTheme(next: 'dark' | 'light', nextTokens: Record<string, string> = tokens) {
  theme = next;
  tokens = nextTokens;
  for (const frame of frames) post(frame, { event: 'theme', payload: themePayload() });
}

export function attachFrame(info: Omit<FrameInfo, 'calls' | 'greeted' | 'lastPong' | 'responsive' | 'watching'>): () => void {
  const frame: FrameInfo = { ...info, calls: [], greeted: false, lastPong: 0, responsive: true, watching: false };
  frames.add(frame);
  return () => {
    frames.delete(frame);
    void setWatching(frame, false).catch(() => {});
  };
}
