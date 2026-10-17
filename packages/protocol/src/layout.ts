import { z } from 'zod';

export const NodeIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

export interface PanelNode {
  type: 'panel';
  id: string;
  tabs: string[];
  active: number;
}

export interface SplitNode {
  type: 'split';
  id: string;
  dir: 'row' | 'col';
  sizes: number[];
  children: LayoutNode[];
}

export type LayoutNode = PanelNode | SplitNode;

export const PanelNodeSchema: z.ZodType<PanelNode> = z.object({
  type: z.literal('panel'),
  id: NodeIdSchema,
  tabs: z.array(NodeIdSchema).max(32),
  active: z.number().int().min(0),
});

export const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    PanelNodeSchema,
    z.object({
      type: z.literal('split'),
      id: NodeIdSchema,
      dir: z.enum(['row', 'col']),
      sizes: z.array(z.number().positive()).min(2).max(12),
      children: z.array(LayoutNodeSchema).min(2).max(12),
    }),
  ]),
);

export const WidgetTypeSchema = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*\/[a-z0-9-]+$/);

export const WidgetInstanceSchema = z.object({
  type: WidgetTypeSchema,
  state: z.record(z.string(), z.unknown()).default({}),
});
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;

export const WorkspaceSchema = z.object({
  id: NodeIdSchema,
  name: z.string().trim().min(1).max(40),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  root: LayoutNodeSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const ProjectLayoutSchema = z.object({
  formatVersion: z.literal(1),
  active: NodeIdSchema,
  workspaces: z.array(WorkspaceSchema).min(1).max(30),
  widgets: z.record(NodeIdSchema, WidgetInstanceSchema),
});
export type ProjectLayout = z.infer<typeof ProjectLayoutSchema>;

export const MAX_LAYOUT_BYTES = 512 * 1024;

export const SaveLayoutSchema = z
  .object({
    id: z.uuid(),
    layout: ProjectLayoutSchema,
  })
  .strict()
  .refine((value) => JSON.stringify(value.layout).length <= MAX_LAYOUT_BYTES, 'layout too large');

export const ListDirSchema = z
  .object({
    id: z.uuid(),
    path: z
      .string()
      .max(400)
      .refine((p) => !p.split(/[\\/]/).includes('..'), 'no parent segments'),
  })
  .strict();

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size: number;
}

export interface TexturePreview {
  data: string;
  width: number;
  height: number;
  format: string | null;
  mipmaps: number;
}

export function defaultLayout(): ProjectLayout {
  return {
    formatVersion: 1,
    active: 'ws-main',
    workspaces: [{ id: 'ws-main', name: 'Principal', icon: 'grid-1x2', root: { type: 'panel', id: 'p-main', tabs: [], active: 0 } }],
    widgets: {},
  };
}

export const NoteNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((name) => !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/^\.+$/.test(name), 'invalid note name');

export const MAX_NOTE_BYTES = 1024 * 1024;

export const NoteRefSchema = z.object({ id: z.uuid(), name: NoteNameSchema }).strict();
export const WriteNoteSchema = z
  .object({ id: z.uuid(), name: NoteNameSchema, content: z.string().max(MAX_NOTE_BYTES) })
  .strict();
export const CreateNoteSchema = z.object({ id: z.uuid(), name: NoteNameSchema, content: z.string().max(MAX_NOTE_BYTES).optional() }).strict();

export interface NoteInfo {
  name: string;
  updatedAt: string;
  size: number;
}
