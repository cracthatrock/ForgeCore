import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ChannelType,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Client,
} from 'discord.js';
import type { SettingsStore } from '../store.js';
import type { Registry } from '../types.js';
import { readOptions } from '../extensions/ticket-options.js';
import { panelView } from '../extensions/ticket-setup.js';
import { validateArchive } from '../extensions/ticket-archive.js';
import { canManage, validateSettings } from './validation.js';
import {
  defaultWelcome,
  validateWelcome,
  validateWelcomeTargets,
  welcomeView,
} from '../extensions/welcome.js';

interface Session {
  expires: number;
  csrf: string;
  state?: string;
  token?: string;
  user?: { id: string; username: string; global_name?: string };
}
interface UserGuild {
  id: string;
  name: string;
  permissions: string;
}
const nonce = () => randomBytes(32).toString('hex');

export function startDashboard(client: Client, store: SettingsStore, registry: Registry) {
  const origin = process.env.DASHBOARD_URL || 'http://localhost:4190';
  const base = new URL(origin);
  if (
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname))
  ) {
    throw new Error('DASHBOARD_URL must be an HTTPS origin or local HTTP origin.');
  }
  const port = Number(process.env.DASHBOARD_PORT || base.port || 4190);
  const secret = process.env.DISCORD_CLIENT_SECRET;
  const sessions = new Map<string, Session>();
  const locks = new Set<string>();
  const rates = new Map<string, { count: number; expires: number }>();
  const callback = `${base.origin}/auth/callback`;
  const cookie = (value: string, age = 3600) =>
    `forge_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${base.protocol === 'https:' ? '; Secure' : ''}`;
  const api = async <T>(path: string, token: string): Promise<T> => {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error('Discord access expired or unavailable. Sign in again.');
    }
    return response.json() as Promise<T>;
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        reply(res, 400, {
          error:
            error instanceof Error && error.message.startsWith('Discord access')
              ? error.message
              : 'Could not complete this request. Check your selections and bot permissions.',
        });
      } else {
        res.end();
      }
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.setTimeout(20000, (socket) => socket.destroy());
  const reply = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  async function body(req: IncomingMessage) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) {
        throw new Error('Request too large.');
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (req.headers.host !== base.host) {
      reply(res, 403, { error: 'Invalid host.' });
      return;
    }
    const url = new URL(req.url || '/', base);
    const now = Date.now();
    for (const [key, entry] of sessions) {
      if (entry.expires <= now) {
        sessions.delete(key);
      }
    }
    for (const [key, entry] of rates) {
      if (entry.expires <= now) {
        rates.delete(key);
      }
    }
    const address = req.socket.remoteAddress || 'unknown';
    const rate = rates.get(address) || { count: 0, expires: now + 60000 };
    rate.count += 1;
    rates.set(address, rate);
    if (rate.count > 100) {
      reply(res, 429, { error: 'Please wait a minute before trying again.' });
      return;
    }
    const sid = req.headers.cookie?.match(
      /(?:^|;\s*)forge_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const session = sid ? sessions.get(sid) : undefined;
    if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const content = await readFile(resolve('dashboard', file));
      res.setHeader(
        'Content-Type',
        file.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : file.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : 'text/css; charset=utf-8',
      );
      res.end(content);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/login') {
      if (!secret) {
        reply(res, 503, {
          error: 'Add DISCORD_CLIENT_SECRET to .env and restart to enable login.',
        });
        return;
      }
      if (sessions.size >= 1000) {
        reply(res, 503, { error: 'Try again later.' });
        return;
      }
      const id = nonce();
      const state = nonce();
      if (sid) {
        sessions.delete(sid);
      }
      sessions.set(id, { csrf: nonce(), state, expires: now + 600000 });
      const auth = new URL('https://discord.com/oauth2/authorize');
      auth.search = new URLSearchParams({
        client_id: client.application!.id,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'identify guilds',
        state,
      }).toString();
      res.writeHead(302, { Location: auth.href, 'Set-Cookie': cookie(id, 600) });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      if (
        !session?.state ||
        session.state !== url.searchParams.get('state') ||
        !url.searchParams.get('code') ||
        !secret
      ) {
        reply(res, 403, { error: 'Login expired. Start again.' });
        return;
      }
      delete session.state;
      const response = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: client.application!.id,
          client_secret: secret,
          grant_type: 'authorization_code',
          code: url.searchParams.get('code')!,
          redirect_uri: callback,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new Error('Login failed.');
      }
      const token = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };
      const user = await api<NonNullable<Session['user']>>(
        '/users/@me',
        token.access_token,
      );
      sessions.delete(sid!);
      const id = nonce();
      sessions.set(id, {
        token: token.access_token,
        user,
        csrf: nonce(),
        expires: now + Math.min(token.expires_in, 3600) * 1000,
      });
      res.writeHead(302, { Location: '/', 'Set-Cookie': cookie(id) });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      reply(res, 200, {
        user: session?.user || null,
        csrf: session?.user ? session.csrf : null,
        loginReady: Boolean(secret),
      });
      return;
    }
    if (!session?.token || !session.user) {
      reply(res, 401, { error: 'Sign in with Discord first.' });
      return;
    }
    if (req.method === 'POST') {
      if (
        req.headers.origin !== base.origin ||
        req.headers['x-csrf-token'] !== session.csrf ||
        req.headers['content-type']?.split(';')[0] !== 'application/json'
      ) {
        reply(res, 403, { error: 'Reload the dashboard before saving.' });
        return;
      }
      if (url.pathname === '/auth/logout') {
        sessions.delete(sid!);
        res.setHeader('Set-Cookie', cookie('', 0));
        reply(res, 200, { ok: true });
        return;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/guilds') {
      const guilds: UserGuild[] = [];
      let after = '';
      for (let page = 0; page < 10; page += 1) {
        const batch = await api<UserGuild[]>(
          `/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`,
          session.token,
        );
        guilds.push(...batch);
        if (batch.length < 200) {
          break;
        }
        after = batch[batch.length - 1].id;
      }
      reply(
        res,
        200,
        guilds
          .filter((g) => canManage(g.permissions) && client.guilds.cache.has(g.id))
          .map((g) => ({ id: g.id, name: g.name })),
      );
      return;
    }
    const match = url.pathname.match(
      /^\/api\/guilds\/(\d{17,20})(?:\/(tickets|publish|extensions|welcome|welcome-test))?$/,
    );
    if (!match) {
      reply(res, 404, { error: 'Not found.' });
      return;
    }
    const guild = client.guilds.cache.get(match[1]);
    const member = guild
      ? await guild.members
          .fetch({ user: session.user.id, force: true })
          .catch(() => null)
      : null;
    if (!guild || !member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      reply(res, 403, { error: 'Manage Server permission is required for this server.' });
      return;
    }
    if (req.method === 'GET' && !match[2]) {
      const channels = await guild.channels.fetch();
      const roles = await guild.roles.fetch();
      const config = store.ticketConfig(guild.id);
      reply(res, 200, {
        name: guild.name,
        config: config || null,
        options: readOptions(config?.options_json),
        welcome: store.welcomeConfig(guild.id) || structuredClone(defaultWelcome),
        welcomeReady: client.options.intents.has(GatewayIntentBits.GuildMembers),
        channels: [...channels.values()]
          .filter(
            (c) =>
              c && [ChannelType.GuildText, ChannelType.GuildCategory].includes(c.type),
          )
          .map((c) => ({ id: c!.id, name: c!.name, type: c!.type })),
        roles: [...roles.values()]
          .filter((r) => r.id !== guild.id && !r.managed)
          .map((r) => ({ id: r.id, name: r.name })),
        extensions: [...registry.plugins.keys()].map((id) => ({
          id,
          enabled: store.isEnabled(guild.id, id),
          locked: id === 'core',
        })),
      });
      return;
    }
    if (req.method !== 'POST') {
      reply(res, 405, { error: 'Method not allowed.' });
      return;
    }
    if (locks.has(guild.id)) {
      reply(res, 409, { error: 'A save is already running. Try again.' });
      return;
    }
    locks.add(guild.id);
    try {
      const input = await body(req);
      if (match[2] === 'welcome' || match[2] === 'welcome-test') {
        let options;
        try {
          options = validateWelcome(input);
        } catch (error) {
          reply(res, 400, {
            error: error instanceof Error ? error.message : 'Invalid welcome settings.',
          });
          return;
        }
        const problem = await validateWelcomeTargets(
          guild,
          options,
          store.ticketConfig(guild.id)?.staff_role_id,
        );
        if (problem) {
          reply(res, 400, { error: problem });
          return;
        }
        const current = await guild.members.fetch({ user: session.user.id, force: true });
        if (
          !current.permissions.has(PermissionFlagsBits.ManageGuild) ||
          (options.role && !current.permissions.has(PermissionFlagsBits.ManageRoles))
        ) {
          reply(res, 403, {
            error:
              'Manage Server is required; configuring a join role also requires Manage Roles.',
          });
          return;
        }
        if (options.role && guild.ownerId !== current.id) {
          const role = await guild.roles.fetch(options.role);
          if (!role || role.comparePositionTo(current.roles.highest) >= 0) {
            reply(res, 403, {
              error: 'The join role must be below your own highest role.',
            });
            return;
          }
        }
        if (match[2] === 'welcome-test') {
          if (!options.channel) {
            reply(res, 400, { error: 'Choose a channel to send a test message.' });
            return;
          }
          const channel = await guild.channels.fetch(options.channel);
          if (channel?.type !== ChannelType.GuildText) {
            throw new Error('Channel unavailable');
          }
          await channel.send({
            ...welcomeView(current, options, true),
            content: 'Welcome preview • No join role assigned.',
          });
          reply(res, 200, { ok: true });
          return;
        }
        store.saveWelcomeConfig(guild.id, options);
        reply(res, 200, { ok: true });
        return;
      }
      if (match[2] === 'extensions') {
        const data = input as { id?: string; enabled?: boolean };
        if (
          !data ||
          !data.id ||
          !registry.plugins.has(data.id) ||
          data.id === 'core' ||
          typeof data.enabled !== 'boolean'
        ) {
          reply(res, 400, { error: 'Choose a configurable extension.' });
          return;
        }
        store.setEnabled(guild.id, data.id, data.enabled);
        reply(res, 200, { ok: true });
        return;
      }
      if (!['tickets', 'publish'].includes(match[2])) {
        reply(res, 404, { error: 'Not found.' });
        return;
      }
      let data;
      try {
        data = validateSettings(input);
      } catch (error) {
        reply(res, 400, {
          error: error instanceof Error ? error.message : 'Invalid settings.',
        });
        return;
      }
      const category = await guild.channels.fetch(data.category);
      const panel = await guild.channels.fetch(data.panel);
      const staff = await guild.roles.fetch(data.staff);
      const me = await guild.members.fetchMe();
      const manage = [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
      ];
      if (
        category?.type !== ChannelType.GuildCategory ||
        panel?.type !== ChannelType.GuildText ||
        !staff ||
        staff.id === guild.id ||
        staff.managed ||
        staff.position >= me.roles.highest.position ||
        !category.permissionsFor(me)?.has([...manage, PermissionFlagsBits.ViewChannel]) ||
        !panel
          .permissionsFor(me)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
          ])
      ) {
        reply(res, 400, {
          error:
            'Check your routing and bot permissions. The support role must be below the bot’s role.',
        });
        return;
      }
      if (data.options.closedCategory) {
        const closed = await guild.channels.fetch(data.options.closedCategory);
        if (
          closed?.type !== ChannelType.GuildCategory ||
          !closed.permissionsFor(me)?.has(manage)
        ) {
          reply(res, 400, { error: 'Choose a closed category the bot can manage.' });
          return;
        }
      }
      if (data.options.transcriptChannel) {
        const problem = await validateArchive(
          await guild.channels.fetch(data.options.transcriptChannel),
          staff.id,
        );
        if (problem) {
          reply(res, 400, { error: problem });
          return;
        }
      }
      // Recheck after network validation, before changing server-owned settings.
      const current = await guild.members.fetch({ user: session.user.id, force: true });
      if (!current.permissions.has(PermissionFlagsBits.ManageGuild)) {
        reply(res, 403, { error: 'Your Manage Server permission changed.' });
        return;
      }
      const message =
        match[2] === 'publish' ? await panel.send(panelView(data.options)) : null;
      store.saveTicketDesk(
        guild.id,
        category.id,
        staff.id,
        JSON.stringify(data.options),
        message ? { channelId: panel.id, messageId: message.id } : undefined,
      );
      reply(res, 200, { ok: true, published: Boolean(message) });
    } finally {
      locks.delete(guild.id);
    }
  }
  server.listen(port, process.env.DASHBOARD_HOST || '127.0.0.1', () => {
    console.log(
      `ForgeCore dashboard: ${base.origin}${secret ? '' : ' (OAuth secret needed for login)'}`,
    );
  });
  server.on('error', () =>
    console.error('Dashboard could not listen. Check its port and configuration.'),
  );
  return server;
}
