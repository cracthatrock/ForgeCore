import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type TextChannel,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SettingsStore, TicketRecord } from '../store.js';
import { readOptions } from './ticket-options.js';
import {
  setupView,
  setupModal,
  applyModal,
  panelView,
  type SetupSession,
} from './ticket-setup.js';
import { validateArchive } from './ticket-archive.js';

export type TicketInteraction =
  | ChatInputCommandInteraction<'cached' | 'raw'>
  | ButtonInteraction<'cached' | 'raw'>
  | ModalSubmitInteraction<'cached' | 'raw'>;
export type TicketAction = (
  interaction: TicketInteraction,
  store: SettingsStore,
  action: string,
  intake?: {
    subject: string;
    description: string;
    answers?: { label: string; value: string }[];
  },
) => Promise<unknown>;

const sessions = new Map<string, SetupSession>();
const cooldowns = new Map<string, number>();
const row = (...buttons: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const button = (action: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(`tickets:${action}`).setLabel(label).setStyle(style);

export function ticketView(record: TicketRecord) {
  const options = readOptions(record.options_json);
  const answers = record.answers_json
    ? (JSON.parse(record.answers_json) as { label: string; value: string }[])
    : [];
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(record.closed ? 0x64748b : options.ticketColor)
        .setTitle(record.closed ? 'Ticket closed' : options.ticketTitle)
        .setDescription(options.ticketMessage)
        .addFields(
          { name: 'Opened by', value: `<@${record.owner_id}>`, inline: true },
          {
            name: 'Assigned to',
            value: record.claimed_by ? `<@${record.claimed_by}>` : 'Unassigned',
            inline: true,
          },
          { name: 'Status', value: record.closed ? 'Closed' : 'Open', inline: true },
        )
        .addFields(
          { name: 'Request', value: (record.subject || 'Support request').slice(0, 100) },
          ...answers.map((answer) => ({
            name: answer.label,
            value: answer.value
              ? answer.value.slice(0, 700) + (answer.value.length > 700 ? '…' : '')
              : 'Not provided',
          })),
        )
        .setFooter({ text: options.footer }),
    ],
    components: [
      record.closed
        ? row(
            button('reopen', 'Reopen', ButtonStyle.Success),
            button('transcript', 'Export transcript'),
            button('delete', 'Delete ticket', ButtonStyle.Danger),
          )
        : row(
            button('claim', 'Claim', ButtonStyle.Primary),
            button('unclaim', 'Unclaim'),
            button('close', 'Close', ButtonStyle.Danger),
            button('transcript', 'Export transcript'),
          ),
    ],
    allowedMentions: { parse: [] as never[] },
  };
}

export async function refreshTicket(channel: TextChannel, record: TicketRecord) {
  if (!record.control_message_id) return;
  const message = await channel.messages
    .fetch(record.control_message_id)
    .catch(() => null);
  if (message) await message.edit(ticketView(record));
}

export async function beginSetup(interaction: TicketInteraction, store: SettingsStore) {
  for (const [key, session] of sessions)
    if (session.expires < Date.now()) sessions.delete(key);
  const config = store.ticketConfig(interaction.guildId!);
  const session: SetupSession = {
    userId: interaction.user.id,
    expires: Date.now() + 600_000,
    page: 0,
    staff: config?.staff_role_id,
    category: config?.category_id,
    panel: config?.panel_channel_id || undefined,
    options: readOptions(config?.options_json),
  };
  const message = await interaction.editReply(setupView(session));
  sessions.set(message.id, session);
}

