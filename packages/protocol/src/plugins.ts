import { z } from 'zod';

export const WIDGET_CATEGORIES = ['project', 'files', 'editing', 'media', 'publishing', 'tools', 'other'] as const;
export const WidgetCategorySchema = z.enum(WIDGET_CATEGORIES);
export type WidgetCategory = z.infer<typeof WidgetCategorySchema>;

export const PERMISSIONS = ['fs.project.read'] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

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

const IconSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const PluginWidgetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().trim().min(1).max(40),
  description: z.string().trim().max(120).default(''),
  icon: IconSchema.default('puzzle'),
  category: WidgetCategorySchema.default('other'),
  entry: RelativePathSchema,
});
export type PluginWidget = z.infer<typeof PluginWidgetSchema>;

export const PluginManifestSchema = z.object({
  id: PluginIdSchema,
  name: z.string().trim().min(1).max(60),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
  author: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  icon: IconSchema.default('puzzle'),
  engines: z.object({ tessera: z.string().min(1).max(40) }),
  permissions: z.array(PermissionSchema).max(16).default([]),
  contributes: z
    .object({
      widgets: z.array(PluginWidgetSchema).max(32).default([]),
    })
    .default({ widgets: [] }),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export type PluginTrust = 'builtin' | 'local';

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  granted: Permission[];
  trust: PluginTrust;
  path: string;
}

export const PluginRefSchema = z.object({ id: PluginIdSchema }).strict();
export const SetPluginEnabledSchema = z.object({ id: PluginIdSchema, enabled: z.boolean() }).strict();
export const SetPluginGrantsSchema = z.object({ id: PluginIdSchema, granted: z.array(PermissionSchema).max(16) }).strict();
export const InstallLocalSchema = z.object({ path: z.string().min(1).max(500), granted: z.array(PermissionSchema).max(16) }).strict();

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

export const PLUGIN_SCHEME = 'tessera-plugin';
