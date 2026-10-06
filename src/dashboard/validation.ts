import {
  defaultOptions,
  parseColor,
  parseQuestions,
} from '../extensions/ticket-options.js';

export function validateSettings(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected ticket settings.');
  }
  const input = value as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
      throw new Error(`${key} must contain 1–${max} characters.`);
    }
    return value.trim();
  };
  const id = (key: string, optional = false): string | null => {
    const value = input[key];
    if (optional && (value === null || value === '')) {
      return null;
    }
    if (typeof value !== 'string' || !/^\d{17,20}$/.test(value)) {
      throw new Error(`Choose a valid ${key}.`);
    }
    return value;
  };
  if (typeof input.formEnabled !== 'boolean') {
    throw new Error('Choose whether to enable the form.');
  }
  const category = id('category')!;
  return {
    category,
    staff: id('staff')!,
    panel: id('panel')!,
    options: {
      ...structuredClone(defaultOptions),
      panelTitle: text('panelTitle', 100),
      panelDescription: text('panelDescription', 1500),
      panelColor: parseColor(text('panelColor', 7)),
      buttonLabel: text('buttonLabel', 80),
      footer: text('footer', 200),
      ticketTitle: text('ticketTitle', 100),
      ticketMessage: text('ticketMessage', 1500),
      ticketColor: parseColor(text('ticketColor', 7)),
      formEnabled: input.formEnabled,
      formTitle: text('formTitle', 45),
      questions: parseQuestions(text('questions', 500)),
      transcriptChannel: id('transcriptChannel', true),
      closedCategory: id('closedCategory', true),
      openCategory: category,
    },
  };
}

export function canManage(permissions: string) {
  try {
    return (BigInt(permissions) & (8n | 32n)) !== 0n;
  } catch {
    return false;
  }
}
