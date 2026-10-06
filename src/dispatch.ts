import type { Interaction } from 'discord.js';
import type { Registry, Logger } from './types.js';
import type { SettingsStore } from './store.js';
import { MessageFlags } from 'discord.js';
import { CustomRoleError, resolveCustomCommand } from './extensions/custom-commands.js';

export function createDispatcher({
  registry,
  store,
  logger = console,
  now = Date.now,
}: {
  registry: Registry;
  store: SettingsStore;
  logger?: Logger;
  now?: () => number;
}) {
  const cooldowns = new Map<string, number>();

  return async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const reply = (content: string) =>
      interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });

    try {
      if (!interaction.inGuild()) {
        return await reply('Use this command in a server.');
      }

      const command =
        registry.commands.get(interaction.commandName) ||
        (await resolveCustomCommand(interaction, store));
      if (!command) {
        return await reply(
          'Unknown command. Ask the owner to update command registration.',
        );
      }

      if (
        command.memberPermissions &&
        !interaction.memberPermissions?.has(command.memberPermissions)
      ) {
        return await reply('You do not have permission to use this command.');
      }

      if (
        command.botPermissions &&
        !interaction.appPermissions?.has(command.botPermissions)
      ) {
        return await reply('The bot is missing permissions required for this command.');
      }

      if (!store.isEnabled(interaction.guildId, command.extensionId)) {
        return await reply('This extension is disabled in this server.');
      }

      const time = now();

      for (const [key, expires] of cooldowns) {
        if (expires <= time) {
          cooldowns.delete(key);
        }
      }

      const key = `${interaction.guildId}:${interaction.user.id}:${interaction.commandName}`;
      if ((cooldowns.get(key) || 0) > time) {
        return await reply('Please wait before using this command again.');
      }
      cooldowns.set(key, time + command.cooldownMs);

      await interaction.deferReply(
        command.ephemeral === false ? {} : { flags: MessageFlags.Ephemeral },
      );

      await command.execute({ interaction, store, registry });
    } catch (error) {
      if (error instanceof CustomRoleError) {
        return await reply('You need the configured role to use this command.');
      }
      // Log metadata only: never tokens, message content or raw provider errors.
      logger.error('Command failed', {
        command: interaction.commandName,
        guildId: interaction.guildId,
      });

      try {
        const message = {
          content: 'Something went wrong. Please try again later.',
          allowedMentions: { parse: [] },
        };

        if (interaction.deferred) {
          await interaction.editReply(message);
        } else if (interaction.replied) {
          await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
        } else {
          await reply(message.content);
        }
      } catch {
        logger.error('Could not deliver command error');
      }
    }
  };
}
