import type { Extension } from '../types.js';
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
} from 'discord.js';

export const core: Extension = {
  id: 'core',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot responsiveness')
        .setContexts(InteractionContextType.Guild),
      cooldownMs: 3000,
      async execute({ interaction }) {
        await interaction.editReply({
          content: `Online. Gateway latency: ${Math.max(0, Math.round(interaction.client.ws.ping))}ms.`,
          allowedMentions: { parse: [] },
        });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('extensions')
        .setDescription('List or enable server extensions')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((o) => o.setName('name').setDescription('Extension ID'))
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('Enable or disable this extension'),
        ),
      memberPermissions: PermissionFlagsBits.ManageGuild,
      cooldownMs: 3000,
      async execute({ interaction, store, registry }) {
        const name = interaction.options.getString('name');
        const enabled = interaction.options.getBoolean('enabled');

        if (name !== null || enabled !== null) {
          if (
            !name ||
            enabled === null ||
            !registry.plugins.has(name) ||
            name === 'core'
          ) {
            return interaction.editReply(
              'Provide a known extension name and enabled value. Core cannot be disabled.',
            );
          }
          store.setEnabled(interaction.guildId, name, enabled);
        }

        await interaction.editReply({
          content: [...registry.plugins.keys()]
            .map(
              (id) =>
                `${id}: ${store.isEnabled(interaction.guildId, id) ? 'enabled' : 'disabled'}`,
            )
            .join('\n'),
          allowedMentions: { parse: [] },
        });
      },
    },
  ],
};
