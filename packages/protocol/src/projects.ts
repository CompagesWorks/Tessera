import { z } from 'zod';

export const ProjectKindSchema = z.enum(['skin', 'stage', 'ui', 'audio', 'effect', 'other']);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

export const ProjectStatusSchema = z.enum(['draft', 'wip', 'done', 'published']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const IdSchema = z.uuid();

export const ProjectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((name) => !/[<>:"/\\|?*\u0000-\u001f]/.test(name), 'invalid characters');

export const TagSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(32),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type Tag = z.infer<typeof TagSchema>;

export const CollectionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(48),
});
export type Collection = z.infer<typeof CollectionSchema>;

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  kind: ProjectKind;
  status: ProjectStatus;
  tags: string[];
  collection: string | null;
  favorite: boolean;
  cover: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpened: string | null;
  missing: boolean;
}

export interface HomeData {
  projects: ProjectSummary[];
  tags: Tag[];
  collections: Collection[];
  defaultLocation: string;
}

export const CreateProjectSchema = z
  .object({
    name: ProjectNameSchema,
    kind: ProjectKindSchema,
    location: z.string().min(1),
  })
  .strict();
export type CreateProjectRequest = z.infer<typeof CreateProjectSchema>;

export const ProjectPatchSchema = z
  .object({
    name: ProjectNameSchema,
    kind: ProjectKindSchema,
    status: ProjectStatusSchema,
    tags: z.array(IdSchema).max(32),
    collection: IdSchema.nullable(),
    favorite: z.boolean(),
  })
  .partial()
  .strict();
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;

export const ProjectRefSchema = z.object({ id: IdSchema }).strict();

export const UpdateProjectSchema = z.object({ id: IdSchema, patch: ProjectPatchSchema }).strict();

export const UpsertTagSchema = TagSchema.partial({ id: true }).strict();
export const UpsertCollectionSchema = CollectionSchema.partial({ id: true }).strict();
