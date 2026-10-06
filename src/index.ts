import { Client, GatewayIntentBits, Events } from 'discord.js';
import { loadConfig } from './config.js';
import { SettingsStore } from './store.js';
import { createRegistry } from './registry.js';
import { createDispatcher } from './dispatch.js';
import { extensions } from './extensions/index.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Invalid configuration');
  process.exit(1);
}

const store = new SettingsStore(config.databasePath);
const registry = createRegistry(extensions);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  allowedMentions: { parse: [] },
});
const dispatch = createDispatcher({ registry, store });
client.on(Events.InteractionCreate, (interaction) => {
  void dispatch(interaction);
});
client.once(Events.ClientReady, () =>
  console.log(`ForgeCore online with ${registry.commands.size} commands.`),
);
client.on(Events.Error, () =>
  console.error('Discord client error; check connection and configuration.'),
);
let stopping = false;
function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  client.destroy();
  store.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  await client.login(config.token);
} catch {
  console.error('Discord login failed. Check DISCORD_TOKEN and network access.');
  stop();
  process.exitCode = 1;
}
