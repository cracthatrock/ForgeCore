export interface FormQuestion {
  label: string;
  required: boolean;
  style: 'short' | 'paragraph';
}

export interface TicketOptions {
  panelTitle: string;
  panelDescription: string;
  panelColor: number;
  buttonLabel: string;
  footer: string;
  ticketTitle: string;
  ticketMessage: string;
  ticketColor: number;
  formEnabled: boolean;
  formTitle: string;
  questions: FormQuestion[];
  transcriptChannel: string | null;
}

export const defaultOptions: TicketOptions = {
  panelTitle: 'How can we help?',
  panelDescription:
    'Open a private conversation with our support team. Click below to get started.',
  panelColor: 0x5865f2,
  buttonLabel: 'Get support',
  footer: 'ForgeCore • Private support',
  ticketTitle: 'Support ticket',
  ticketMessage:
    'Our team will be with you shortly. Keep your request in this channel so we can help.',
  ticketColor: 0x5865f2,
  formEnabled: true,
  formTitle: 'Contact support',
  questions: [
    { label: 'What do you need help with?', required: true, style: 'short' },
    { label: 'Tell us more', required: true, style: 'paragraph' },
  ],
  transcriptChannel: null,
};

export function readOptions(json?: string | null): TicketOptions {
  return { ...structuredClone(defaultOptions), ...(json ? JSON.parse(json) : {}) };
}

export function parseColor(value: string) {
  if (!/^#?[0-9a-f]{6}$/i.test(value.trim())) {
    throw new Error('Use a six-digit hex color, such as #5865F2.');
  }
  return parseInt(value.trim().replace('#', ''), 16);
}

export function parseQuestions(value: string): FormQuestion[] {
  const lines = value
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  if (lines.length < 1 || lines.length > 5) {
    throw new Error('Add between one and five questions.');
  }
  return lines.map((line) => {
    const [requirement, style, ...parts] = line.split('|');
    const label = parts.join('|').trim();
    if (
      !['required', 'optional'].includes(requirement.trim()) ||
      !['short', 'paragraph'].includes(style?.trim()) ||
      !label ||
      label.length > 45
    ) {
      throw new Error(
        'Each line must be required|short|Question or optional|paragraph|Question. Labels must be 1–45 characters.',
      );
    }
    return {
      label,
      required: requirement.trim() === 'required',
      style: style.trim() as FormQuestion['style'],
    };
  });
}
