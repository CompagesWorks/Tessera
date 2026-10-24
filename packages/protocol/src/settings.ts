import { z } from 'zod';
import { ProjectLayoutSchema } from './layout';
import { PluginIdSchema } from './plugins';

export const LanguageSchema = z.enum(['fr', 'en']);
export const ThemeSchema = z.enum(['dark', 'light']);
export const ThemeModeSchema = z.enum(['dark', 'light', 'system']);
export const MotionSchema = z.enum(['full', 'reduced', 'none']);
export const ExecPolicySchema = z.enum(['ask', 'session']);
export const AutoBackupSchema = z.enum(['off', '15', '60']);

export const ACCENTS = ['#7a9bff', '#c77dff', '#ff6b9a', '#ff9f43', '#4ade80', '#2dd4bf'] as const;
export const UI_SCALE_MIN = 80;
export const UI_SCALE_MAX = 130;

export const CommandIdSchema = z.string().regex(/^[a-z0-9.-]{1,60}$/);
export const ShortcutSchema = z
  .string()
  .max(40)
  .regex(/^((Mod|Ctrl|Meta|Alt|Shift)\+)*([A-Z0-9]|F\d{1,2}|[,.;/\-=`[\]\\']|Enter|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/);

export const AccentSchema = z.string().regex(/^#[0-9a-f]{6}$/);
export const UiScaleSchema = z.number().int().min(UI_SCALE_MIN).max(UI_SCALE_MAX);
export const ShortcutsSchema = z.record(CommandIdSchema, ShortcutSchema.nullable()).refine((s) => Object.keys(s).length <= 200, 'too many shortcuts');

export const BackupSettingsSchema = z.object({
  auto: AutoBackupSchema,
  keep: z.number().int().min(0).max(500),
  folder: z.string().min(1).max(500).nullable(),
});
export type BackupSettings = z.infer<typeof BackupSettingsSchema>;

const PathSchema = z.string().min(1).max(500);

export const GameSettingsSchema = z.object({
  ryujinx: PathSchema.nullable(),
  launchAfterDeploy: z.boolean(),
  sdMods: PathSchema.nullable(),
  arcVersion: z.string().regex(/^(latest|\d{1,2}\.\d{1,3}(\.\d{1,3})?)$/),
});
export type GameSettings = z.infer<typeof GameSettingsSchema>;
export const DEFAULT_GAME: GameSettings = { ryujinx: null, launchAfterDeploy: false, sdMods: null, arcVersion: 'latest' };

export const UpdateSettingsSchema = z.object({ auto: z.boolean() });
export const DEFAULT_UPDATES = { auto: true };

export const AccountsSchema = z.object({
  github: z.object({ login: z.string().min(1).max(60) }).nullable(),
  gamebanana: z.object({ memberId: z.number().int().positive(), name: z.string().min(1).max(80) }).nullable(),
});
export type Accounts = z.infer<typeof AccountsSchema>;
export const DEFAULT_ACCOUNTS: Accounts = { github: null, gamebanana: null };

const fields = {
  language: LanguageSchema,
  theme: ThemeModeSchema,
  motion: MotionSchema,
  pluginTheme: z.string().max(110).nullable(),
  uiProvider: PluginIdSchema.nullable(),
  accent: AccentSchema.nullable(),
  uiScale: UiScaleSchema,
  showSplash: z.boolean(),
  splashDelay: z.boolean(),
  reopenLastProject: z.boolean(),
  projectsFolder: z.string().min(1).max(500).nullable(),
  execPolicy: ExecPolicySchema,
  shortcuts: ShortcutsSchema,
  backups: BackupSettingsSchema,
  game: GameSettingsSchema,
  developerMode: z.boolean(),
  updates: UpdateSettingsSchema,
  layoutTemplate: ProjectLayoutSchema.nullable(),
};

export const DEFAULT_BACKUPS: BackupSettings = { auto: 'off', keep: 20, folder: null };

export const SettingsSchema = z.object({
  formatVersion: z.literal(1),
  language: fields.language,
  theme: fields.theme,
  motion: fields.motion,
  pluginTheme: fields.pluginTheme.default(null),
  uiProvider: fields.uiProvider.default(null),
  accent: fields.accent.default(null),
  uiScale: fields.uiScale.default(100),
  showSplash: fields.showSplash.default(true),
  splashDelay: fields.splashDelay.default(true),
  reopenLastProject: fields.reopenLastProject.default(false),
  projectsFolder: fields.projectsFolder.default(null),
  execPolicy: fields.execPolicy.default('session'),
  shortcuts: fields.shortcuts.default({}),
  backups: fields.backups.default(DEFAULT_BACKUPS),
  game: fields.game.default(DEFAULT_GAME),
  developerMode: fields.developerMode.default(false),
  updates: fields.updates.default(DEFAULT_UPDATES),
  layoutTemplate: fields.layoutTemplate.default(null),
  accounts: AccountsSchema.default(DEFAULT_ACCOUNTS),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export const DEFAULT_SETTINGS: Settings = {
  formatVersion: 1,
  language: 'fr',
  theme: 'dark',
  motion: 'full',
  pluginTheme: null,
  uiProvider: null,
  accent: null,
  uiScale: 100,
  showSplash: true,
  splashDelay: true,
  reopenLastProject: false,
  projectsFolder: null,
  execPolicy: 'session',
  shortcuts: {},
  backups: DEFAULT_BACKUPS,
  game: DEFAULT_GAME,
  developerMode: false,
  updates: DEFAULT_UPDATES,
  layoutTemplate: null,
  accounts: DEFAULT_ACCOUNTS,
};

export const SettingsPatchSchema = z.object(fields).partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
