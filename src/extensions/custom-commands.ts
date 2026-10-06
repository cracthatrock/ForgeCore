import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Extension, RegisteredCommand } from '../types.js';
import type { SettingsStore } from '../store.js';
import { parseColor } from './ticket-options.js';

export interface CustomReply {
  name: string;
  description: string;
  content: string;
  embed: boolean;
  title: string;
  message: string;
  color: number;
  footer: string;
  links: { label: string; url: string }[];
  role: string | null;
  cooldown: number;
  ephemeral: boolean;
}
export interface CustomRecord {
  draft: CustomReply;
  published: CustomReply | null;
  commandId: string | null;
}
export function validateCustomReply(value: unknown, reserved: Set<string>): CustomReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected command settings.');
  }
  const data = value as Record<string, unknown>;
  const text = (key: string, max: number, required = false) => {
    const value = data[key];
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw new Error(`${key} must contain ${required ? '1' : '0'}–${max} characters.`);
    }
    return value.trim();
  };
  const name = text('name', 32, true);
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || reserved.has(name)) {
    throw new Error(
      'Use a lowercase command name starting with a letter. Built-in names are reserved.',
    );
  }
  for (const key of ['embed', 'ephemeral']) {
    if (typeof data[key] !== 'boolean') {
      throw new Error(`Choose a valid ${key} option.`);
    }
  }
  const content = text('content', 2000);
  const title = text('title', 100);
  const message = text('message', 1500);
  const footer = text('footer', 200);
  if (!content && !(data.embed && (title || message))) {
    throw new Error('Add reply text or an embed title/description.');
  }
  if (
    !Number.isInteger(data.cooldown) ||
    Number(data.cooldown) < 1 ||
    Number(data.cooldown) > 300
  ) {
    throw new Error('Cooldown must be a whole number from 1–300 seconds.');
  }
  const role = data.role === '' || data.role === null ? null : data.role;
  if (role !== null && (typeof role !== 'string' || !/^\d{17,20}$/.test(role))) {
    throw new Error('Choose a valid allowed role.');
  }
  const lines = text('links', 3000)
    .split('\n')
    .filter((line) => line.trim());
  if (lines.length > 5) {
    throw new Error('Add at most five link buttons.');
  }
  const links = lines.map((line) => {
    const separator = line.indexOf('|');
    const label = line.slice(0, separator).trim();
    const address = line.slice(separator + 1).trim();
    let url;
    try {
      url = new URL(address);
    } catch {
      throw new Error('Each button needs Label|https://example.com.');
    }
    if (
      separator < 1 ||
      !label ||
      label.length > 80 ||
      address.length > 512 ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password
    ) {
      throw new Error(
        'Use labels up to 80 characters and HTTPS links without embedded credentials.',
      );
    }
    return { label, url: url.href };
  });
  return {
    name,
    description: text('description', 100, true),
    content,
    embed: data.embed as boolean,
    title,
    message,
    color: parseColor(text('color', 7, true)),
    footer,
    links,
    role: role as string | null,
    cooldown: Number(data.cooldown),
    ephemeral: data.ephemeral as boolean,
  };
}
export function customDefinition(reply: CustomReply) {
  return new SlashCommandBuilder()
    .setName(reply.name)
    .setDescription(reply.description)
    .setDefaultMemberPermissions(null)
    .toJSON();
}
export function customView(reply: CustomReply) {
  const embed = new EmbedBuilder().setColor(reply.color);
  if (reply.title) {
    embed.setTitle(reply.title);
  }
  if (reply.message) {
    embed.setDescription(reply.message);
  }
  if (reply.footer) {
    embed.setFooter({ text: reply.footer });
  }
  return {
    content: reply.content || undefined,
    embeds: reply.embed ? [embed] : [],
    components: reply.links.length
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            reply.links.map((link) =>
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(link.label)
                .setURL(link.url),
            ),
          ),
        ]
      : [],
    allowedMentions: { parse: [] as never[] },
  };
}
export async function resolveCustomCommand(
  interaction: ChatInputCommandInteraction<'raw' | 'cached'>,
  store: SettingsStore,
): Promise<RegisteredCommand | null> {
  const reply = store.customCommand(
    interaction.guildId!,
    interaction.commandName,
  )?.published;
  if (!reply) {
    return null;
  }
  if (reply.role) {
    const guild = await interaction.client.guilds.fetch(interaction.guildId!);
    const member = await guild.members.fetch({ user: interaction.user.id, force: true });
    if (!member.roles.cache.has(reply.role)) {
      throw new CustomRoleError();
    }
  }
  return {
    extensionId: 'builder',
    data: { toJSON: () => customDefinition(reply) },
    cooldownMs: reply.cooldown * 1000,
    ephemeral: reply.ephemeral,
    botPermissions: reply.embed ? [PermissionFlagsBits.EmbedLinks] : undefined,
    execute: async ({ interaction }) => interaction.editReply(customView(reply)),
  };
}
export class CustomRoleError extends Error {}
export const builder: Extension = {
  id: 'builder',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('builder')
        .setDescription('Check your dashboard-authored commands')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      memberPermissions: PermissionFlagsBits.ManageGuild,
      cooldownMs: 5000,
      async execute({ interaction, store }) {
        const records = store.customCommands(interaction.guildId);
        return interaction.editReply(
          `${records.filter((record) => record.published).length} published commands, ${records.length} saved drafts. Open Commands in the ForgeCore dashboard to create or edit replies.`,
        );
      },
    },
  ],
};
