import { GbImportSchema, GbLinkSchema, type GbMod, type GbProgress } from './gamebanana';
import { z } from 'zod';
import type { EventChannel, InvokeChannel } from './channels';
import {
  CreateProjectSchema,
  IdSchema,
  ProjectRefSchema,
  UpdateProjectSchema,
  UpsertCollectionSchema,
  UpsertTagSchema,
  type Collection,
  type HomeData,
  type ProjectSummary,
  type Tag,
} from './projects';
import {
  CreateNoteSchema,
  ListDirSchema,
  NoteRefSchema,
  SaveLayoutSchema,
  WriteNoteSchema,
  type DirEntry,
  type TexturePreview,
  type NoteInfo,
  type ProjectLayout,
} from './layout';
import {
  InspectLocalSchema,
  InstallLocalSchema,
  InstallPackageSchema,
  PluginCallSchema,
  PluginRefSchema,
  PluginSettingsRefSchema,
  ResetPluginSettingsSchema,
  SetPluginSettingSchema,
  type PluginSettingValue,
  PluginWatchSchema,
  ReadTextSchema,
  RenameFileSchema,
  WriteBytesSchema,
  SetExternalFolderSchema,
  PickProgramSchema,
  ConfirmAnswerSchema,
  type ConfirmRequest,
  SetPluginEnabledSchema,
  SetPluginGrantsSchema,
  type AuditEntry,
  type FilesChanged,
  type InstalledPlugin,
  type PluginManifest,
} from './plugins';
import { SettingsPatchSchema, type Settings } from './settings';
import {
  BackupListSchema,
  BackupRefSchema,
  CreateBackupSchema,
  RestartSchema,
  SafeApplySchema,
  type BackupInfo,
  type SafeReason,
} from './backups';
import {
  ApplyProfileSchema,
  AuditExportSchema,
  AuditQuerySchema,
  ConnectAccountSchema,
  DisconnectAccountSchema,
  ExportProfileSchema,
  HistoryRefSchema,
  PickFolderSchema,
  PickFileSchema,
  SearchSchema,
  type AuditList,
  type FileIndex,
  type HistoryItem,
  type HistoryState,
  type ProfileApplied,
  type ProfileRead,
  type SearchResponse,
  type UpdateInfo,
} from './tools';

export * from './channels';
export * from './gamebanana';
export * from './projects';
export * from './layout';
export * from './plugins';
export * from './settings';
export * from './backups';
export * from './tools';

export interface AppInfo {
  name: string;
  version: string;
  tauri: string;
  webview: string;
  platform: string;
  safeMode: boolean;
  safeReason: SafeReason | null;
  userData: string;
}

export const requestSchemas = {
  'app:info': z.undefined(),
  'app:open-external': z.object({ url: z.url({ protocol: /^https$/ }) }).strict(),
  'app:started': z.undefined(),
  'app:restart': RestartSchema,
  'app:open-data': z.undefined(),
  'app:cache-size': z.undefined(),
  'app:clear-cache': z.undefined(),
  'app:reset': z.undefined(),
  'safe:apply': SafeApplySchema,
  'backups:list': BackupListSchema,
  'backups:create': CreateBackupSchema,
  'backups:restore': BackupRefSchema,
  'backups:extract': BackupRefSchema,
  'backups:delete': BackupRefSchema,
  'backups:reveal': BackupRefSchema,
  'settings:get': z.undefined(),
  'settings:update': SettingsPatchSchema,
  'projects:home': z.undefined(),
  'projects:create': CreateProjectSchema,
  'gamebanana:lookup': GbLinkSchema,
  'gamebanana:image': GbLinkSchema,
  'gamebanana:import': GbImportSchema,
  'projects:pick-location': z.undefined(),
  'projects:import': z.undefined(),
  'projects:open': ProjectRefSchema,
  'projects:update': UpdateProjectSchema,
  'projects:set-cover': ProjectRefSchema,
  'projects:remove-cover': ProjectRefSchema,
  'projects:forget': ProjectRefSchema,
  'projects:reveal': ProjectRefSchema,
  'projects:export': z.object({ id: IdSchema, zip: z.boolean() }).strict(),
  'tags:upsert': UpsertTagSchema,
  'tags:delete': z.object({ id: IdSchema }).strict(),
  'collections:upsert': UpsertCollectionSchema,
  'collections:delete': z.object({ id: IdSchema }).strict(),
  'layout:get': ProjectRefSchema,
  'layout:save': SaveLayoutSchema,
  'files:list': ListDirSchema,
  'notes:list': ProjectRefSchema,
  'notes:read': NoteRefSchema,
  'notes:write': WriteNoteSchema,
  'notes:create': CreateNoteSchema,
  'notes:delete': NoteRefSchema,
  'files:read-text': ReadTextSchema,
  'files:reveal': ReadTextSchema,
  'files:open': ReadTextSchema,
  'files:preview': ReadTextSchema,
  'files:mkdir': ReadTextSchema,
  'files:remove': ReadTextSchema,
  'files:rename': RenameFileSchema,
  'files:write-bytes': WriteBytesSchema,
  'files:index': HistoryRefSchema,
  'plugins:list': z.undefined(),
  'plugins:inspect-local': InspectLocalSchema,
  'plugins:install-local': InstallLocalSchema,
  'plugins:inspect-package': InspectLocalSchema,
  'plugins:install-package': InstallPackageSchema,
  'plugins:set-enabled': SetPluginEnabledSchema,
  'plugins:set-grants': SetPluginGrantsSchema,
  'plugins:remove': PluginRefSchema,
  'plugins:activity': PluginRefSchema,
  'plugins:verify': PluginRefSchema,
  'plugins:set-external': SetExternalFolderSchema,
  'plugins:pick-program': PickProgramSchema,
  'plugins:confirm-answer': ConfirmAnswerSchema,
  'plugins:settings-get': PluginSettingsRefSchema,
  'plugins:settings-set': SetPluginSettingSchema,
  'plugins:settings-reset': ResetPluginSettingsSchema,
  'plugin:call': PluginCallSchema,
  'plugin:watch': PluginWatchSchema,
  'app:pick-folder': PickFolderSchema,
  'app:pick-file': PickFileSchema,
  'accounts:connect': ConnectAccountSchema,
  'accounts:disconnect': DisconnectAccountSchema,
  'updates:check': z.undefined(),
  'audit:list': AuditQuerySchema,
  'audit:clear': z.undefined(),
  'audit:export': AuditExportSchema,
  'search:project': SearchSchema,
  'history:state': HistoryRefSchema,
  'history:undo': HistoryRefSchema,
  'history:redo': HistoryRefSchema,
  'profile:export': ExportProfileSchema,
  'profile:read': z.undefined(),
  'profile:apply': ApplyProfileSchema,
} satisfies Record<InvokeChannel, z.ZodType>;

