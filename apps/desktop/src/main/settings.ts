import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, SettingsSchema, type Settings, type SettingsPatch } from '@tessera/protocol';

export class SettingsStore extends EventEmitter<{ changed: [Settings] }> {
  private settings: Settings = DEFAULT_SETTINGS;
  private readonly file: string;

  constructor(userDataDir: string) {
    super();
    this.file = join(userDataDir, 'settings.json');
  }

  get current(): Settings {
    return this.settings;
  }

  async load(): Promise<Settings> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch {
      return this.settings;
    }

    const parsed = SettingsSchema.safeParse(safeJson(raw));
    if (parsed.success) {
      this.settings = parsed.data;
    } else {
      console.warn('[settings] invalid settings.json, using defaults', parsed.error.issues);
      await rename(this.file, join(dirname(this.file), 'settings.invalid.json')).catch(() => {});
    }
    return this.settings;
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    this.settings = SettingsSchema.parse({ ...this.settings, ...patch });
    await this.save();
    this.emit('changed', this.settings);
    return this.settings;
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    await rename(tmp, this.file);
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
