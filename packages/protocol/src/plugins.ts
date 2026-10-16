import { z } from 'zod';

export const WIDGET_CATEGORIES = ['project', 'files', 'editing', 'media', 'publishing', 'tools', 'other'] as const;
export const WidgetCategorySchema = z.enum(WIDGET_CATEGORIES);
export type WidgetCategory = z.infer<typeof WidgetCategorySchema>;

export const PERMISSIONS = [
  'fs.project.read',
  'fs.project.write',
  'fs.external',
  'net',
  'secrets',
  'ui.theme',
  'ui.provider',
  'exec',
  'exec.system',
  'discord.rpc',
  'clipboard.write',
  'notify.system',
  'open.external',
  'projects.list',
] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;
export type PermissionRisk = 'low' | 'medium' | 'high';

export const PERMISSION_RISK: Record<Permission, PermissionRisk> = {
  'fs.project.read': 'low',
  'fs.project.write': 'medium',
  'fs.external': 'medium',
  net: 'medium',
  secrets: 'medium',
  'ui.theme': 'low',
  'ui.provider': 'high',
  exec: 'high',
  'exec.system': 'high',
  'discord.rpc': 'medium',
  'clipboard.write': 'low',
  'notify.system': 'low',
  'open.external': 'medium',
  'projects.list': 'medium',
};

export const PluginIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
  .max(64)
  .refine((id) => !/^(core|tessera)(\.|$)/.test(id), 'reserved id');

const RelativePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._\-/]+$/)
  .refine((p) => !p.startsWith('/') && !p.split('/').some((part) => part === '..' || part === ''), 'invalid path');

export const ICON_IMAGE = /\.(png|svg|webp|jpe?g|gif)$/i;
const IconSchema = z.union([RelativePathSchema.regex(ICON_IMAGE), z.string().regex(/^[a-z0-9-]{1,40}$/)]);

export const DomainSchema = z
  .string()
  .max(253)
  .regex(/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'invalid domain');

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'invalid sha256');

export const ProgramNameSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, 'invalid program name');

export interface SystemProgram {
  path: string;
  sha256: string;
}

const SimplePermissionSchema = PermissionSchema.exclude(['net', 'exec', 'exec.system', 'discord.rpc']);

export const PermissionEntrySchema = z.union([
  SimplePermissionSchema,
  z.object({ id: SimplePermissionSchema }).strict(),
  z.object({ id: z.literal('net'), domains: z.array(DomainSchema).min(1).max(32) }).strict(),
  z.object({ id: z.literal('exec'), program: RelativePathSchema, sha256: Sha256Schema }).strict(),
  z.object({ id: z.literal('exec.system'), programs: z.array(ProgramNameSchema).min(1).max(8) }).strict(),
  z.object({ id: z.literal('discord.rpc'), clientId: z.string().regex(/^\d{17,20}$/, 'invalid client id') }).strict(),
]);

const ThemeTokenNameSchema = z.string().regex(/^--atrium-[a-z0-9-]{1,60}$/, 'only --atrium-* tokens');
const ThemeTokenValueSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9#%(),.\-+ /'"]+$/, 'invalid token value')
  .refine((v) => !/url\s*\(|expression|image-set|@import/i.test(v), 'invalid token value');

export const PluginThemeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  base: z.enum(['dark', 'light']),
  tokens: z.record(ThemeTokenNameSchema, ThemeTokenValueSchema).refine((t) => Object.keys(t).length <= 200, 'too many tokens'),
});
export type PluginTheme = z.infer<typeof PluginThemeSchema>;

export const PluginWidgetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().trim().min(1).max(40),
  description: z.string().trim().max(120).default(''),
  icon: IconSchema.default('puzzle'),
  category: WidgetCategorySchema.default('other'),
  entry: RelativePathSchema,
});
export type PluginWidget = z.infer<typeof PluginWidgetSchema>;

const SettingKeySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/);
const SettingTextSchema = z.string().trim().min(1).max(60);
const settingBase = {
  id: SettingKeySchema,
  title: SettingTextSchema,
  description: z.string().trim().max(200).default(''),
  group: z.string().trim().min(1).max(40).optional(),
};

