import { REST, Routes } from 'discord.js';
import { loadConfig } from './config.js';
import { createRegistry } from './registry.js';
import { extensions } from './extensions/index.js';
import { SettingsStore } from './store.js';
import { customDefinition } from './extensions/custom-commands.js';

try {
  const config = loadConfig();
  const registry = createRegistry(extensions);
  const store = new SettingsStore(config.databasePath);
  const custom = store
    .customCommands(config.guildId)
    .filter((record) => record.published)
    .map((record) => customDefinition(record.published!));
  store.close();
  if (custom.some((command) => registry.commands.has(command.name))) {
    throw new Error('A saved command conflicts with a built-in command.');
  }

  await new REST({ version: '10' })
    .setToken(config.token)
    .put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: [...registry.definitions, ...custom],
    });
  console.log(
    `Registered ${registry.definitions.length + custom.length} commands in the development server.`,
  );
} catch {
  console.error('Registration failed. Check IDs, token and server access.');
  process.exitCode = 1;
}
