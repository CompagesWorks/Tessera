import { z } from 'zod';
import { ProjectKindSchema } from './projects';

export interface GbFile {
  id: number;
  name: string;
  size: number;
  md5: string;
  url: string;
  clean: boolean;
}

export interface GbMod {
  id: number;
  name: string;
  url: string;
  author: string;
  category: string;
  images: string[];
  thumbnails: string[];
  files: GbFile[];
  license: { yes: string[]; ask: string[]; no: string[] };
  remix: 'yes' | 'ask' | 'no' | 'unknown';
  credits: { group: string; authors: string[] }[];
}

export interface GbProgress {
  token: string;
  phase: 'download' | 'extract' | 'copy';
  done: number;
  total: number;
}

export const GbLinkSchema = z.object({ url: z.string().trim().min(1).max(300) }).strict();

export const GbImportSchema = z
  .object({
    modId: z.number().int().positive(),
    fileId: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    kind: ProjectKindSchema,
    location: z.string().min(1).max(500),
    token: z.string().regex(/^[a-z0-9-]{1,40}$/),
  })
  .strict();
