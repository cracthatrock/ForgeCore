import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startDashboard } from '../src/dashboard/server.js';
import { validateSettings, canManage } from '../src/dashboard/validation.js';
import { defaultOptions } from '../src/extensions/ticket-options.js';
import { SettingsStore } from '../src/store.js';
import { createRegistry } from '../src/registry.js';
import { extensions } from '../src/extensions/index.js';

const guildId = '123456789012345678';
const input = () => ({
  ...defaultOptions,
  category: guildId,
  staff: '223456789012345678',
  panel: '323456789012345678',
  panelColor: '#5865f2',
  ticketColor: '#5865f2',
  questions: 'required|short|How can we help?',
});

test('dashboard validates user-authored embeds, routing and intake without accepting arbitrary code', () => {
  const valid = validateSettings({ ...input(), arbitraryScript: 'execute()' });
  assert.equal(valid.options.panelColor, 0x5865f2);
  assert.equal(valid.options.openCategory, guildId);
  assert.equal('arbitraryScript' in valid.options, false);
  for (const patch of [
    { staff: 'bad' },
    { panelTitle: ' ' },
    { panelDescription: 'x'.repeat(1501) },
    { formEnabled: 'true' },
    { panelColor: '#fffffff' },
    { questions: 'required|short|' + 'x'.repeat(46) },
    { closedCategory: 42 },
    { questions: Array(6).fill('required|short|Question').join('\n') },
  ]) {
    assert.throws(() => validateSettings({ ...input(), ...patch }));
  }
  assert.equal(canManage('32'), true);
  assert.equal(canManage('8'), true);
  assert.equal(canManage('0'), false);
  assert.equal(canManage('invalid'), false);
});

