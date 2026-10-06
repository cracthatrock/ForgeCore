import type { Extension, Registry, RegisteredCommand } from './types.js';

export function createRegistry(extensions: Extension[]): Registry {
  const plugins = new Map<string, Extension>();
  const commands = new Map<string, RegisteredCommand>();

  for (const extension of extensions) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(extension.id) || plugins.has(extension.id)) {
      throw new Error('Invalid or duplicate extension ID');
    }

    if (!Array.isArray(extension.commands) || !extension.commands.length) {
      throw new Error('Extension needs commands');
    }
    plugins.set(extension.id, extension);
    for (const command of extension.commands) {
      const data = command.data.toJSON();
      if (commands.has(data.name) || typeof command.execute !== 'function') {
        throw new Error('Duplicate or invalid command');
      }

      if (!Number.isFinite(command.cooldownMs) || command.cooldownMs < 1000) {
        throw new Error('Command needs a cooldown of at least 1000ms');
      }
      commands.set(data.name, { ...command, extensionId: extension.id });
    }
  }

  return {
    plugins,
    commands,
    definitions: [...commands.values()].map((c) => c.data.toJSON()),
  };
}
