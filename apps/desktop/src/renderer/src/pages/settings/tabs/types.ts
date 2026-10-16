import type { AppInfo, Settings, SettingsPatch } from '@tessera/protocol';
import type { MessageKey } from '../../../i18n';
import type { UiProvider } from '../../../ui/provider';

export interface TabContext {
  ui: UiProvider;
  info: AppInfo;
  settings: Settings;
  update(patch: SettingsPatch): Promise<void>;
  rerender(): void;
  openTab(id: string): void;
}

export interface SettingsTab {
  id: string;
  icon: string;
  label: MessageKey;
  bottom?: boolean;
  render(ctx: TabContext): HTMLElement[];
}
