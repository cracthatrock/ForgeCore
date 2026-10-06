import {
  ChannelType,
  EmbedBuilder,
  GatewayIntentBits,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  escapeMarkdown,
  type Guild,
  type GuildMember,
} from 'discord.js';
import type { SettingsStore } from '../store.js';
import type { Extension } from '../types.js';
import { parseColor } from './ticket-options.js';

export interface WelcomeOptions {
  channel: string | null;
  role: string | null;
  title: string;
  message: string;
  color: number;
  footer: string;
  mention: boolean;
}
export const defaultWelcome: WelcomeOptions = {
  channel: null,
  role: null,
  title: 'Welcome to {server}!',
  message:
    'Hey {user}, we’re glad you’re here. You’re member #{count}. Take a look around and make yourself at home.',
  color: 0xb6fa6a,
  footer: 'A new face. A new conversation.',
  mention: true,
};
export function validateWelcome(value: unknown): WelcomeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected welcome settings.');
  }
  const input = value as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const text = input[key];
    if (typeof text !== 'string' || !text.trim() || text.length > max) {
      throw new Error(`${key} must contain 1–${max} characters.`);
    }
    const tokens = text.match(/\{[^{}]+\}/g) || [];
    if (
      tokens.some(
        (token) => !['{user}', '{username}', '{server}', '{count}'].includes(token),
      )
    ) {
      throw new Error('Use only {user}, {username}, {server} and {count} placeholders.');
    }
    return text.trim();
  };
  const id = (key: string) => {
    const id = input[key];
    if (id === '' || id === null) {
      return null;
    }
    if (typeof id !== 'string' || !/^\d{17,20}$/.test(id)) {
      throw new Error(`Choose a valid ${key}.`);
    }
    return id;
  };
  if (typeof input.mention !== 'boolean') {
    throw new Error('Choose whether to mention new members.');
  }
  const channel = id('channel');
  const role = id('role');
  if (!channel && !role) {
    throw new Error('Choose a welcome channel or a join role.');
  }
  return {
    channel,
    role,
    title: text('title', 100),
    message: text('message', 1500),
    footer: text('footer', 200),
    color: parseColor(text('color', 7)),
    mention: input.mention,
  };
}
export function welcomeView(
  member: GuildMember,
  options: WelcomeOptions,
  preview = false,
) {
  const values: Record<string, string> = {
    user: `<@${member.id}>`,
    username: escapeMarkdown(member.user.username),
    server: escapeMarkdown(member.guild.name),
    count: String(member.guild.memberCount),
  };
  const render = (text: string, max: number) =>
    text
      .replace(/\{(user|username|server|count)\}/g, (_, key: string) => values[key])
      .slice(0, max);
  return {
    content: options.mention && !preview ? `<@${member.id}>` : undefined,
    embeds: [
      new EmbedBuilder()
        .setTitle(render(options.title, 256))
        .setDescription(render(options.message, 4096))
        .setColor(options.color)
        .setFooter({ text: render(options.footer, 2048) }),
    ],
    allowedMentions: {
      parse: [] as never[],
      users: options.mention && !preview ? [member.id] : [],
    },
  };
}
// A join role must never automatically grant administrative or moderation access.
const basicPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.UseExternalStickers,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.UseVAD,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.UseApplicationCommands,
  PermissionFlagsBits.ChangeNickname,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendVoiceMessages,
  PermissionFlagsBits.SendPolls,
  PermissionFlagsBits.UseSoundboard,
  PermissionFlagsBits.UseExternalSounds,
].reduce((mask, permission) => mask | permission, 0n);
export async function validateJoinRole(guild: Guild, roleId: string, staffRole?: string) {
  const role = await guild.roles.fetch(roleId);
  const me = await guild.members.fetchMe();
  if (
    !role ||
    role.id === guild.id ||
    role.managed ||
    role.id === staffRole ||
    role.position >= me.roles.highest.position ||
    (role.permissions.bitfield & ~basicPermissions) !== 0n ||
    !me.permissions.has(PermissionFlagsBits.ManageRoles)
  ) {
    return 'Choose a basic member role below the bot’s role. Managed, support and moderation roles cannot be assigned automatically.';
  }
  return null;
}
export async function validateWelcomeTargets(
  guild: Guild,
  options: WelcomeOptions,
  staffRole?: string,
) {
  if (options.channel) {
    const channel = await guild.channels.fetch(options.channel);
    const me = await guild.members.fetchMe();
    if (
      channel?.type !== ChannelType.GuildText ||
      !channel
        .permissionsFor(me)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
    ) {
      return 'Choose a text channel where the bot can view, send messages and embed links.';
    }
  }
  return options.role ? validateJoinRole(guild, options.role, staffRole) : null;
}
export async function handleWelcome(
  member: GuildMember,
  store: SettingsStore,
  roleOnly = false,
) {
  if (member.user.bot || !store.isEnabled(member.guild.id, 'welcome')) {
    return;
  }
  const options = store.welcomeConfig(member.guild.id);
  if (!options) {
    return;
  }
  if (options.role && !member.pending && !member.roles.cache.has(options.role)) {
    try {
      const problem = await validateJoinRole(
        member.guild,
        options.role,
        store.ticketConfig(member.guild.id)?.staff_role_id,
      );
      if (problem) {
        throw new Error('Role unavailable');
      }
      // Recheck module state after asynchronous permission checks.
      if (store.isEnabled(member.guild.id, 'welcome')) {
        await member.roles.add(options.role, 'ForgeCore welcome join role');
      }
    } catch {
      console.error(
        `Welcome role failed for server ${member.guild.id}; check role permissions.`,
      );
    }
  }
  if (roleOnly || !options.channel || !store.isEnabled(member.guild.id, 'welcome')) {
    return;
  }
  try {
    const channel = await member.guild.channels.fetch(options.channel);
    if (channel?.type !== ChannelType.GuildText) {
      return;
    }
    await channel.send(welcomeView(member, options));
  } catch {
    console.error(
      `Welcome message failed for server ${member.guild.id}; check channel permissions.`,
    );
  }
}
export const welcome: Extension = {
  id: 'welcome',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Preview your server’s welcome message')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      memberPermissions: PermissionFlagsBits.ManageGuild,
      cooldownMs: 5000,
      async execute({ interaction, store }) {
        const options = store.welcomeConfig(interaction.guildId);
        if (!options) {
          return interaction.editReply(
            'Configure Welcome in the ForgeCore dashboard first.',
          );
        }
        const guild = await interaction.client.guilds.fetch(interaction.guildId);
        const member = await guild.members.fetch(interaction.user.id);
        return interaction.editReply({
          ...welcomeView(member, options, true),
          content: interaction.client.options.intents.has(GatewayIntentBits.GuildMembers)
            ? 'Preview only — no join role is assigned.'
            : 'Preview only — enable Server Members Intent and WELCOME_MEMBERS=true for live joins.',
        });
      },
    },
  ],
};
