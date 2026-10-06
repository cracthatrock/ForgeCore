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

// Component entry points must enforce the same extension/server boundaries as commands.
test('ticket UI rejects disabled extensions and stale panels without creating channels', async () => {
  const { handleTicketUI } = await import('../src/extensions/ticket-ui.js');
  const store = new SettingsStore(':memory:');
  let calls = 0;
  try {
    const replies = [];
    const button = {
      customId: 'tickets:open',
      guildId,
      channelId,
      user: { id: '823456789012345678' },
      message: { id: channelId },
      isButton: () => true,
      isModalSubmit: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      inGuild: () => true,
      reply: async (value) => replies.push(value),
    };
    store.setEnabled(guildId, 'tickets', false);
    await handleTicketUI(button, store, async () => {
      calls++;
    });
    assert.match(replies[0].content, /disabled/);
    store.setEnabled(guildId, 'tickets', true);
    await handleTicketUI(button, store, async () => {
      calls++;
    });
    assert.match(replies[1].content, /outdated/);
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});

test('reopen preserves the one-open-ticket constraint and panel records survive reopen', () => {
  const store = new SettingsStore(':memory:');
  try {
    store.configureTickets(guildId, channelId, staffId);
    store.savePanel(guildId, channelId, staffId);
    store.addTicket(guildId, channelId, ownerId);
    store.closeTicket(guildId, channelId);
    store.addTicket(guildId, staffId, ownerId);
    assert.throws(() => store.reopenTicket(guildId, channelId));
    store.closeTicket(guildId, staffId);
    store.reopenTicket(guildId, channelId);
    assert.equal(store.openTicket(guildId, ownerId).channel_id, channelId);
    assert.equal(store.ticketConfig(guildId).panel_message_id, staffId);
  } finally {
    store.close();
  }
});

test('closed tickets move without syncing permissions and deletion is staff-only', async () => {
  const { readOptions } = await import('../src/extensions/ticket-options.js');
  const store = new SettingsStore(':memory:');
  const closedCategory = '923456789012345678';
  let moved;
  let deleted = 0;
  try {
    store.configureTickets(guildId, channelId, staffId);
    store.addTicket(guildId, channelId, ownerId);
    store.saveTicketSnapshot(
      guildId,
      channelId,
      JSON.stringify({ ...readOptions(), closedCategory }),
      '[]',
    );
    const request = context(store, 'close');
    const guild = await request.interaction.client.guilds.fetch();
    const channel = {
      id: channelId,
      type: ChannelType.GuildText,
      permissionOverwrites: { edit: async () => {} },
      setParent: async (id, options) => {
        moved = { id, options };
      },
      delete: async () => {
        deleted++;
      },
    };
    guild.channels.fetch = async (id) =>
      id === closedCategory ? { id, type: ChannelType.GuildCategory } : channel;
    await tickets.commands[0].execute(request);
    assert.deepEqual(moved, { id: closedCategory, options: { lockPermissions: false } });
    request.interaction.options.getSubcommand = () => 'delete';
    await tickets.commands[0].execute(request);
    assert.equal(deleted, 0);
    const member = await guild.members.fetch();
    member.roles.cache.set(staffId, {});
    await tickets.commands[0].execute(request);
    assert.equal(deleted, 1);
    assert.equal(store.ticket(guildId, channelId), undefined);
  } finally {
    store.close();
  }
});
