import {
  AttachmentBuilder,
  ChannelType,
  GatewayIntentBits,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import type { Extension, CommandContext } from '../types.js';
import type { SettingsStore } from '../store.js';
import {
  beginSetup,
  handleTicketUI,
  refreshTicket,
  ticketView,
  type TicketInteraction,
} from './ticket-ui.js';

const locks = new Set<string>();
const permissions = PermissionFlagsBits;

async function transcript(channel: TextChannel) {
  const lines: string[] = [];
  let before: string | undefined;

  // Bound memory and attachment size; newest 1,000 messages, in chronological order.
  for (let page = 0; page < 10; page++) {
    const messages = await channel.messages.fetch({ limit: 100, before });
    if (!messages.size) {
      break;
    }

    const ordered = [...messages.values()].sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp,
    );
    for (const message of ordered) {
      const attachments = [...message.attachments.values()]
        .map((attachment) => attachment.url)
        .join('\n');
      lines.push(
        `[${message.createdAt.toISOString()}] ${message.author.tag} (${message.author.id})\n` +
          `${message.content || '[No text content]'}\n${attachments}`,
      );
    }

    before = ordered.at(-1)!.id;
    if (messages.size < 100) {
      break;
    }
  }

  return new AttachmentBuilder(
    Buffer.from(
      `Ticket ${channel.id}\nNewest 1,000 messages maximum.\n\n${lines.reverse().join('\n\n')}`,
    ),
    { name: `ticket-${channel.id}.txt` },
  );
}

