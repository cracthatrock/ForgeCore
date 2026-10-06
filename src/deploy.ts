import { REST, Routes } from 'discord.js';
import { loadConfig } from './config.js';
import { createRegistry } from './registry.js';
import { extensions } from './extensions/index.js';

try {
  const config = loadConfig();
  const registry = createRegistry(extensions);

  await new REST({ version: '10' })
    .setToken(config.token)
    .put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: registry.definitions,
    });
  console.log(
    `Registered ${registry.definitions.length} commands in the development server.`,
  );
} catch {
  console.error('Registration failed. Check IDs, token and server access.');
  process.exitCode = 1;
}
