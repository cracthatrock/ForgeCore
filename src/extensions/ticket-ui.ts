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

export type TicketInteraction =
  | ChatInputCommandInteraction<'cached' | 'raw'>
  | ButtonInteraction<'cached' | 'raw'>
  | ModalSubmitInteraction<'cached' | 'raw'>;
export type TicketAction = (
  interaction: TicketInteraction,
  store: SettingsStore,
  action: string,
  intake?: { subject: string; description: string },
) => Promise<unknown>;

const sessions = new Map<
  string,
  { userId: string; expires: number; staff?: string; category?: string; panel?: string }
>();
const cooldowns = new Map<string, number>();
const row = (...buttons: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const button = (action: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(`tickets:${action}`).setLabel(label).setStyle(style);

export function ticketView(record: TicketRecord) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(record.closed ? 0x64748b : 0x5865f2)
        .setTitle(record.closed ? 'Ticket closed' : 'Support ticket')
        .setDescription(record.subject || 'Support request')
        .addFields(
          { name: 'Opened by', value: `<@${record.owner_id}>`, inline: true },
          {
            name: 'Assigned to',
            value: record.claimed_by ? `<@${record.claimed_by}>` : 'Unassigned',
            inline: true,
          },
          { name: 'Status', value: record.closed ? 'Closed' : 'Open', inline: true },
        )
        .setFooter({ text: 'ForgeCore • Private support' }),
    ],
    components: [
      record.closed
        ? row(
            button('reopen', 'Reopen', ButtonStyle.Success),
            button('transcript', 'Export transcript'),
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

function setupView(session: { staff?: string; category?: string; panel?: string }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Set up your support desk')
    .setDescription(
      'Choose your support team, ticket category and public panel channel. Then publish your panel.',
    )
    .addFields(
      {
        name: 'Support role',
        value: session.staff ? `<@&${session.staff}>` : 'Not selected',
      },
      {
        name: 'Ticket category',
        value: session.category ? `<#${session.category}>` : 'Not selected',
      },
      {
        name: 'Panel channel',
        value: session.panel ? `<#${session.panel}>` : 'Not selected',
      },
    )
    .setFooter({
      text: 'Setup expires after 10 minutes. Existing tickets are preserved.',
    });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('tickets:setup-role')
          .setPlaceholder('Select a support role'),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('tickets:setup-category')
          .setPlaceholder('Select the ticket category')
          .setChannelTypes(ChannelType.GuildCategory),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('tickets:setup-panel')
          .setPlaceholder('Select the public panel channel')
          .setChannelTypes(ChannelType.GuildText),
      ),
      row(
        button('setup-publish', 'Publish support panel', ButtonStyle.Success).setDisabled(
          !session.staff || !session.category || !session.panel,
        ),
      ),
    ],
    allowedMentions: { parse: [] as never[] },
  };
}

export async function beginSetup(interaction: TicketInteraction) {
  for (const [key, session] of sessions)
    if (session.expires < Date.now()) sessions.delete(key);
  const session: {
    userId: string;
    expires: number;
    staff?: string;
    category?: string;
    panel?: string;
  } = { userId: interaction.user.id, expires: Date.now() + 600_000 };
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
    if (action.startsWith('setup-') && !interaction.isModalSubmit()) {
      const session = sessions.get(interaction.message.id);
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
      const message = await panel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('How can we help?')
            .setDescription(
              'Need help or have a question? Open a private ticket with our support team.\n\nClick below and tell us a little about your request.',
            )
            .setFooter({ text: 'One open ticket per member • ForgeCore' }),
        ],
        components: [row(button('open', 'Get support', ButtonStyle.Primary))],
        allowedMentions: { parse: [] },
      });
      store.configureTickets(guild.id, category.id, staff.id);
      store.savePanel(guild.id, panel.id, message.id);
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
      const modal = new ModalBuilder()
        .setCustomId(`tickets:intake:${interaction.message.id}`)
        .setTitle('Contact support')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('subject')
              .setLabel('What do you need help with?')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(100)
              .setRequired(true),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('description')
              .setLabel('Tell us more')
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(2000)
              .setRequired(true),
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
      await run(interaction, store, 'open', {
        subject: interaction.fields.getTextInputValue('subject').trim(),
        description: interaction.fields.getTextInputValue('description').trim(),
      });
      return true;
    }
    if (!interaction.isButton()) {
      await fail('Unsupported action.');
      return true;
    }
    const record = store.ticket(interaction.guildId, interaction.channelId);
    const confirm = action === 'confirm-close';
    if (!record || (!confirm && record.control_message_id !== interaction.message.id)) {
      await fail('Use the controls on the ticket status message.');
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
    if (!['claim', 'unclaim', 'reopen', 'transcript', 'confirm-close'].includes(action)) {
      await fail('Unsupported action.');
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await run(interaction, store, confirm ? 'close' : action);
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
