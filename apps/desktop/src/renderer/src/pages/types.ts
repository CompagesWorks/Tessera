import type { AppContext } from '../app/context';
import type { MessageKey } from '../i18n';

export interface Page {
  id: string;
  icon: string;
  label: MessageKey;
  template: string;
  bottom?: boolean;
  mount?(root: HTMLElement, ctx: AppContext): void;
  onLanguageChange?(root: HTMLElement): void;
}
