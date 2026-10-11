import { z } from 'zod';
import type { EventChannel, InvokeChannel } from './channels';

export * from './channels';

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
} satisfies Record<InvokeChannel, z.ZodType>;

export interface InvokeResponses {
  'app:info': AppInfo;
  'app:open-external': boolean;
  'settings:get': Settings;
  'settings:update': Settings;
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
