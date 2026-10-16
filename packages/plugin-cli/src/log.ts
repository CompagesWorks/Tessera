const color = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);

export class CliError extends Error {}

export const log = {
  step: (text: string) => console.log(`${paint(36, '›')} ${text}`),
  ok: (text: string) => console.log(`${paint(32, '✓')} ${text}`),
  warn: (text: string) => console.warn(`${paint(33, '!')} ${text}`),
  fail: (text: string) => console.error(`${paint(31, '✗')} ${text}`),
  dim: (text: string) => paint(90, text),
};
