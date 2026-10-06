import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { parseColor, parseQuestions, type TicketOptions } from './ticket-options.js';

export interface SetupSession {
  userId: string;
  expires: number;
  staff?: string;
  category?: string;
  panel?: string;
  page: number;
  options: TicketOptions;
}

const button = (id: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(`tickets:${id}`).setLabel(label).setStyle(style);
const buttons = (...items: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(items);

export function panelView(options: TicketOptions) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(options.panelColor)
        .setTitle(options.panelTitle)
        .setDescription(options.panelDescription)
        .setFooter({ text: options.footer }),
    ],
    components: [buttons(button('open', options.buttonLabel, ButtonStyle.Primary))],
    allowedMentions: { parse: [] as never[] },
  };
}

export function setupView(session: SetupSession) {
  const o = session.options;
  const titles = ['Routing', 'Appearance', 'Intake form', 'Transcript archive'];
  const embed = new EmbedBuilder()
    .setColor(o.panelColor)
    .setTitle(`Support desk setup • ${titles[session.page]}`)
    .setFooter({ text: `Step ${session.page + 1} of 4 • Draft expires in 10 minutes` });
  const components: (
    | ActionRowBuilder<ButtonBuilder>
    | ActionRowBuilder<RoleSelectMenuBuilder>
    | ActionRowBuilder<ChannelSelectMenuBuilder>
  )[] = [];
  if (session.page === 0) {
    embed
      .setDescription('Choose where tickets are created and which role handles support.')
      .addFields(
        {
          name: 'Support role',
          value: session.staff ? `<@&${session.staff}>` : 'Not selected',
          inline: true,
        },
        {
          name: 'Category',
          value: session.category ? `<#${session.category}>` : 'Not selected',
          inline: true,
        },
        {
          name: 'Panel channel',
          value: session.panel ? `<#${session.panel}>` : 'Not selected',
          inline: true,
        },
      );
    embed.addFields({
      name: 'Closed category',
      value: o.closedCategory ? `<#${o.closedCategory}>` : 'Keep in original category',
      inline: true,
    });
    components.push(
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('tickets:setup-role')
          .setPlaceholder('Support role'),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('tickets:setup-category')
          .setPlaceholder('Ticket category')
          .setChannelTypes(ChannelType.GuildCategory),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('tickets:setup-panel')
          .setPlaceholder('Public panel channel')
          .setChannelTypes(ChannelType.GuildText),
      ),
    );
    components.push(
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('tickets:setup-closed-category')
          .setPlaceholder('Optional closed-ticket category')
          .setChannelTypes(ChannelType.GuildCategory)
          .setMinValues(0)
          .setMaxValues(1),
      ),
    );
  } else if (session.page === 1) {
    embed
      .setDescription(
        'Customize your public panel and the welcome card inside each ticket.',
      )
      .addFields(
        { name: 'Panel title', value: o.panelTitle },
        { name: 'Ticket title', value: o.ticketTitle },
        {
          name: 'Colors',
          value: `Panel: #${o.panelColor.toString(16).padStart(6, '0')} • Ticket: #${o.ticketColor.toString(16).padStart(6, '0')}`,
        },
      );
    components.push(
      buttons(
        button('setup-panel-style', 'Edit panel embed'),
        button('setup-ticket-style', 'Edit ticket embed'),
        button('setup-preview', 'Preview panel'),
      ),
    );
  } else if (session.page === 2) {
    embed
      .setDescription(
        o.formEnabled
          ? 'Members complete these questions before their ticket opens.'
          : 'Members open a channel immediately, with your configured welcome card.',
      )
      .addFields(
        { name: 'Form', value: o.formEnabled ? 'Enabled' : 'Disabled' },
        {
          name: 'Questions',
          value: o.questions
            .map(
              (q, i) =>
                `${i + 1}. ${q.label} (${q.required ? 'required' : 'optional'}, ${q.style})`,
            )
            .join('\n'),
        },
      );
    components.push(
      buttons(
        button('setup-toggle-form', o.formEnabled ? 'Disable form' : 'Enable form'),
        button('setup-form-style', 'Configure questions'),
      ),
    );
  } else {
    embed
      .setDescription(
        'Choose a private staff channel to save transcripts automatically when tickets close. Exports also save a copy there. Message Content Intent is required for full transcripts.',
      )
      .addFields({
        name: 'Archive channel',
        value: o.transcriptChannel
          ? `<#${o.transcriptChannel}>`
          : 'Not configured — private downloads only',
      });
    components.push(
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('tickets:setup-transcripts')
          .setPlaceholder('Private transcript channel')
          .setChannelTypes(ChannelType.GuildText),
      ),
    );
    components.push(buttons(button('setup-clear-transcripts', 'Disable archive')));
  }
  components.push(
    buttons(
      button('setup-back', 'Back').setDisabled(session.page === 0),
      button('setup-next', 'Next').setDisabled(session.page === 3),
      button('setup-publish', 'Publish panel', ButtonStyle.Success).setDisabled(
        !session.staff || !session.category || !session.panel,
      ),
    ),
  );
  return { embeds: [embed], components, allowedMentions: { parse: [] as never[] } };
}