export async function runTicket(
  interaction: TicketInteraction,
  store: SettingsStore,
  action: string,
  intake?: { subject: string; description: string },
) {
  const guild = await interaction.client.guilds.fetch(interaction.guildId);

  const member = await guild.members.fetch(interaction.user.id);
  const manager = member.permissions.has(permissions.ManageGuild);

  if (action === 'setup') {
    if (!manager) {
      return interaction.editReply(
        'Only members with Manage Server can configure tickets.',
      );
    }

    if (!interaction.isChatInputCommand()) return;
    if (
      !interaction.options.getChannel('category') &&
      !interaction.options.getRole('staff')
    ) {
      return beginSetup(interaction);
    }
    if (
      !interaction.options.getChannel('category') ||
      !interaction.options.getRole('staff')
    ) {
      return interaction.editReply(
        'Provide both category and staff, or run /ticket setup without options.',
      );
    }
    const categoryId = interaction.options.getChannel('category', true).id;
    const roleId = interaction.options.getRole('staff', true).id;
    const category = await guild.channels.fetch(categoryId);
    const role = await guild.roles.fetch(roleId);

    if (category?.type !== ChannelType.GuildCategory || !role || role.id === guild.id) {
      return interaction.editReply(
        'Choose a category and a dedicated staff role in this server.',
      );
    }

    store.configureTickets(guild.id, category.id, role.id);
    return interaction.editReply('Tickets configured. Members can use /ticket open.');
  }

  const config = store.ticketConfig(guild.id);
  if (!config) {
    return interaction.editReply('A server manager must run /ticket setup first.');
  }

  const key =
    action === 'open'
      ? `${guild.id}:${member.id}`
      : `${guild.id}:${interaction.channelId}`;
  if (locks.has(key)) {
    return interaction.editReply(
      'A ticket operation is already in progress. Try again shortly.',
    );
  }

  locks.add(key);
  try {
    if (action === 'open') {
      const existing = store.openTicket(guild.id, member.id);
      if (existing) {
        const existingChannel = await guild.channels.fetch(existing.channel_id);
        if (existingChannel) {
          return interaction.editReply(`Your open ticket: <#${existing.channel_id}>`);
        }
        store.closeTicket(guild.id, existing.channel_id);
      }

      const category = await guild.channels.fetch(config.category_id);
      const staff = await guild.roles.fetch(config.staff_role_id);
      if (
        category?.type !== ChannelType.GuildCategory ||
        !staff ||
        staff.id === guild.id
      ) {
        return interaction.editReply(
          'Ticket configuration is outdated. Ask a manager to run setup again.',
        );
      }

      const channel = await guild.channels.create({
        name: `ticket-${member.id}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.id, deny: [permissions.ViewChannel] },
          {
            id: member.id,
            allow: [
              permissions.ViewChannel,
              permissions.SendMessages,
              permissions.ReadMessageHistory,
            ],
          },
          {
            id: staff.id,
            allow: [
              permissions.ViewChannel,
              permissions.SendMessages,
              permissions.ReadMessageHistory,
            ],
          },
          {
            id: interaction.client.user.id,
            allow: [
              permissions.ViewChannel,
              permissions.SendMessages,
              permissions.ReadMessageHistory,
              permissions.ManageChannels,
              permissions.ManageRoles,
              permissions.AttachFiles,
              permissions.EmbedLinks,
            ],
          },
        ],
      });

      try {
        store.addTicket(guild.id, channel.id, member.id);
      } catch (error) {
        await channel.delete('Ticket persistence failed');
        throw error;
      }

      const record = store.ticket(guild.id, channel.id)!;
      record.subject = intake?.subject || 'Support request';
      const message = await channel.send(ticketView(record));
      if (message?.id) {
        store.saveTicketDetails(
          guild.id,
          channel.id,
          message.id,
          staff.id,
          record.subject,
        );
      }
      if (intake?.description) {
        await channel.send({
          content: intake.description,
          allowedMentions: { parse: [] },
        });
      }
      return interaction.editReply(`Ticket created: <#${channel.id}>`);
    }

    const record = store.ticket(guild.id, interaction.channelId!);
    if (!record) {
      return interaction.editReply(
        'Use this command inside a ticket created by this bot.',
      );
    }

    const isStaff =
      manager || member.roles.cache.has(record.staff_role_id || config.staff_role_id);
    if (!isStaff && member.id !== record.owner_id) {
      return interaction.editReply(
        'Only the ticket owner or staff can access this ticket.',
      );
    }

    const channel = await guild.channels.fetch(record.channel_id);
    if (channel?.type !== ChannelType.GuildText) {
      return interaction.editReply('The ticket channel is unavailable.');
    }

    if (action === 'transcript') {
      if (!interaction.client.options.intents.has(GatewayIntentBits.MessageContent)) {
        return interaction.editReply(
          'Transcript exports require TICKET_TRANSCRIPTS=true and Message Content Intent enabled in the Developer Portal.',
        );
      }
      return interaction.editReply({
        content:
          'Private transcript export. Includes available text and attachment links; deleted messages are unavailable.',
        files: [await transcript(channel)],
      });
    }

    if (action === 'reopen') {
      if (!isStaff) return interaction.editReply('Only staff can reopen tickets.');
      if (!record.closed) return interaction.editReply('This ticket is already open.');
      if (store.openTicket(guild.id, record.owner_id))
        return interaction.editReply('The owner already has another open ticket.');
      store.reopenTicket(guild.id, channel.id);
      try {
        await channel.permissionOverwrites.edit(record.owner_id, {
          SendMessages: true,
          AddReactions: null,
          CreatePublicThreads: null,
          CreatePrivateThreads: null,
          SendMessagesInThreads: null,
        });
      } catch (error) {
        store.closeTicket(guild.id, channel.id);
        await refreshTicket(channel, store.ticket(guild.id, channel.id)!);
        throw error;
      }
      await refreshTicket(channel, store.ticket(guild.id, channel.id)!);
      return interaction.editReply('Ticket reopened.');
    }

    if (action === 'unclaim') {
      if (!isStaff || (record.claimed_by !== member.id && !manager))
        return interaction.editReply(
          'Only the assigned staff member or a manager can release this claim.',
        );
      store.unclaimTicket(guild.id, channel.id);
      await refreshTicket(channel, store.ticket(guild.id, channel.id)!);
      return interaction.editReply('Ticket is now unassigned.');
    }
    if (record.closed) {
      return interaction.editReply(
        'This ticket is already closed. You can still export its transcript.',
      );
    }

    if (action === 'claim') {
      if (!isStaff) {
        return interaction.editReply('Only staff can claim tickets.');
      }

      const claimed = store.claimTicket(guild.id, channel.id, member.id);
      await refreshTicket(channel, store.ticket(guild.id, channel.id)!);
      return interaction.editReply(
        claimed
          ? `Ticket assigned to ${member.user.tag}.`
          : 'This ticket has already been claimed.',
      );
    }

    await channel.permissionOverwrites.edit(record.owner_id, {
      SendMessages: false,
      AddReactions: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      SendMessagesInThreads: false,
    });
    store.closeTicket(guild.id, channel.id);
    await refreshTicket(channel, store.ticket(guild.id, channel.id)!);
    await interaction.editReply(
      'Ticket closed. The channel is preserved for staff and transcript exports.',
    );
  } finally {
    locks.delete(key);
  }
}

export const tickets: Extension = {
  id: 'tickets',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Open and manage private support tickets')
        .setContexts(InteractionContextType.Guild)
        .addSubcommand((command) =>
          command
            .setName('setup')
            .setDescription('Configure tickets (Manage Server required)')
            .addChannelOption((option) =>
              option
                .setName('category')
                .setDescription('Ticket category')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(false),
            )
            .addRoleOption((option) =>
              option
                .setName('staff')
                .setDescription('Support staff role')
                .setRequired(false),
            ),
        )
        .addSubcommand((command) =>
          command.setName('open').setDescription('Open your private support ticket'),
        )
        .addSubcommand((command) =>
          command
            .setName('claim')
            .setDescription('Assign this ticket to yourself (staff only)'),
        )
        .addSubcommand((command) =>
          command.setName('close').setDescription('Close and preserve this ticket'),
        )
        .addSubcommand((command) =>
          command
            .setName('transcript')
            .setDescription('Export this ticket as a text attachment'),
        ),
      cooldownMs: 5000,
      botPermissions: [
        permissions.ManageChannels,
        permissions.ManageRoles,
        permissions.ViewChannel,
        permissions.SendMessages,
        permissions.ReadMessageHistory,
        permissions.AttachFiles,
        permissions.EmbedLinks,
      ],
      execute: ({ interaction, store }: CommandContext) =>
        runTicket(interaction, store, interaction.options.getSubcommand()),
    },
  ],
};

export const dispatchTicketUI = (
  interaction: import('discord.js').Interaction,
  store: SettingsStore,
) => handleTicketUI(interaction, store, runTicket);
