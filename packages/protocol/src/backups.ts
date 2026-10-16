import { z } from 'zod';

export const BackupReasonSchema = z.enum(['manual', 'auto', 'restore', 'export']);
export type BackupReason = z.infer<typeof BackupReasonSchema>;

export const BackupIdSchema = z.string().regex(/^\d{1,6}$/);

export interface BackupInfo {
  id: string;
  number: number;
  createdAt: string;
  reason: BackupReason;
  note: string;
  files: number;
  size: number;
}

export const BackupListSchema = z.object({ id: z.uuid() }).strict();
export const CreateBackupSchema = z
  .object({ id: z.uuid(), reason: z.enum(['manual', 'auto']), note: z.string().trim().max(120).default('') })
  .strict();
export const BackupRefSchema = z.object({ id: z.uuid(), backup: BackupIdSchema }).strict();

export const SafeReasonSchema = z.enum(['flag', 'shift', 'crash']);
export type SafeReason = z.infer<typeof SafeReasonSchema>;

export const RestartSchema = z.object({ safeMode: z.boolean(), reason: SafeReasonSchema.optional() }).strict();
export const SafeApplySchema = z
  .object({
    disable: z.array(z.string().max(64)).max(200),
    resetLayouts: z.boolean(),
    resetLook: z.boolean(),
    clearCache: z.boolean(),
  })
  .strict();