export async function handleTicketUI(
  interaction: Interaction,
  store: SettingsStore,
  run: TicketAction,
) {
  if (
    (!interaction.isButton() &&
      !interaction.isModalSubmit() &&
      !interaction.isRoleSelectMenu() &&
      !interaction.isChannelSelectMenu()) ||
    !interaction.customId.startsWith('tickets:')
  )
    return false;
  const fail = (content: string) =>
    interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  try {
    if (!interaction.inGuild()) {
      await fail('Use this in a server.');
      return true;
    }
    if (!store.isEnabled(interaction.guildId, 'tickets')) {
      await fail('Tickets are disabled in this server.');
      return true;
    }
    const action = interaction.customId.slice(8);
    if (!action.startsWith('setup-')) {
      const key = `${interaction.guildId}:${interaction.user.id}`;
      const now = Date.now();
      for (const [id, expires] of cooldowns) {
        if (expires <= now) cooldowns.delete(id);
      }
      if ((cooldowns.get(key) || 0) > now) {
        await fail('Please wait a moment before trying another ticket action.');
        return true;
      }
      cooldowns.set(key, now + 1500);
    }
    if (action.startsWith('setup-')) {
      const sessionId = interaction.isModalSubmit()
        ? action.split(':')[1]
        : interaction.message.id;
      const session = sessions.get(sessionId);
      if (
        !session ||
        session.expires < Date.now() ||
        session.userId !== interaction.user.id
      ) {
        await fail(
          'This setup has expired or belongs to someone else. Run /ticket setup.',
        );
        return true;
      }
      const guild = await interaction.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(interaction.user.id);
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await fail('Manage Server is required.');
        return true;
      }
      const setupAction = action.split(':')[0];
      if (interaction.isModalSubmit()) {
        try {
          applyModal(
            setupAction,
            (id) => interaction.fields.getTextInputValue(id),
            session.options,
          );
        } catch (error) {
          await fail(error instanceof Error ? error.message : 'Invalid settings.');
          return true;
        }
        await interaction.deferUpdate();
        await interaction.editReply(setupView(session));
        return true;
      }
      if (
        interaction.isButton() &&
        ['setup-panel-style', 'setup-ticket-style', 'setup-form-style'].includes(action)
      ) {
        await interaction.showModal(setupModal(action, sessionId, session.options));
        return true;
      }
      if (action === 'setup-preview' && interaction.isButton()) {
        await interaction.reply({
          ...panelView(session.options),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      if (action === 'setup-back') session.page = Math.max(0, session.page - 1);
      if (action === 'setup-next') session.page = Math.min(3, session.page + 1);
      if (action === 'setup-toggle-form')
        session.options.formEnabled = !session.options.formEnabled;
      if (action === 'setup-clear-transcripts') session.options.transcriptChannel = null;
      if (interaction.isChannelSelectMenu() && action === 'setup-closed-category') {
        session.options.closedCategory = interaction.values[0] || null;
      }
      if (interaction.isChannelSelectMenu() && action === 'setup-transcripts')
        session.options.transcriptChannel = interaction.values[0];
      if (interaction.isRoleSelectMenu()) session.staff = interaction.values[0];
      if (interaction.isChannelSelectMenu() && action === 'setup-category')
        session.category = interaction.values[0];
      if (interaction.isChannelSelectMenu() && action === 'setup-panel')
        session.panel = interaction.values[0];
      if (action !== 'setup-publish') {
        await interaction.update(setupView(session));
        return true;
      }
      if (!session.staff || !session.category || !session.panel) {
        await fail('Complete all three selections.');
        return true;
      }
      await interaction.deferUpdate();
      const category = await guild.channels.fetch(session.category);
      const panel = await guild.channels.fetch(session.panel);
      const staff = await guild.roles.fetch(session.staff);
      const me = await guild.members.fetchMe();
      const needed = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ];
      if (
        category?.type !== ChannelType.GuildCategory ||
        panel?.type !== ChannelType.GuildText ||
        !staff ||
        staff.id === guild.id ||
        !panel.permissionsFor(me)?.has(needed) ||
        !category
          .permissionsFor(me)
          ?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])
      ) {
        await interaction.editReply({
          content:
            'Check your category, dedicated staff role, and bot permissions. The bot needs Manage Channels and Manage Roles in the category, and View Channel, Send Messages and Embed Links in the panel channel.',
          ...setupView(session),
        });
        return true;
      }
      if (session.options.closedCategory) {
        const closed = await guild.channels.fetch(session.options.closedCategory);
        if (
          closed?.type !== ChannelType.GuildCategory ||
          !closed
            .permissionsFor(me)
            ?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])
        ) {
          await interaction.editReply({
            ...setupView(session),
            content:
              'Choose a closed category where the bot has Manage Channels and Manage Roles.',
          });
          return true;
        }
      }
      if (session.options.transcriptChannel) {
        const archive = await guild.channels.fetch(session.options.transcriptChannel);
        const problem = await validateArchive(archive, session.staff);
        if (problem) {
          await interaction.editReply({ ...setupView(session), content: problem });
          return true;
        }
      }
      const message = await panel.send(panelView(session.options));
      store.configureTickets(guild.id, category.id, staff.id);
      store.savePanel(guild.id, panel.id, message.id);
      store.saveTicketOptions(guild.id, JSON.stringify(session.options));
      sessions.delete(interaction.message.id);
      await interaction.editReply({
        content: `Support panel published in <#${panel.id}>. Try the Get support button.`,
        embeds: [],
        components: [],
      });
      return true;
    }
    if (action === 'open' && interaction.isButton()) {
      const config = store.ticketConfig(interaction.guildId);
      if (
        !config ||
        config.panel_message_id !== interaction.message.id ||
        config.panel_channel_id !== interaction.channelId
      ) {
        await fail('This panel is outdated. Use the latest support panel.');
        return true;
      }
      const options = readOptions(config.options_json);
      if (!options.formEnabled) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await run(interaction, store, 'open');
        return true;
      }
      const modal = new ModalBuilder()
        .setCustomId(`tickets:intake:${interaction.message.id}`)
        .setTitle(options.formTitle)
        .addComponents(
          ...options.questions.map((question, index) =>
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId(`question-${index}`)
                .setLabel(question.label)
                .setStyle(
                  question.style === 'short'
                    ? TextInputStyle.Short
                    : TextInputStyle.Paragraph,
                )
                .setMaxLength(question.style === 'short' ? 100 : 1000)
                .setRequired(question.required),
            ),
          ),
        );
      await interaction.showModal(modal);
      return true;
    }
    if (action.startsWith('intake:') && interaction.isModalSubmit()) {
      const config = store.ticketConfig(interaction.guildId);
      if (
        config?.panel_message_id !== action.slice(7) ||
        config.panel_channel_id !== interaction.channelId
      ) {
        await fail('This panel is outdated.');
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const options = readOptions(config.options_json);
      const answers = options.questions.map((question, index) => ({
        label: question.label,
        value: interaction.fields.getTextInputValue(`question-${index}`).trim(),
      }));
      await run(interaction, store, 'open', {
        subject:
          answers.find((answer) => answer.value)?.value.slice(0, 100) ||
          'Support request',
        description: '',
        answers,
      });
      return true;
    }
    if (!interaction.isButton()) {
      await fail('Unsupported action.');
      return true;
    }
    const record = store.ticket(interaction.guildId, interaction.channelId);
    const confirm = action === 'confirm-close' || action === 'confirm-delete';
    if (!record || (!confirm && record.control_message_id !== interaction.message.id)) {
      await fail('Use the controls on the ticket status message.');
      return true;
    }
    if (action === 'delete') {
      const guild = await interaction.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(interaction.user.id);
      const role = record.staff_role_id || store.ticketConfig(guild.id)?.staff_role_id;
      if (
        !record.closed ||
        (!member.permissions.has(PermissionFlagsBits.ManageGuild) &&
          (!role || !member.roles.cache.has(role)))
      ) {
        await fail('Only staff can delete a closed ticket.');
        return true;
      }
      await interaction.reply({
        content:
          'Permanently delete this ticket channel? Messages cannot be recovered. If an archive is configured, a transcript must be saved successfully before deletion.',
        components: [
          row(button('confirm-delete', 'Permanently delete', ButtonStyle.Danger)),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (action === 'close') {
      const guild = await interaction.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(interaction.user.id);
      const role = record.staff_role_id || store.ticketConfig(guild.id)?.staff_role_id;
      if (
        member.id !== record.owner_id &&
        !member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        (!role || !member.roles.cache.has(role))
      ) {
        await fail('Only the owner or staff can close this ticket.');
        return true;
      }
      await interaction.reply({
        content:
          'Close this ticket? The conversation will be preserved and replies from the owner will be locked.',
        components: [row(button('confirm-close', 'Confirm close', ButtonStyle.Danger))],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (
      ![
        'claim',
        'unclaim',
        'reopen',
        'transcript',
        'confirm-close',
        'confirm-delete',
      ].includes(action)
    ) {
      await fail('Unsupported action.');
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await run(
      interaction,
      store,
      action === 'confirm-delete'
        ? 'delete'
        : action === 'confirm-close'
          ? 'close'
          : action,
    );
  } catch {
    console.error('Ticket interaction failed', { guildId: interaction.guildId });
    const message = {
      content: 'Could not complete that action. Check bot permissions and try again.',
      allowedMentions: { parse: [] as never[] },
    };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(message).catch(() => {});
    else
      await interaction
        .reply({ ...message, flags: MessageFlags.Ephemeral })
        .catch(() => {});
  }
  return true;
}