export const PluginSettingSchema = z.discriminatedUnion('type', [
  z.object({ ...settingBase, type: z.literal('boolean'), default: z.boolean() }).strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('string'),
      default: z.string().max(500),
      maxLength: z.number().int().min(1).max(500).default(200),
      placeholder: z.string().max(80).default(''),
    })
    .strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('number'),
      default: z.number().finite(),
      min: z.number().finite().default(0),
      max: z.number().finite().default(100),
      step: z.number().positive().finite().default(1),
    })
    .strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('select'),
      default: z.string().max(60),
      options: z.array(z.object({ value: z.string().min(1).max(60), label: SettingTextSchema }).strict()).min(1).max(32),
    })
    .strict(),
]);
export type PluginSetting = z.output<typeof PluginSettingSchema>;
export type PluginSettingValue = boolean | string | number;

export function coerceSetting(def: PluginSetting, value: unknown): PluginSettingValue | undefined {
  if (def.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (def.type === 'string') return typeof value === 'string' && value.length <= def.maxLength ? value : undefined;
  if (def.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value >= def.min && value <= def.max ? value : undefined;
  }
  return typeof value === 'string' && def.options.some((option) => option.value === value) ? value : undefined;
}

export interface ExecProgram {
  program: string;
  sha256: string;
}

export const PluginManifestSchema = z
  .object({
    id: PluginIdSchema,
    name: z.string().trim().min(1).max(60),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
    author: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).default(''),
    icon: IconSchema.default('puzzle'),
    engines: z.object({ tessera: z.string().min(1).max(40) }),
    permissions: z.array(PermissionEntrySchema).max(16).default([]),
    contributes: z
      .object({
        widgets: z.array(PluginWidgetSchema).max(32).default([]),
        themes: z.array(PluginThemeSchema).max(16).default([]),
        uiProvider: z.object({ entry: RelativePathSchema }).strict().nullable().default(null),
        settings: z.array(PluginSettingSchema).max(40).default([]),
      })
      .default({ widgets: [], themes: [], uiProvider: null, settings: [] }),
  })
  .superRefine((manifest, ctx) => {
    const ids = manifest.permissions.map((entry) => (typeof entry === 'string' ? entry : entry.id));
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) ctx.addIssue({ code: 'custom', path: ['permissions', index], message: `duplicate permission ${id}` });
    });
    const themes = manifest.contributes.themes.map((theme) => theme.id);
    themes.forEach((id, index) => {
      if (themes.indexOf(id) !== index) ctx.addIssue({ code: 'custom', path: ['contributes', 'themes', index], message: `duplicate theme ${id}` });
    });
    if (themes.length && !ids.includes('ui.theme')) {
      ctx.addIssue({ code: 'custom', path: ['contributes', 'themes'], message: 'themes need the ui.theme permission' });
    }
    const settingIds = manifest.contributes.settings.map((setting) => setting.id);
    manifest.contributes.settings.forEach((setting, index) => {
      if (settingIds.indexOf(setting.id) !== index) ctx.addIssue({ code: 'custom', path: ['contributes', 'settings', index], message: `duplicate setting ${setting.id}` });
      if (coerceSetting(setting, setting.default) === undefined) {
        ctx.addIssue({ code: 'custom', path: ['contributes', 'settings', index, 'default'], message: 'default does not match the setting' });
      }
      if (setting.type === 'number' && setting.min > setting.max) {
        ctx.addIssue({ code: 'custom', path: ['contributes', 'settings', index], message: 'min is above max' });
      }
    });
    if (manifest.contributes.uiProvider && !ids.includes('ui.provider')) {
      ctx.addIssue({ code: 'custom', path: ['contributes', 'uiProvider'], message: 'uiProvider needs the ui.provider permission' });
    }
    if (ids.includes('ui.provider') && !manifest.contributes.uiProvider) {
      ctx.addIssue({ code: 'custom', path: ['contributes', 'uiProvider'], message: 'ui.provider needs contributes.uiProvider' });
    }
  })
  .transform(({ permissions, ...rest }) => {
    let network: string[] = [];
    let exec: ExecProgram | null = null;
    let systemPrograms: string[] = [];
    let discordClientId: string | null = null;
    for (const entry of permissions) {
      if (typeof entry !== 'object') continue;
      if (entry.id === 'net' && 'domains' in entry) network = [...new Set(entry.domains)];
      if (entry.id === 'exec' && 'program' in entry) exec = { program: entry.program, sha256: entry.sha256 };
      if (entry.id === 'exec.system' && 'programs' in entry) systemPrograms = [...new Set(entry.programs)];
      if (entry.id === 'discord.rpc' && 'clientId' in entry) discordClientId = entry.clientId;
    }
    return {
      ...rest,
      permissions: permissions.map((entry) => (typeof entry === 'string' ? entry : entry.id)),
      network,
      exec,
      systemPrograms,
      discordClientId,
    };
  });
