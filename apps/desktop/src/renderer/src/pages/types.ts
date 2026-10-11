import type { AppInfo } from '@tessera/protocol';
import type { MessageKey } from '../i18n';
import type { UiProvider } from '../ui/provider';

export interface PageContext {
  ui: UiProvider;
  info: AppInfo;
}

export interface Page {
  id: string;
  icon: string;
  label: MessageKey;
  template: string;
  mount?(root: HTMLElement, ctx: PageContext): void;
}
