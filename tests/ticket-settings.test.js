import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  parseColor,
  parseQuestions,
  readOptions,
} from '../src/extensions/ticket-options.js';
import { setupView, panelView } from '../src/extensions/ticket-setup.js';
import { ticketView } from '../src/extensions/ticket-ui.js';
import { validateArchive } from '../src/extensions/ticket-archive.js';
import { SettingsStore } from '../src/store.js';

const guild = '123456789012345678';
const channel = '223456789012345678';
const staff = '323456789012345678';

test('form validation rejects malformed definitions and invalid colors', () => {
  assert.equal(parseColor('#AABBCC'), 0xaabbcc);
  assert.throws(() => parseColor('blue'));
  assert.throws(() => parseQuestions('Question without configuration'));
  assert.throws(() =>
    parseQuestions(Array(6).fill('required|short|Question').join('\n')),
  );
  assert.deepEqual(parseQuestions('optional|paragraph|More details')[0], {
    label: 'More details',
    required: false,
    style: 'paragraph',
  });
  const a = readOptions();
  a.questions[0].label = 'Changed';
  assert.notEqual(readOptions().questions[0].label, 'Changed');
});

test('setup pages fit Discord component limits and ticket cards fit embed limits', () => {
  const options = readOptions();
  options.ticketMessage = 'x'.repeat(1500);
  const session = { userId: staff, expires: Date.now(), page: 0, options };
  for (session.page = 0; session.page < 4; session.page++) {
    assert.ok(setupView(session).components.length <= 5);
  }
  assert.equal(panelView(options).embeds[0].toJSON().color, options.panelColor);
  const view = ticketView({
    owner_id: staff,
    channel_id: channel,
    guild_id: guild,
    closed: 0,
    claimed_by: null,
    subject: 's'.repeat(100),
    options_json: JSON.stringify(options),
    answers_json: JSON.stringify(
      Array(5).fill({ label: 'q'.repeat(45), value: 'a'.repeat(1000) }),
    ),
  });
  const embed = view.embeds[0].toJSON();
  const length =
    embed.title.length +
    embed.description.length +
    embed.footer.text.length +
    embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  assert.ok(length <= 6000);
  assert.ok(embed.fields.every((field) => field.value.length <= 1024));
});

test('saved ticket snapshots remain unchanged when server configuration changes', () => {
  const store = new SettingsStore(':memory:');
  try {
    store.configureTickets(guild, channel, staff);
    const options = readOptions();
    options.formEnabled = false;
    options.transcriptChannel = channel;
    store.saveTicketOptions(guild, JSON.stringify(options));
    store.addTicket(guild, channel, staff);
    store.saveTicketSnapshot(guild, channel, JSON.stringify(options), '[]');
    store.saveTicketOptions(guild, JSON.stringify(readOptions()));
    assert.equal(
      readOptions(store.ticket(guild, channel).options_json).formEnabled,
      false,
    );
    assert.equal(readOptions(store.ticketConfig(guild).options_json).formEnabled, true);
    assert.equal(store.ticket(staff, channel), undefined);
  } finally {
    store.close();
  }
});

test('archive privacy checks reject a publicly visible transcript channel', async () => {
  const everyone = { id: guild, permissions: { has: () => false } };
  const archive = {
    type: ChannelType.GuildText,
    guild: {
      id: guild,
      members: { fetchMe: async () => ({ id: channel, roles: { cache: new Map() } }) },
      roles: { fetch: async () => new Map([[guild, everyone]]) },
    },
    permissionsFor: () => ({ has: () => true }),
    permissionOverwrites: { cache: new Map() },
  };
  assert.match(await validateArchive(archive, staff), /non-staff role/);
  archive.permissionsFor = (target) => ({
    has: (permission) =>
      Array.isArray(permission) ||
      (target.id !== guild && permission === PermissionFlagsBits.ViewChannel),
  });
  assert.equal(await validateArchive(archive, staff), null);
});
