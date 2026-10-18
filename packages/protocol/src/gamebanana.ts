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

export interface GbOwnMod {
  id: number;
  name: string;
  url: string;
  category: string;
  thumbnail: string | null;
  likes: number;
  views: number;
  comments: number;
  added: number;
}


export interface GbStamp {
  title: string;
  category: string;
  count: number;
}

export interface GbPost {
  id: number;
  author: string;
  authorId: number;
  avatar: string | null;
  submitter: boolean;
  text: string;
  date: number;
  replies: number;
  stamps: GbStamp[];
}

export interface GbComment extends GbPost {
  modId: number;
  modName: string;
  url: string;
}

export interface GbMember {
  mods: GbOwnMod[];
  comments: GbComment[];
  session: boolean;
}

export interface GbAnalytics {
  dates: string[];
  series: { title: string; color: string | null; values: number[] }[];
}

export const GbModRefSchema = z.object({ modId: z.number().int().positive() }).strict();

export const GbPostsSchema = z.union([z.object({ modId: z.number().int().positive() }).strict(), z.object({ postId: z.number().int().positive() }).strict()]);

export interface GbStampChoice {
  available: { id: number; title: string; category: string; locked: boolean }[];
  mine: number[];
}

export const GbPostRefSchema = z.object({ postId: z.number().int().positive() }).strict();

export const GbStampSchema = z.object({ postId: z.number().int().positive(), stampIds: z.array(z.number().int().nonnegative()).max(32) }).strict();

export const GbReplySchema = z.object({ postId: z.number().int().positive(), text: z.string().trim().min(1).max(5000) }).strict();