export function setupModal(action: string, messageId: string, options: TicketOptions) {
  const modal = new ModalBuilder()
    .setCustomId(`tickets:${action}:${messageId}`)
    .setTitle('Customize support desk');
  const input = (
    id: string,
    label: string,
    value: string,
    max: number,
    paragraph = false,
  ) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setValue(value)
        .setMaxLength(max)
        .setRequired(true)
        .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short),
    );
  if (action === 'setup-panel-style') {
    modal.addComponents(
      input('title', 'Panel title', options.panelTitle, 100),
      input('description', 'Panel description', options.panelDescription, 1500, true),
      input(
        'color',
        'Hex color (example: #5865F2)',
        `#${options.panelColor.toString(16).padStart(6, '0')}`,
        7,
      ),
      input('button', 'Button label', options.buttonLabel, 80),
      input('footer', 'Footer', options.footer, 200),
    );
  } else if (action === 'setup-ticket-style') {
    modal.addComponents(
      input('title', 'Ticket title', options.ticketTitle, 100),
      input('description', 'Ticket welcome message', options.ticketMessage, 1500, true),
      input(
        'color',
        'Hex color (example: #5865F2)',
        `#${options.ticketColor.toString(16).padStart(6, '0')}`,
        7,
      ),
    );
  } else {
    modal.addComponents(
      input('title', 'Form title', options.formTitle, 45),
      input(
        'questions',
        '1–5 lines: required|short|Question',
        options.questions
          .map((q) => `${q.required ? 'required' : 'optional'}|${q.style}|${q.label}`)
          .join('\n'),
        500,
        true,
      ),
    );
  }
  return modal;
}

export function applyModal(
  action: string,
  get: (key: string) => string,
  options: TicketOptions,
) {
  const required =
    action === 'setup-panel-style'
      ? ['title', 'description', 'color', 'button', 'footer']
      : action === 'setup-ticket-style'
        ? ['title', 'description', 'color']
        : ['title', 'questions'];
  if (required.some((key) => !get(key).trim())) {
    throw new Error('Settings cannot contain only spaces.');
  }
  if (action === 'setup-panel-style') {
    const color = parseColor(get('color'));
    Object.assign(options, {
      panelTitle: get('title').trim(),
      panelDescription: get('description').trim(),
      panelColor: color,
      buttonLabel: get('button').trim(),
      footer: get('footer').trim(),
    });
  } else if (action === 'setup-ticket-style') {
    const color = parseColor(get('color'));
    Object.assign(options, {
      ticketTitle: get('title').trim(),
      ticketMessage: get('description').trim(),
      ticketColor: color,
    });
  } else {
    const questions = parseQuestions(get('questions'));
    Object.assign(options, { formTitle: get('title').trim(), questions });
  }
}
