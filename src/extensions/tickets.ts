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
import type { SettingsStore, TicketRecord } from '../store.js';
import { readOptions } from './ticket-options.js';
import { validateArchive } from './ticket-archive.js';
import { EmbedBuilder } from 'discord.js';
import {
  beginSetup,
  handleTicketUI,
  refreshTicket,
  ticketView,
  type TicketInteraction,
} from './ticket-ui.js';

const locks = new Set<string>();
const permissions = PermissionFlagsBits;

async function transcript(channel: TextChannel, record?: TicketRecord) {
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
      `Ticket ${channel.id}\nNewest 1,000 messages maximum.\nForm answers: ${record?.answers_json || '[]'}\n\n${lines.reverse().join('\n\n')}`,
    ),
    { name: `ticket-${channel.id}.txt` },
  );
}

async function saveArchive(
  channel: TextChannel,
  record: TicketRecord,
  file: AttachmentBuilder,
) {
  const options = readOptions(record.options_json);
  if (!options.transcriptChannel) return '';
  const archive = await channel.guild.channels.fetch(options.transcriptChannel);
  const problem = await validateArchive(archive, record.staff_role_id || '');
  if (problem || archive?.type !== ChannelType.GuildText) {
    return `Transcript was not saved: ${problem || 'Archive channel unavailable.'}`;
  }
  await archive.send({
    embeds: [
      new EmbedBuilder()
        .setColor(options.ticketColor)
        .setTitle('Ticket transcript')
        .addFields(
          { name: 'Ticket', value: `<#${channel.id}> (${channel.id})` },
          { name: 'Opened by', value: `<@${record.owner_id}>`, inline: true },
          {
            name: 'Assigned to',
            value: record.claimed_by ? `<@${record.claimed_by}>` : 'Unassigned',
            inline: true,
          },
          { name: 'Request', value: record.subject || 'Support request' },
        )
        .setFooter({ text: 'Newest 1,000 messages • Text and attachment links' })
        .setTimestamp(),
    ],
    files: [file],
    allowedMentions: { parse: [] },
  });
  return `Transcript saved in <#${archive.id}>.`;
}
export async function runTicket(
  interaction: TicketInteraction,
  store: SettingsStore,
  action: string,
  intake?: {
    subject: string;
    description: string;
    answers?: { label: string; value: string }[];
  },
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
      return beginSetup(interaction, store);
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
      record.options_json = config.options_json;
      record.answers_json = JSON.stringify(intake?.answers || []);
      store.saveTicketSnapshot(
        guild.id,
        channel.id,
        JSON.stringify({
          ...readOptions(config.options_json),
          openCategory: config.category_id,
        }),
        record.answers_json,
      );
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
      const file = await transcript(channel, record);
      const archiveNote = await saveArchive(channel, record, file).catch(
        () =>
          'Archive save failed. Your private download is available; check archive permissions before retrying.',
      );
      return interaction.editReply({
        content:
          'Private transcript export. Includes available text and attachment links; deleted messages are unavailable. ' +
          archiveNote,
        files: [file],
      });
    }

    if (action === 'delete') {
      if (!isStaff || !record.closed) {
        return interaction.editReply('Only staff can delete a closed ticket.');
      }
      if (readOptions(record.options_json).transcriptChannel) {
        if (!interaction.client.options.intents.has(GatewayIntentBits.MessageContent)) {
          return interaction.editReply(
            'Deletion blocked: enable transcript access or export and preserve the ticket first.',
          );
        }
        const note = await saveArchive(
          channel,
          record,
          await transcript(channel, record),
        );
        if (!note.startsWith('Transcript saved')) {
          return interaction.editReply('Deletion blocked. ' + note);
        }
      }
      await interaction.editReply('Deleting the closed ticket channel.');
      await channel.delete(`Closed ticket deletion by ${member.id}`);
      store.removeClosedTicket(guild.id, channel.id);
      return;
    }
    if (action === 'reopen') {
      if (!isStaff) return interaction.editReply('Only staff can reopen tickets.');
      if (!record.closed) return interaction.editReply('This ticket is already open.');
      if (store.openTicket(guild.id, record.owner_id))
        return interaction.editReply('The owner already has another open ticket.');
      const openCategory =
        readOptions(record.options_json).openCategory || config.category_id;
      const parent = await guild.channels.fetch(openCategory);
      if (parent?.type !== ChannelType.GuildCategory) {
        return interaction.editReply(
          'The original ticket category is unavailable. Restore it before reopening.',
        );
      }
      await channel.setParent(parent.id, { lockPermissions: false });
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
    let routingNote = '';
    const closedCategory = readOptions(record.options_json).closedCategory;
    if (closedCategory) {
      try {
        const destination = await guild.channels.fetch(closedCategory);
        if (destination?.type !== ChannelType.GuildCategory)
          throw new Error('Category unavailable');
        await channel.setParent(destination.id, { lockPermissions: false });
      } catch {
        routingNote =
          'The ticket is locked, but could not be moved. Check the closed category and bot permissions. ';
      }
    }
    await refreshTicket(channel, store.ticket(guild.id, channel.id)!);
    let archiveNote = '';
    if (readOptions(record.options_json).transcriptChannel) {
      if (interaction.client.options.intents.has(GatewayIntentBits.MessageContent)) {
        try {
          archiveNote = await saveArchive(
            channel,
            record,
            await transcript(channel, record),
          );
        } catch {
          archiveNote =
            'Transcript was not saved. Use Export transcript to retry; the ticket channel is preserved.';
        }
      } else {
        archiveNote =
          'Transcript was not saved: enable TICKET_TRANSCRIPTS and Message Content Intent first.';
      }
    }
    await interaction.editReply(
      'Ticket closed. The channel is preserved. ' + routingNote + archiveNote,
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
