import { z } from 'zod';
import { t } from '../i18n';
import type { UiProvider } from '../ui/provider';
import '../components/dialogs/dialogs.css';
import './form.css';

const Id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const Label = z.string().trim().min(1).max(60);

const FieldSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('select'),
      id: Id,
      label: Label,
      options: z
        .array(z.object({ value: z.string().max(100), label: z.string().trim().min(1).max(60) }).strict())
        .min(1)
        .max(40),
      value: z.string().max(100).optional(),
    })
    .strict(),
  z.object({ type: z.literal('text'), id: Id, label: Label, value: z.string().max(500).optional(), placeholder: z.string().max(100).optional() }).strict(),
  z.object({ type: z.literal('checkbox'), id: Id, label: Label, value: z.boolean().optional() }).strict(),
]);

export const FormSchema = z
  .object({
    title: z.string().trim().min(1).max(60),
    icon: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    message: z.string().max(300).optional(),
    confirmText: z.string().trim().min(1).max(24).optional(),
    fields: z.array(FieldSchema).min(1).max(12),
  })
  .strict();

export type FormSpec = z.infer<typeof FormSchema>;
type FormValues = Record<string, string | boolean>;

const busy = new Set<string>();

export function showForm(ui: UiProvider, owner: string, pluginName: string, spec: FormSpec): Promise<FormValues | null> {
  if (busy.has(owner)) return Promise.reject(new Error('a form is already open'));
  busy.add(owner);
  const body = document.createElement('form');
  body.className = 'tessera-plugin-form';
  const source = document.createElement('p');
  source.className = 'tessera-plugin-form-source';
  source.textContent = spec.message ? `${pluginName} · ${spec.message}` : pluginName;
  body.append(source);
  const read: (() => [string, string | boolean])[] = [];
  spec.fields.forEach((field, index) => {
    const label = document.createElement('label');
    label.className = `tessera-plugin-form-field is-${field.type}`;
    const text = document.createElement('span');
    text.textContent = field.label;
    const id = `tessera-form-${index}`;
    label.htmlFor = id;
    if (field.type === 'checkbox') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = field.value ?? false;
      label.append(input, text);
      read.push(() => [field.id, input.checked]);
    } else if (field.type === 'text') {
      const input = document.createElement('input');
      input.className = 'atrium-input';
      input.id = id;
      input.value = field.value ?? '';
      input.placeholder = field.placeholder ?? '';
      label.append(text, input);
      read.push(() => [field.id, input.value]);
    } else {
      const select = document.createElement('select');
      select.id = id;
      for (const option of field.options) select.append(new Option(option.label, option.value, false, option.value === field.value));
      label.append(text, select);
      ui.atrium.select(select);
      read.push(() => [field.id, select.value]);
    }
    body.append(label);
  });

  return new Promise((resolve) => {
    let values: FormValues | null = null;
    const modal = ui.atrium.modal.open({
      title: spec.title,
      icon: spec.icon,
      body,
      buttons: [
        { text: t('dialog.cancel'), variant: 'cancel' },
        { text: spec.confirmText ?? t('dialog.ok'), variant: 'primary', autofocus: true, onClick: () => void (values = Object.fromEntries(read.map((get) => get()))) },
      ],
      onClose: () => {
        busy.delete(owner);
        resolve(values);
      },
    });
    body.addEventListener('submit', (event) => {
      event.preventDefault();
      values = Object.fromEntries(read.map((get) => get()));
      void modal.close();
    });
  });
}