test('OAuth dashboard rejects unauthenticated writes, invalid state, CSRF and cross-server access', async () => {
  const previous = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.DASHBOARD_URL = 'http://localhost:4197';
  process.env.DASHBOARD_PORT = '4197';
  process.env.DISCORD_CLIENT_SECRET = 'synthetic-test-secret';
  let allowed = true;
  let published = 0;
  const category = { id: guildId, type: 4, permissionsFor: () => ({ has: () => true }) };
  const panel = {
    id: '323456789012345678',
    type: 0,
    permissionsFor: () => ({ has: () => true }),
    send: async () => {
      published += 1;
      return { id: '623456789012345678' };
    },
  };
  const client = {
    application: { id: guildId },
    guilds: {
      cache: new Map([
        [
          guildId,
          {
            id: guildId,
            commands: {
              create: async (data) => ({ id: '823456789012345678', name: data.name }),
              fetch: async () => ({ name: 'rules' }),
              delete: async () => {},
            },
            members: {
              fetch: async () => ({ permissions: { has: () => allowed } }),
              fetchMe: async () => ({ roles: { highest: { position: 10 } } }),
            },
            channels: {
              fetch: async (id) =>
                id === guildId ? category : id === panel.id ? panel : null,
            },
            roles: {
              fetch: async (id) =>
                id === '223456789012345678' ? { id, managed: false, position: 2 } : null,
            },
          },
        ],
      ]),
    },
  };
  const store = new SettingsStore(':memory:');
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://discord.com/')) {
      return Response.json(
        String(url).endsWith('/oauth2/token')
          ? { access_token: 'synthetic-token', expires_in: 3600 }
          : String(url).includes('/guilds?')
            ? [{ id: guildId, name: 'Example', permissions: '32' }]
            : { id: '423456789012345678', username: 'Test' },
      );
    }
    return originalFetch(url, options);
  };
  const server = startDashboard(client, store, createRegistry(extensions));
  await once(server, 'listening');
  const base = 'http://localhost:4197';
  try {
    let response = await fetch(`${base}/api/guilds/${guildId}/extensions`, {
      method: 'POST',
    });
    assert.equal(response.status, 401);
    response = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    let cookie = response.headers.get('set-cookie').split(';')[0];
    const auth = new URL(response.headers.get('location'));
    assert.equal(auth.searchParams.get('scope'), 'identify guilds');
    assert.equal(auth.searchParams.get('redirect_uri'), `${base}/auth/callback`);
    response = await fetch(`${base}/auth/callback?code=test&state=wrong`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 403);
    response = await fetch(
      `${base}/auth/callback?code=test&state=${auth.searchParams.get('state')}`,
      { headers: { Cookie: cookie }, redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    const oldCookie = cookie;
    cookie = response.headers.get('set-cookie').split(';')[0];
    assert.notEqual(cookie, oldCookie);
    const session = await (
      await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })
    ).json();
    const request = (id, patch = {}) =>
      fetch(`${base}/api/guilds/${id}/extensions`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: base,
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf,
          ...patch,
        },
        body: JSON.stringify({ id: 'example', enabled: false }),
      });
    assert.equal((await request(guildId, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal(
      (await request(guildId, { Origin: 'https://other.example' })).status,
      403,
    );
    assert.equal((await request('523456789012345678')).status, 403);
    assert.equal(store.isEnabled(guildId, 'example'), true);
    assert.equal((await request(guildId)).status, 200);
    assert.equal(store.isEnabled(guildId, 'example'), false);
    const save = (data, action = 'tickets') =>
      fetch(`${base}/api/guilds/${guildId}/${action}`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: base,
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf,
        },
        body: JSON.stringify(data),
      });
    assert.equal(
      (await save({ ...input(), category: '723456789012345678' })).status,
      400,
    );
    assert.equal(store.ticketConfig(guildId), undefined);
    assert.equal((await save(input())).status, 200);
    assert.equal(
      JSON.parse(store.ticketConfig(guildId).options_json).panelTitle,
      defaultOptions.panelTitle,
    );
    assert.equal(published, 0);
    assert.equal((await save(input(), 'publish')).status, 200);
    assert.equal(published, 1);
    assert.equal(store.ticketConfig(guildId).panel_message_id, '623456789012345678');
    const draft = {
      name: 'rules',
      description: 'Read the rules',
      content: 'Be kind',
      embed: false,
      title: '',
      message: '',
      footer: '',
      color: '#b6fa6a',
      links: '',
      role: null,
      cooldown: 10,
      ephemeral: true,
    };
    assert.equal((await save({ ...draft, name: 'ticket' }, 'command-save')).status, 400);
    assert.equal((await save(draft, 'command-save')).status, 200);
    assert.equal(store.customCommand(guildId, 'rules').published, null);
    assert.equal((await save({ name: 'rules' }, 'command-publish')).status, 200);
    assert.equal(store.customCommand(guildId, 'rules').published.content, 'Be kind');
    assert.equal(
      (await save({ ...draft, content: 'New draft' }, 'command-save')).status,
      200,
    );
    assert.equal(store.customCommand(guildId, 'rules').published.content, 'Be kind');
    assert.equal((await save({ name: 'rules' }, 'command-delete')).status, 400);
    assert.equal((await save({ name: 'rules' }, 'command-unpublish')).status, 200);
    assert.equal((await save({ name: 'rules' }, 'command-delete')).status, 200);
    assert.equal(store.customCommand(guildId, 'rules'), undefined);
    const welcome = {
      channel: panel.id,
      role: null,
      title: 'Welcome {username}',
      message: 'Welcome to {server}',
      footer: 'Hello',
      color: '#b6fa6a',
      mention: false,
    };
    assert.equal((await save(welcome, 'welcome')).status, 200);
    assert.equal(store.welcomeConfig(guildId).title, welcome.title);
    assert.equal(
      (await save({ ...welcome, channel: '723456789012345678' }, 'welcome')).status,
      400,
    );
    assert.equal(store.welcomeConfig(guildId).channel, panel.id);
    assert.equal(
      (await save({ ...welcome, role: '223456789012345678' }, 'welcome')).status,
      400,
    );
    allowed = false;
    assert.equal((await request(guildId)).status, 403);
    assert.equal((await save(input(), 'publish')).status, 403);
    assert.equal(published, 1);
    assert.equal((await save(welcome, 'welcome')).status, 403);
    response = await fetch(`${base}/api/session`, { headers: { Cookie: oldCookie } });
    assert.equal((await response.json()).user, null);
    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: base,
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf,
      },
      body: '{}',
    });
    assert.equal(logout.status, 200);
    assert.equal(
      (await (await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).json())
        .user,
      null,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    globalThis.fetch = originalFetch;
    for (const key of ['DASHBOARD_URL', 'DASHBOARD_PORT', 'DISCORD_CLIENT_SECRET']) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});
