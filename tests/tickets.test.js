import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsStore } from '../src/store.js';
import { tickets } from '../src/extensions/tickets.js';
import { ChannelType } from 'discord.js';

const guildId = '123456789012345678';
const ownerId = '223456789012345678';
const channelId = '323456789012345678';
const staffId = '423456789012345678';

test('ticket records enforce one open ticket, atomic claims and server isolation', () => {
  const store = new SettingsStore(':memory:');
  try {
    store.configureTickets(guildId, channelId, staffId);
    assert.equal(store.ticketConfig(ownerId), undefined);
    store.addTicket(guildId, channelId, ownerId);
    assert.throws(() => store.addTicket(guildId, staffId, ownerId));
    assert.equal(store.ticket(ownerId, channelId), undefined);
    assert.equal(store.claimTicket(ownerId, channelId, staffId), false);
    assert.equal(store.claimTicket(guildId, channelId, staffId), true);
    assert.equal(store.claimTicket(guildId, channelId, ownerId), false);
    store.closeTicket(ownerId, channelId);
    assert.ok(store.openTicket(guildId, ownerId));
    store.closeTicket(guildId, channelId);
    assert.equal(store.openTicket(guildId, ownerId), undefined);
    assert.equal(store.claimTicket(guildId, channelId, ownerId), false);
    store.addTicket(guildId, staffId, ownerId);
  } finally {
    store.close();
  }
});

function context(store, action, userId = ownerId) {
  const replies = [];
  const member = {
    id: userId,
    permissions: { has: () => false },
    roles: { cache: new Map() },
  };
  const guild = {
    id: guildId,
    members: { fetch: async () => member },
    channels: {
      fetch: async () => {
        throw new Error('Unauthorized channel access');
      },
    },
  };
  return {
    store,
    replies,
    interaction: {
      guildId,
      channelId,
      user: { id: userId },
      client: { guilds: { fetch: async () => guild } },
      options: { getSubcommand: () => action },
      editReply: async (reply) => replies.push(reply),
    },
  };
}

test('opening creates private overwrites; duplicate opens reuse the channel; closing locks the owner', async () => {
  const store = new SettingsStore(':memory:');
  const categoryId = '623456789012345678';
  const botId = '723456789012345678';
  let created = 0;
  let locked;
  const channel = {
    id: channelId,
    type: ChannelType.GuildText,
    send: async () => {},
    permissionOverwrites: {
      edit: async (id, value) => {
        locked = { id, value };
      },
    },
  };
  try {
    store.configureTickets(guildId, categoryId, staffId);
    const request = context(store, 'open');
    const guild = await request.interaction.client.guilds.fetch();
    guild.roles = { fetch: async () => ({ id: staffId }) };
    guild.channels = {
      fetch: async (id) =>
        id === categoryId ? { id: categoryId, type: ChannelType.GuildCategory } : channel,
      create: async (options) => {
        created++;
        assert.equal(options.parent, categoryId);
        assert.equal(options.permissionOverwrites[0].id, guildId);
        assert.ok(options.permissionOverwrites[0].deny.length);
        assert.deepEqual(
          options.permissionOverwrites.map((entry) => entry.id),
          [guildId, ownerId, staffId, botId],
        );
        return channel;
      },
    };
    request.interaction.client.user = { id: botId };
    await tickets.commands[0].execute(request);
    await tickets.commands[0].execute(request);
    assert.equal(created, 1);
    assert.equal(store.openTicket(guildId, ownerId).channel_id, channelId);

    request.interaction.options.getSubcommand = () => 'close';
    await tickets.commands[0].execute(request);
    assert.equal(locked.id, ownerId);
    assert.equal(locked.value.SendMessages, false);
    assert.equal(store.ticket(guildId, channelId).closed, 1);
  } finally {
    store.close();
  }
});

test('non-managers cannot configure tickets; unrelated members cannot export or close', async () => {
  const store = new SettingsStore(':memory:');
  try {
    const setup = context(store, 'setup');
    await tickets.commands[0].execute(setup);
    assert.match(setup.replies[0], /Only members with Manage Server/);
    assert.equal(store.ticketConfig(guildId), undefined);

    store.configureTickets(guildId, channelId, staffId);
    store.addTicket(guildId, channelId, ownerId);
    for (const action of ['close', 'claim', 'transcript']) {
      const stranger = context(store, action, '523456789012345678');
      await tickets.commands[0].execute(stranger);
      assert.match(stranger.replies[0], /Only the ticket owner or staff/);
    }
    assert.equal(store.ticket(guildId, channelId).closed, 0);
  } finally {
    store.close();
  }
});
