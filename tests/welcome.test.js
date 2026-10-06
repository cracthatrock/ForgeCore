import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
  defaultWelcome,
  validateWelcome,
  welcomeView,
  validateJoinRole,
  handleWelcome,
} from '../src/extensions/welcome.js';
import { SettingsStore } from '../src/store.js';

const guildId = '123456789012345678';
const memberId = '223456789012345678';
const roleId = '323456789012345678';
const channelId = '423456789012345678';
const config = () => ({ ...defaultWelcome, channel: channelId, role: roleId });
function fixture() {
  const sent = [];
  const assigned = [];
  let elevated = false;
  let position = 2;
  const guild = {
    id: guildId,
    name: 'Test server',
    memberCount: 42,
    roles: {
      fetch: async (id) => ({
        id,
        managed: false,
        position,
        permissions: { bitfield: elevated ? PermissionFlagsBits.Administrator : 0n },
      }),
    },
    members: {
      fetchMe: async () => ({
        permissions: { has: () => true },
        roles: { highest: { position: 10 } },
      }),
    },
    channels: {
      fetch: async (id) =>
        id === channelId ? { type: 0, send: async (value) => sent.push(value) } : null,
    },
  };
  const member = {
    id: memberId,
    guild,
    pending: false,
    user: { bot: false, username: 'New_member' },
    roles: { cache: new Map(), add: async (id) => assigned.push(id) },
  };
  return {
    member,
    sent,
    assigned,
    elevate: () => {
      elevated = true;
    },
    moveAbove: () => {
      position = 20;
    },
  };
}

test('welcome validates safe templates and destination IDs', () => {
  const input = { ...config(), color: '#B6FA6A' };
  assert.equal(validateWelcome(input).color, 0xb6fa6a);
  for (const patch of [
    { title: '{execute}' },
    { channel: 'bad' },
    { mention: 'yes' },
    { message: 'x'.repeat(1501) },
    { channel: null, role: null },
  ]) {
    assert.throws(() => validateWelcome({ ...input, ...patch }));
  }
  const member = fixture().member;
  const view = welcomeView(member, config());
  assert.match(view.embeds[0].toJSON().description, /member #42/);
  assert.deepEqual(view.allowedMentions, { parse: [], users: [memberId] });
  assert.deepEqual(welcomeView(member, config(), true).allowedMentions.users, []);
  assert.equal(welcomeView(member, { ...config(), mention: false }).content, undefined);
});

test('welcome settings isolate servers and join-role validation blocks elevated and support roles', async () => {
  const store = new SettingsStore(':memory:');
  try {
    store.saveWelcomeConfig(guildId, config());
    assert.equal(store.welcomeConfig(guildId).role, roleId);
    assert.equal(store.welcomeConfig(memberId), undefined);
    const data = fixture();
    assert.equal(await validateJoinRole(data.member.guild, roleId), null);
    assert.ok(await validateJoinRole(data.member.guild, roleId, roleId));
    data.elevate();
    assert.ok(await validateJoinRole(data.member.guild, roleId));
    const higher = fixture();
    higher.moveAbove();
    assert.ok(await validateJoinRole(higher.member.guild, roleId));
  } finally {
    store.close();
  }
});

test('live joins greet humans, respect disabling, and defer roles until screening finishes', async () => {
  const store = new SettingsStore(':memory:');
  try {
    store.saveWelcomeConfig(guildId, config());
    const data = fixture();
    data.member.pending = true;
    await handleWelcome(data.member, store);
    assert.equal(data.sent.length, 1);
    assert.equal(data.assigned.length, 0);
    data.member.pending = false;
    await handleWelcome(data.member, store, true);
    assert.equal(data.sent.length, 1);
    assert.deepEqual(data.assigned, [roleId]);
    data.member.user.bot = true;
    await handleWelcome(data.member, store);
    assert.equal(data.sent.length, 1);
    data.member.user.bot = false;
    store.setEnabled(guildId, 'welcome', false);
    await handleWelcome(data.member, store);
    assert.equal(data.sent.length, 1);
    assert.equal(data.assigned.length, 1);
  } finally {
    store.close();
  }
});

test('unconfigured servers are quiet and changed role permissions cannot grant admin access', async () => {
  const store = new SettingsStore(':memory:');
  const original = console.error;
  const logs = [];
  console.error = (message) => logs.push(message);
  try {
    const data = fixture();
    await handleWelcome(data.member, store);
    assert.equal(data.sent.length, 0);
    store.saveWelcomeConfig(guildId, config());
    data.elevate();
    await handleWelcome(data.member, store);
    assert.equal(data.assigned.length, 0);
    assert.equal(data.sent.length, 1);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes(memberId));
  } finally {
    store.close();
    console.error = original;
  }
});
