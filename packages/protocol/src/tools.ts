import { z } from 'zod';
import { ProjectLayoutSchema } from './layout';
import { PluginIdSchema, type AuditEntry } from './plugins';
import {
  AccentSchema,
  AutoBackupSchema,
  ExecPolicySchema,
  LanguageSchema,
  MotionSchema,
  ShortcutsSchema,
  ThemeModeSchema,
  UiScaleSchema,
  UpdateSettingsSchema,
} from './settings';

export const PickFileSchema = z.object({ extensions: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).min(1).max(8) }).strict();
export const PickFolderSchema = z.object({ title: z.string().max(120).optional() }).strict();

export const AccountServiceSchema = z.enum(['github', 'gamebanana']);
export type AccountService = z.infer<typeof AccountServiceSchema>;
export const ConnectAccountSchema = z.discriminatedUnion('service', [
  z.object({ service: z.literal('github'), token: z.string().trim().min(20).max(255) }).strict(),
  z.object({ service: z.literal('gamebanana'), member: z.string().trim().min(1).max(200) }).strict(),
  z.object({ service: z.literal('gamebanana-login'), username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/).optional() }).strict(),
]);
export const DisconnectAccountSchema = z.object({ service: AccountServiceSchema }).strict();

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  url: string | null;
  notes: string;
  publishedAt: string | null;
  error: 'offline' | 'rate-limit' | 'failed' | null;
}

export const AuditQuerySchema = z
  .object({
    pluginId: PluginIdSchema.optional(),
    allowed: z.boolean().optional(),
    text: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(2000).default(300),
  })
  .strict()
  .default({ limit: 300 });
export const AuditExportSchema = z.object({ format: z.enum(['json', 'csv']) }).strict();
export interface AuditList {
  entries: AuditEntry[];
  total: number;
}

export const SearchSchema = z
  .object({
    id: z.uuid(),
    query: z.string().trim().min(1).max(120),
    content: z.boolean().default(true),
    limit: z.number().int().min(1).max(300).default(120),
  })
  .strict();
export interface SearchMatch {
  line: number;
  text: string;
}
export interface SearchResult {
  path: string;
  name: string;
  kind: 'file' | 'dir' | 'note';
  size: number;
  nameHit: boolean;
  matches: SearchMatch[];
}
export interface SearchResponse {
  results: SearchResult[];
  scanned: number;
  truncated: boolean;
}

export const HistoryRefSchema = z.object({ id: z.uuid() }).strict();
export const HISTORY_KINDS = ['note.write', 'note.create', 'note.delete', 'file.write', 'file.remove', 'file.rename'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];
export interface HistoryItem {
  kind: HistoryKind;
  target: string;
  source: string | null;
  time: string;
  files: number;
}
export interface HistoryState {
  undo: HistoryItem[];
  redo: HistoryItem[];
}

export const ProfileSchema = z
  .object({
    formatVersion: z.literal(1),
    kind: z.literal('tessera-profile'),
    createdAt: z.iso.datetime(),
    appVersion: z.string().max(40),
    settings: z
      .object({
        language: LanguageSchema,
        theme: ThemeModeSchema,
        motion: MotionSchema,
        pluginTheme: z.string().max(110).nullable(),
        uiProvider: PluginIdSchema.nullable(),
        accent: AccentSchema.nullable(),
        uiScale: UiScaleSchema,
        showSplash: z.boolean(),
        reopenLastProject: z.boolean(),
        execPolicy: ExecPolicySchema,
        shortcuts: ShortcutsSchema,
        backups: z.object({ auto: AutoBackupSchema, keep: z.number().int().min(0).max(500) }),
        updates: UpdateSettingsSchema,
      })
      .partial(),
    plugins: z
      .array(z.object({ id: PluginIdSchema, version: z.string().max(40), enabled: z.boolean() }))
      .max(200),
    pluginSettings: z.record(PluginIdSchema, z.record(z.string().max(40), z.union([z.boolean(), z.string().max(500), z.number().finite()]))).default({}),
    layout: ProjectLayoutSchema.nullable().default(null),
  })
  .strip();
export type Profile = z.infer<typeof ProfileSchema>;

export const ExportProfileSchema = z.object({ layoutFrom: z.uuid().nullable() }).strict();
export const ApplyProfileSchema = z
  .object({ token: z.uuid(), settings: z.boolean(), plugins: z.boolean(), layout: z.boolean() })
  .strict();

export type ProfilePluginState = 'same' | 'version' | 'missing';
export interface ProfilePreview {
  token: string;
  createdAt: string;
  appVersion: string;
  settingKeys: string[];
  shortcuts: number;
  plugins: Array<{ id: string; name: string | null; version: string; installedVersion: string | null; enabled: boolean; state: ProfilePluginState }>;
  pluginSettings: number;
  hasLayout: boolean;
}
export type ProfileRead = { ok: true; preview: ProfilePreview } | { ok: false; error: string } | null;
export interface ProfileApplied {
  settings: number;
  plugins: number;
  skipped: string[];
}

export interface FileIndex {
  files: string[];
  truncated: boolean;
}
