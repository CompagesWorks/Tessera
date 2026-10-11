import { join } from 'node:path';
import { z } from 'zod';
import { CollectionSchema, IdSchema, ProjectKindSchema, ProjectStatusSchema, TagSchema } from '@tessera/protocol';

export const TESSERA_DIR = '.tessera';
export const SOURCES_DIR = 'sources';
export const COVER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const MAX_COVER_BYTES = 10 * 1024 * 1024;

export const projectFile = (root: string) => join(root, TESSERA_DIR, 'project.json');
export const metaFile = (root: string) => join(root, TESSERA_DIR, 'meta.json');
export const coverFile = (root: string, ext: string) => join(root, TESSERA_DIR, `cover.${ext}`);

export const ProjectFileSchema = z.object({
  formatVersion: z.literal(1),
  id: IdSchema,
  name: z.string().min(1),
  game: z.literal('ssbu'),
  createdAt: z.iso.datetime(),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const MetaFileSchema = z.object({
  formatVersion: z.literal(1),
  kind: ProjectKindSchema,
  status: ProjectStatusSchema,
  tags: z.array(IdSchema),
  collection: IdSchema.nullable(),
  favorite: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type MetaFile = z.infer<typeof MetaFileSchema>;

export const RegistryEntrySchema = z.object({
  id: IdSchema,
  path: z.string().min(1),
  name: z.string().min(1),
  lastOpened: z.iso.datetime().nullable(),
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export const RegistrySchema = z.object({
  formatVersion: z.literal(1),
  projects: z.array(RegistryEntrySchema),
  tags: z.array(TagSchema),
  collections: z.array(CollectionSchema),
});
export type Registry = z.infer<typeof RegistrySchema>;

export const emptyRegistry = (): Registry => ({ formatVersion: 1, projects: [], tags: [], collections: [] });
