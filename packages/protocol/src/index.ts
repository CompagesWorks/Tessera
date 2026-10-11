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
  type NoteInfo,
  type ProjectLayout,
} from './layout';

export * from './channels';
export * from './projects';
export * from './layout';

export const LanguageSchema = z.enum(['fr', 'en']);
export const ThemeSchema = z.enum(['dark', 'light']);
export const MotionSchema = z.enum(['full', 'reduced', 'none']);

export const SettingsSchema = z.object({
  formatVersion: z.literal(1),
  language: LanguageSchema,
  theme: ThemeSchema,
  motion: MotionSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;
export type Language = z.infer<typeof LanguageSchema>;

export const DEFAULT_SETTINGS: Settings = {
  formatVersion: 1,
  language: 'fr',
  theme: 'dark',
  motion: 'full',
};

export const SettingsPatchSchema = SettingsSchema.omit({ formatVersion: true }).partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  safeMode: boolean;
}

export const requestSchemas = {
  'app:info': z.undefined(),
  'app:open-external': z.object({ url: z.url({ protocol: /^https$/ }) }).strict(),
  'settings:get': z.undefined(),
  'settings:update': SettingsPatchSchema,
  'projects:home': z.undefined(),
  'projects:create': CreateProjectSchema,
  'projects:pick-location': z.undefined(),
  'projects:import': z.undefined(),
  'projects:open': ProjectRefSchema,
  'projects:update': UpdateProjectSchema,
  'projects:set-cover': ProjectRefSchema,
  'projects:remove-cover': ProjectRefSchema,
  'projects:forget': ProjectRefSchema,
  'projects:reveal': ProjectRefSchema,
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
} satisfies Record<InvokeChannel, z.ZodType>;

export interface InvokeResponses {
  'app:info': AppInfo;
  'app:open-external': boolean;
  'settings:get': Settings;
  'settings:update': Settings;
  'projects:home': HomeData;
  'projects:create': ProjectSummary;
  'projects:pick-location': string | null;
  'projects:import': ProjectSummary | null;
  'projects:open': ProjectSummary;
  'projects:update': ProjectSummary;
  'projects:set-cover': ProjectSummary | null;
  'projects:remove-cover': ProjectSummary;
  'projects:forget': void;
  'projects:reveal': void;
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
}

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof requestSchemas)[C]>;
export type InvokeResponse<C extends InvokeChannel> = InvokeResponses[C];

export interface EventPayloads {
  'settings:changed': Settings;
}

type InvokeArgs<C extends InvokeChannel> = InvokeRequest<C> extends undefined ? [] : [request: InvokeRequest<C>];

export interface TesseraBridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResponse<C>>;
  on<E extends EventChannel>(event: E, listener: (payload: EventPayloads[E]) => void): () => void;
}
