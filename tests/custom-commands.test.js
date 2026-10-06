import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsStore } from '../src/store.js';
import { createDispatcher } from '../src/dispatch.js';
import { createRegistry } from '../src/registry.js';
import { extensions } from '../src/extensions/index.js';
import {
  validateCustomReply,
  customView,
  customDefinition,
} from '../src/extensions/custom-commands.js';
const guild = '123456789012345678';
const other = '223456789012345678';
const role = '323456789012345678';
const commandId = '423456789012345678';
const input = () => ({
  name: 'rules',
  description: 'Read the rules',
  content: '@everyone Be kind.',
  embed: true,
  title: 'Community rules',
  message: 'Treat people well.',
  color: '#b6fa6a',
  footer: 'ForgeCore',
  links: 'Website|https://example.com',
  role: null,
  cooldown: 10,
  ephemeral: true,
});
const reserved = new Set(['ping', 'ticket', 'builder']);
test('command builder validates safe replies, reserved names, links and limits', () => {
  const reply = validateCustomReply(input(), reserved);
  assert.equal(customDefinition(reply).name, 'rules');
  assert.deepEqual(customView(reply).allowedMentions, { parse: [] });
  assert.equal(customView(reply).components[0].toJSON().components[0].style, 5);
  for (const patch of [
    { name: 'ticket' },
    { name: 'Bad Name' },
    { links: 'Click|javascript:alert(1)' },
    { links: 'Click|https://user:pass@example.com' },
    { links: Array(6).fill('Click|https://example.com').join('\n') },
    { cooldown: 0 },
    { cooldown: 301 },
    { content: 'x'.repeat(2001) },
    { embed: false, content: '' },
    { role: 'other' },
  ]) {
    assert.throws(() => validateCustomReply({ ...input(), ...patch }, reserved));
  }
});
test('draft edits never change published replies and records isolate servers', () => {
  const store = new SettingsStore(':memory:');
  try {
    const reply = validateCustomReply(input(), reserved);
    store.saveCustomDraft(guild, reply);
    assert.equal(store.customCommand(guild, 'rules').published, null);
    store.publishCustom(guild, reply, commandId);
    store.saveCustomDraft(guild, { ...reply, content: 'Edited draft' });
    assert.equal(store.customCommand(guild, 'rules').published.content, reply.content);
    assert.equal(store.customCommand(other, 'rules'), undefined);
    store.deleteCustomDraft(guild, 'rules');
    assert.ok(store.customCommand(guild, 'rules'));
    store.unpublishCustom(guild, 'rules');
    store.deleteCustomDraft(guild, 'rules');
    assert.equal(store.customCommand(guild, 'rules'), undefined);
    for (let i = 0; i < 25; i++) {
      store.saveCustomDraft(guild, { ...reply, name: `reply${i}` });
    }
    assert.throws(() => store.saveCustomDraft(guild, { ...reply, name: 'overflow' }));
  } finally {
    store.close();
  }
});
test('custom runtime enforces roles, server ownership, disabled modules and cooldowns', async () => {
  const store = new SettingsStore(':memory:');
  let hasRole = false;
  let now = 10000;
  const calls = [];
  const reply = validateCustomReply({ ...input(), role, ephemeral: false }, reserved);
  const interaction = {
    guildId: guild,
    commandName: 'rules',
    user: { id: other },
    isChatInputCommand: () => true,
    inGuild: () => true,
    client: {
      guilds: {
        fetch: async () => ({
          members: { fetch: async () => ({ roles: { cache: { has: () => hasRole } } }) },
        }),
      },
    },
    appPermissions: { has: () => true },
    reply: async (data) => calls.push(data),
    deferReply: async (data) => calls.push({ defer: data }),
    editReply: async (data) => calls.push(data),
  };
  const dispatch = createDispatcher({
    store,
    registry: createRegistry(extensions),
    now: () => now,
  });
  try {
    store.saveCustomDraft(guild, reply);
    await dispatch(interaction);
    assert.match(calls.at(-1).content, /Unknown command/);
    store.publishCustom(guild, reply, commandId);
    await dispatch(interaction);
    assert.match(calls.at(-1).content, /configured role/);
    hasRole = true;
    await dispatch(interaction);
    assert.equal(calls.at(-1).content, reply.content);
    assert.deepEqual(calls.at(-2), { defer: {} });
    await dispatch(interaction);
    assert.match(calls.at(-1).content, /Please wait/);
    now += 11000;
    store.setEnabled(guild, 'builder', false);
    await dispatch(interaction);
    assert.match(calls.at(-1).content, /disabled/);
    interaction.guildId = other;
    await dispatch(interaction);
    assert.match(calls.at(-1).content, /Unknown command/);
  } finally {
    store.close();
  }
});
