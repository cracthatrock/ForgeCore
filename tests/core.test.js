import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsStore } from '../src/store.js';
import { createRegistry } from '../src/registry.js';
import { createDispatcher } from '../src/dispatch.js';
import { extensions } from '../src/extensions/index.js';
import { loadConfig } from '../src/config.js';
const guild = '123456789012345678',
  other = '223456789012345678';
function interaction(name = 'hello') {
  return {
    commandName: name,
    guildId: guild,
    user: { id: '323456789012345678' },
    isChatInputCommand: () => true,
    inGuild: () => true,
    memberPermissions: { has: () => true },
    appPermissions: { has: () => true },
    options: { getString: () => null, getBoolean: () => null },
    calls: [],
    client: { ws: { ping: 10 } },
    async reply(x) {
      this.calls.push(x);
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(x) {
      this.calls.push(x);
    },
    async followUp(x) {
      this.calls.push(x);
    },
  };
}
test('settings isolate servers and survive reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-test-')),
    path = join(dir, 'settings.sqlite');
  try {
    const s = new SettingsStore(path);
    s.setEnabled(guild, 'example', false);
    assert.equal(s.isEnabled(other, 'example'), true);
    assert.throws(() => s.setEnabled('bad', 'example', false));
    assert.throws(() => s.setEnabled(guild, 'example', 'false'));
    s.close();
    const reopened = new SettingsStore(path);
    assert.equal(reopened.isEnabled(guild, 'example'), false);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('registry rejects duplicate extension and command definitions', () => {
  assert.equal(createRegistry(extensions).definitions.length, 3);
  assert.throws(() => createRegistry([extensions[0], extensions[0]]));
  assert.throws(() =>
    createRegistry([
      extensions[0],
      { ...extensions[1], commands: extensions[0].commands },
    ]),
  );
});
test('runtime permissions and disabled modules cannot execute', async () => {
  const s = new SettingsStore(':memory:'),
    dispatch = createDispatcher({ registry: createRegistry(extensions), store: s });
  const denied = interaction('extensions');
  denied.memberPermissions.has = () => false;
  await dispatch(denied);
  assert.match(denied.calls[0].content, /permission/);
  assert.equal(denied.deferred, undefined);
  s.setEnabled(guild, 'example', false);
  const disabled = interaction();
  await dispatch(disabled);
  assert.match(disabled.calls[0].content, /disabled/);
  s.close();
});
test('cooldowns are isolated by server and expire', async () => {
  const s = new SettingsStore(':memory:');
  let time = 0;
  const dispatch = createDispatcher({
    registry: createRegistry(extensions),
    store: s,
    now: () => time,
  });
  await dispatch(interaction());
  const blocked = interaction();
  await dispatch(blocked);
  assert.match(blocked.calls[0].content, /wait/);
  const separate = interaction();
  separate.guildId = other;
  await dispatch(separate);
  assert.equal(separate.deferred, true);
  time = 3000;
  const expired = interaction();
  await dispatch(expired);
  assert.equal(expired.deferred, true);
  s.close();
});
test('DMs are rejected and execution errors remain private and sanitized', async () => {
  const s = new SettingsStore(':memory:'),
    registry = createRegistry(extensions),
    logs = [];
  registry.commands.get('hello').execute = async () => {
    throw Error('secret-token');
  };
  const dispatch = createDispatcher({
    registry,
    store: s,
    logger: { error: (...x) => logs.push(x) },
  });
  const dm = interaction();
  dm.inGuild = () => false;
  await dispatch(dm);
  assert.match(dm.calls[0].content, /server/);
  const failed = interaction();
  await dispatch(failed);
  assert.match(failed.calls[0].content, /went wrong/);
  assert.ok(!JSON.stringify(logs).includes('secret-token'));
  s.close();
});
test('configuration fails before login on missing credentials or invalid IDs', () => {
  assert.throws(() => loadConfig({}));
  assert.throws(() =>
    loadConfig({ DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: guild, DISCORD_GUILD_ID: 'x' }),
  );
  assert.equal(
    loadConfig({ DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: guild, DISCORD_GUILD_ID: other })
      .guildId,
    other,
  );
});
