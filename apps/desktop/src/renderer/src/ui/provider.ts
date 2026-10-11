import { createAtrium, type Atrium, type Command, type MotionMode, type ThemeName } from 'atrium-ui';

export interface ModalSpec {
  title: string;
  icon?: string;
  body: Node;
  closeText: string;
}

export interface UiProvider {
  readonly name: string;
  toast(kind: 'success' | 'info' | 'warning' | 'error', message: string): void;
  modal(spec: ModalSpec): void;
  registerCommands(commands: Command[]): void;
  setTheme(theme: ThemeName): void;
  setMotion(motion: MotionMode): void;
  readonly atrium: Atrium;
}

export function createAtriumProvider(options: { theme: ThemeName; motion: MotionMode; t: (key: string) => string | null }): UiProvider {
  const atrium = createAtrium({ theme: options.theme, motion: options.motion, t: options.t });
  return {
    name: 'atrium-ui',
    atrium,
    toast: (kind, message) => atrium.toast[kind](message),
    modal: ({ title, icon, body, closeText }) => {
      atrium.modal.open({ title, icon, body, buttons: [{ text: closeText, variant: 'primary' }] });
    },
    registerCommands: (commands) => atrium.commands.register(commands),
    setTheme: (theme) => atrium.setTheme(theme),
    setMotion: (motion) => atrium.setMotion(motion),
  };
}
