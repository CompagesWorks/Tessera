import type { Language } from '@tessera/protocol';

const atriumFr: Record<string, string> = {
  'Close': 'Fermer',
  'Cancel': 'Annuler',
  'Confirm': 'Confirmer',
  'OK': 'OK',
  'Command palette': 'Palette de commandes',
  'Type a command or search…': 'Tape une commande ou cherche…',
  'to navigate': 'naviguer',
  'to run': 'lancer',
  'to close': 'fermer',
  'No matching commands': 'Aucune commande trouvée',
};

export function translateAtrium(text: string, language: Language): string | null {
  return language === 'fr' ? (atriumFr[text] ?? null) : null;
}
