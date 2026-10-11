import type { Permission, ProjectSummary } from '@tessera/protocol';
import { z } from 'zod';
import { getLanguage } from '../i18n';
import type { UiProvider } from '../ui/provider';

const MAX_STATE_BYTES = 64 * 1024;
const MAX_CALLS_PER_SECOND = 40;

interface FrameInfo {
  iframe: HTMLIFrameElement;
  pluginId: string;
  widgetId: string;
  project: ProjectSummary;
  getState(): Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
  calls: number[];
}

interface Method {
  schema: z.ZodType;
  permission?: Permission;
  run(frame: FrameInfo, params: never): unknown;
}

const PathSchema = z.object({ path: z.string().max(400) }).strict();

let ui: UiProvider | null = null;
let theme: 'dark' | 'light' = 'dark';
const frames = new Set<FrameInfo>();
const grants = new Map<string, Set<Permission>>();

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
  'files.list': {
    schema: PathSchema,
    permission: 'fs.project.read',
    run: ({ project }, { path }: { path: string }) => window.tessera.invoke('files:list', { id: project.id, path }),
  },
  'files.readText': {
    schema: PathSchema,
    permission: 'fs.project.read',
    run: ({ project }, { path }: { path: string }) => window.tessera.invoke('files:read-text', { id: project.id, path }),
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

async function onRequest(frame: FrameInfo, id: unknown, name: unknown, params: unknown) {
  if (typeof id !== 'number') return;
  const reply = (result: { result?: unknown; error?: string }) => post(frame, { id, ...result });
  if (overLimit(frame)) return reply({ error: 'rate limited' });
  const method = typeof name === 'string' ? methods[name] : undefined;
  if (!method) return reply({ error: 'unknown method' });
  if (method.permission && !grants.get(frame.pluginId)?.has(method.permission)) return reply({ error: `permission denied: ${method.permission}` });
  const parsed = method.schema.safeParse(params);
  if (!parsed.success) return reply({ error: 'invalid params' });
  try {
    reply({ result: await method.run(frame, parsed.data as never) });
  } catch (error) {
    reply({ error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, '') : 'failed' });
  }
}

function onKey(frame: FrameInfo, key: unknown) {
  if (document.activeElement !== frame.iframe) return;
  const parsed = z
    .object({ key: z.string().max(20), code: z.string().max(20), ctrlKey: z.boolean(), metaKey: z.boolean(), altKey: z.boolean(), shiftKey: z.boolean() })
    .safeParse(key);
  if (parsed.success) document.dispatchEvent(new KeyboardEvent('keydown', { ...parsed.data, bubbles: true }));
}

function onMessage(event: MessageEvent) {
  if (!event.source) return;
  const frame = [...frames].find((info) => info.iframe.contentWindow === event.source);
  if (!frame) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data['tessera'] !== 1) return;
  if (data['hello'] === true) post(frame, { event: 'init', payload: { theme, language: getLanguage(), widgetId: frame.widgetId } });
  else if ('key' in data) onKey(frame, data['key']);
  else void onRequest(frame, data['id'], data['method'], data['params']);
}

export function initPluginBridge(provider: UiProvider, initialTheme: 'dark' | 'light') {
  ui = provider;
  theme = initialTheme;
  window.addEventListener('message', onMessage);
}

export function setPluginGrants(pluginId: string, granted: Permission[]) {
  grants.set(pluginId, new Set(granted));
}

export function broadcastTheme(next: 'dark' | 'light') {
  theme = next;
  for (const frame of frames) post(frame, { event: 'theme', payload: { theme } });
}

export function attachFrame(info: Omit<FrameInfo, 'calls'>): () => void {
  const frame: FrameInfo = { ...info, calls: [] };
  frames.add(frame);
  return () => {
    frames.delete(frame);
  };
}