export interface InvokeResponses {
  'app:info': AppInfo;
  'app:open-external': boolean;
  'app:started': void;
  'app:restart': void;
  'app:open-data': void;
  'app:cache-size': number;
  'app:clear-cache': void;
  'app:reset': void;
  'safe:apply': void;
  'backups:list': BackupInfo[];
  'backups:create': BackupInfo | null;
  'backups:restore': BackupInfo;
  'backups:extract': string | null;
  'backups:delete': void;
  'backups:reveal': void;
  'settings:get': Settings;
  'settings:update': Settings;
  'projects:home': HomeData;
  'projects:create': ProjectSummary;
  'gamebanana:lookup': GbMod;
  'gamebanana:image': string;
  'gamebanana:import': ProjectSummary;
  'projects:pick-location': string | null;
  'projects:import': ProjectSummary | null;
  'projects:open': ProjectSummary;
  'projects:update': ProjectSummary;
  'projects:set-cover': ProjectSummary | null;
  'projects:remove-cover': ProjectSummary;
  'projects:forget': void;
  'projects:reveal': void;
  'projects:export': string;
  'tags:upsert': Tag;
  'tags:delete': void;
  'collections:upsert': Collection;
  'collections:delete': void;
  'layout:get': ProjectLayout;
  'layout:save': void;
  'files:list': DirEntry[];
  'notes:list': NoteInfo[];
  'notes:read': string;
  'notes:write': void;
  'notes:create': string;
  'notes:delete': void;
  'files:read-text': string;
  'files:reveal': void;
  'files:open': void;
  'files:preview': TexturePreview;
  'files:mkdir': void;
  'files:remove': void;
  'files:rename': void;
  'files:write-bytes': void;
  'files:index': FileIndex;
  'plugins:list': InstalledPlugin[];
  'plugins:inspect-local': { path: string; manifest: PluginManifest } | { path: string; error: string } | null;
  'plugins:install-local': InstalledPlugin;
  'plugins:inspect-package': { token: string; path: string; manifest: PluginManifest } | { path: string; error: string } | null;
  'plugins:install-package': InstalledPlugin;
  'plugins:set-enabled': InstalledPlugin;
  'plugins:set-grants': InstalledPlugin;
  'plugins:remove': void;
  'plugins:activity': AuditEntry[];
  'plugins:verify': { id: string; ok: boolean; error: string | null };
  'plugins:set-external': InstalledPlugin;
  'plugins:pick-program': InstalledPlugin;
  'plugins:confirm-answer': void;
  'plugins:settings-get': Record<string, PluginSettingValue>;
  'plugins:settings-set': Record<string, PluginSettingValue>;
  'plugins:settings-reset': Record<string, PluginSettingValue>;
  'plugin:call': unknown;
  'plugin:watch': void;
  'app:pick-folder': string | null;
  'app:pick-file': string | null;
  'accounts:connect': Settings;
  'accounts:disconnect': Settings;
  'updates:check': UpdateInfo;
  'audit:list': AuditList;
  'audit:clear': void;
  'audit:export': string | null;
  'search:project': SearchResponse;
  'history:state': HistoryState;
  'history:undo': HistoryItem | null;
  'history:redo': HistoryItem | null;
  'profile:export': string | null;
  'profile:read': ProfileRead;
  'profile:apply': ProfileApplied;
}

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof requestSchemas)[C]>;
export type InvokeResponse<C extends InvokeChannel> = InvokeResponses[C];

export interface ShortcutInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface EventPayloads {
  'settings:changed': Settings;
  'keyboard:shortcut': ShortcutInput;
  'plugins:tampered': { id: string; reason: string };
  'plugin:files-changed': FilesChanged;
  'backups:changed': { projectId: string };
  'audit:changed': undefined;
  'history:changed': { projectId: string };
  'plugins:settings-changed': { id: string; values: Record<string, PluginSettingValue> };
  'plugins:confirm': ConfirmRequest;
  'gamebanana:progress': GbProgress;
  'plugin:exec-output': { pluginId: string; stream: string; kind: 'stdout' | 'stderr'; text: string };
}

type InvokeArgs<C extends InvokeChannel> = InvokeRequest<C> extends undefined ? [] : [request: InvokeRequest<C>];

export interface TesseraBridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResponse<C>>;
  on<E extends EventChannel>(event: E, listener: (payload: EventPayloads[E]) => void): () => void;
}