export type PluginManifest = z.output<typeof PluginManifestSchema>;

export function permissionKey(manifest: Pick<PluginManifest, 'network' | 'exec' | 'systemPrograms' | 'discordClientId'>, permission: Permission): string {
  if (permission === 'net') return `net[${[...manifest.network].sort().join(',')}]`;
  if (permission === 'exec' && manifest.exec) return `exec[${manifest.exec.program}@${manifest.exec.sha256}]`;
  if (permission === 'exec.system') return `exec.system[${[...manifest.systemPrograms].sort().join(',')}]`;
  if (permission === 'discord.rpc') return `discord.rpc[${manifest.discordClientId ?? ''}]`;
  return permission;
}

export function domainAllowed(domains: readonly string[], hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => (domain.startsWith('*.') ? host.endsWith(domain.slice(1)) : host === domain));
}

export const PluginModeSchema = z.enum(['installed', 'dev']);
export type PluginMode = z.infer<typeof PluginModeSchema>;

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  granted: Permission[];
  pending: Permission[];
  mode: PluginMode;
  integrity: 'ok' | 'dev' | 'tampered';
  integrityError: string | null;
  path: string;
  source: string;
  externalFolder: string | null;
  systemPrograms: Record<string, SystemProgram>;
}

export const PluginRefSchema = z.object({ id: PluginIdSchema }).strict();
export const SetPluginEnabledSchema = z.object({ id: PluginIdSchema, enabled: z.boolean() }).strict();
export const SetPluginGrantsSchema = z.object({ id: PluginIdSchema, granted: z.array(PermissionSchema).max(16) }).strict();
export const InstallLocalSchema = z
  .object({ path: z.string().min(1).max(500), granted: z.array(PermissionSchema).max(16), mode: PluginModeSchema })
  .strict();
export const PACKAGE_EXTENSION = 'tessera-plugin';
export const InstallPackageSchema = z.object({ token: z.uuid(), granted: z.array(PermissionSchema).max(16) }).strict();
export const InspectLocalSchema = z.object({ path: z.string().min(1).max(500).optional() }).strict().optional();

export const ReadTextSchema = z
  .object({
    id: z.uuid(),
    path: z
      .string()
      .min(1)
      .max(400)
      .refine((p) => !p.split(/[\\/]/).includes('..'), 'no parent segments'),
  })
  .strict();

export const MAX_TEXT_READ = 1024 * 1024;
export const MAX_TEXT_WRITE = 5 * 1024 * 1024;
export const MAX_BINARY_BYTES = 20 * 1024 * 1024;

export const PLUGIN_SCHEME = 'tessera-plugin';
export const PROVIDER_SCHEME = 'tessera-provider';

export const PluginPathSchema = z
  .string()
  .max(400)
  .refine((p) => !p.split(/[\\/]/).includes('..'), 'no parent segments');

export const FS_SCOPES = ['project', 'private', 'external'] as const;
export type FsScope = (typeof FS_SCOPES)[number];

export const PluginCallSchema = z
  .object({
    pluginId: PluginIdSchema,
    projectId: z.uuid().nullable(),
    method: z.string().min(1).max(60),
    params: z.unknown(),
  })
  .strict();
export type PluginCall = z.infer<typeof PluginCallSchema>;

export const PluginWatchSchema = z.object({ pluginId: PluginIdSchema, projectId: z.uuid(), watching: z.boolean() }).strict();
export const SetExternalFolderSchema = z.object({ id: PluginIdSchema, pick: z.boolean() }).strict();
export const PickProgramSchema = z.object({ id: PluginIdSchema, name: ProgramNameSchema, pick: z.boolean() }).strict();

export interface NetResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  encoding: 'text' | 'base64';
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface FilesChanged {
  projectId: string;
  paths: string[];
}

export interface AuditEntry {
  time: string;
  pluginId: string;
  action: string;
  target: string;
  allowed: boolean;
}

export const PluginSettingsRefSchema = z.object({ id: PluginIdSchema }).strict();
export const SetPluginSettingSchema = z
  .object({ id: PluginIdSchema, key: SettingKeySchema, value: z.union([z.boolean(), z.string().max(500), z.number().finite()]) })
  .strict();
export const ResetPluginSettingsSchema = z.object({ id: PluginIdSchema, key: SettingKeySchema.optional() }).strict();
