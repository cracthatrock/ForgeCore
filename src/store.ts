import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WelcomeOptions } from './extensions/welcome.js';
import type { CustomRecord, CustomReply } from './extensions/custom-commands.js';

const id = (value: string) => {
  if (!/^\d{17,20}$/.test(value)) {
    throw new Error('Invalid server ID');
  }

  return value;
};

const plugin = (value: string) => {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(value)) {
    throw new Error('Invalid extension ID');
  }

  return value;
};

export class SettingsStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode = WAL;
       CREATE TABLE IF NOT EXISTS settings (
         guild_id TEXT NOT NULL,
         extension_id TEXT NOT NULL,
         enabled INTEGER NOT NULL DEFAULT 1,
         PRIMARY KEY (guild_id, extension_id)
       );`,
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS custom_commands (
        guild_id TEXT NOT NULL, name TEXT NOT NULL, draft_json TEXT NOT NULL,
        published_json TEXT, command_id TEXT, PRIMARY KEY (guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS welcome_config (
        guild_id TEXT PRIMARY KEY, options_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_config (
        guild_id TEXT PRIMARY KEY, category_id TEXT NOT NULL, staff_role_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tickets (
        channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        claimed_by TEXT, closed INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_ticket
      ON tickets(guild_id, owner_id) WHERE closed = 0;
    `);
    const migrate = (table: string, column: string, definition: string) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((entry) => entry.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    };
    migrate('ticket_config', 'panel_channel_id', 'TEXT');
    migrate('ticket_config', 'panel_message_id', 'TEXT');
    migrate('tickets', 'control_message_id', 'TEXT');
    migrate('tickets', 'staff_role_id', 'TEXT');
    migrate('tickets', 'subject', "TEXT NOT NULL DEFAULT 'Support request'");
    migrate('ticket_config', 'options_json', 'TEXT');
    migrate('tickets', 'options_json', 'TEXT');
    migrate('tickets', 'answers_json', 'TEXT');
  }

  welcomeConfig(guildId: string): WelcomeOptions | undefined {
    const row = this.db
      .prepare('SELECT options_json FROM welcome_config WHERE guild_id=?')
      .get(id(guildId));
    return row ? (JSON.parse(String(row.options_json)) as WelcomeOptions) : undefined;
  }

  customCommands(guildId: string): CustomRecord[] {
    return this.db
      .prepare('SELECT * FROM custom_commands WHERE guild_id=? ORDER BY name')
      .all(id(guildId))
      .map((row) => ({
        draft: JSON.parse(String(row.draft_json)),
        published: row.published_json ? JSON.parse(String(row.published_json)) : null,
        commandId: row.command_id ? String(row.command_id) : null,
      }));
  }

  customCommand(guildId: string, name: string) {
    return this.customCommands(guildId).find((record) => record.draft.name === name);
  }

  saveCustomDraft(guildId: string, reply: CustomReply) {
    if (
      !this.customCommand(guildId, reply.name) &&
      this.customCommands(guildId).length >= 25
    ) {
      throw new Error('This server already has 25 saved commands.');
    }
    this.db
      .prepare(
        'INSERT INTO custom_commands (guild_id,name,draft_json) VALUES (?,?,?) ON CONFLICT(guild_id,name) DO UPDATE SET draft_json=excluded.draft_json',
      )
      .run(id(guildId), reply.name, JSON.stringify(reply));
  }

  publishCustom(guildId: string, reply: CustomReply, commandId: string) {
    this.db
      .prepare(
        'UPDATE custom_commands SET published_json=?,command_id=? WHERE guild_id=? AND name=?',
      )
      .run(JSON.stringify(reply), id(commandId), id(guildId), reply.name);
  }

  unpublishCustom(guildId: string, name: string) {
    this.db
      .prepare(
        'UPDATE custom_commands SET published_json=NULL,command_id=NULL WHERE guild_id=? AND name=?',
      )
      .run(id(guildId), name);
  }

  deleteCustomDraft(guildId: string, name: string) {
    this.db
      .prepare(
        'DELETE FROM custom_commands WHERE guild_id=? AND name=? AND published_json IS NULL',
      )
      .run(id(guildId), name);
  }

  saveWelcomeConfig(guildId: string, options: WelcomeOptions) {
    this.db
      .prepare(
        'INSERT INTO welcome_config VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET options_json=excluded.options_json',
      )
      .run(id(guildId), JSON.stringify(options));
  }

  saveTicketOptions(guildId: string, options: string) {
    this.db
      .prepare('UPDATE ticket_config SET options_json=? WHERE guild_id=?')
      .run(options, id(guildId));
  }

  saveTicketDesk(
    guildId: string,
    categoryId: string,
    staffRoleId: string,
    options: string,
    panel?: { channelId: string; messageId: string },
  ) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.configureTickets(guildId, categoryId, staffRoleId);
      this.saveTicketOptions(guildId, options);
      if (panel) {
        this.savePanel(guildId, panel.channelId, panel.messageId);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  saveTicketSnapshot(
    guildId: string,
    channelId: string,
    options: string,
    answers: string,
  ) {
    this.db
      .prepare(
        'UPDATE tickets SET options_json=?, answers_json=? WHERE guild_id=? AND channel_id=?',
      )
      .run(options, answers, id(guildId), id(channelId));
  }

  savePanel(guildId: string, channelId: string, messageId: string) {
    this.db
      .prepare(
        'UPDATE ticket_config SET panel_channel_id=?, panel_message_id=? WHERE guild_id=?',
      )
      .run(id(channelId), id(messageId), id(guildId));
  }

  saveTicketDetails(
    guildId: string,
    channelId: string,
    messageId: string,
    roleId: string,
    subject: string,
  ) {
    this.db
      .prepare(
        'UPDATE tickets SET control_message_id=?, staff_role_id=?, subject=? WHERE guild_id=? AND channel_id=?',
      )
      .run(id(messageId), id(roleId), subject.slice(0, 100), id(guildId), id(channelId));
  }

  reopenTicket(guildId: string, channelId: string) {
    this.db
      .prepare('UPDATE tickets SET closed=0 WHERE guild_id=? AND channel_id=?')
      .run(id(guildId), id(channelId));
  }

  unclaimTicket(guildId: string, channelId: string) {
    this.db
      .prepare('UPDATE tickets SET claimed_by=NULL WHERE guild_id=? AND channel_id=?')
      .run(id(guildId), id(channelId));
  }

  configureTickets(guildId: string, categoryId: string, staffRoleId: string) {
    this.db
      .prepare(
        `INSERT INTO ticket_config (guild_id, category_id, staff_role_id) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET category_id=excluded.category_id,
      staff_role_id=excluded.staff_role_id`,
      )
      .run(id(guildId), id(categoryId), id(staffRoleId));
  }

  ticketConfig(guildId: string) {
    return this.db
      .prepare('SELECT * FROM ticket_config WHERE guild_id=?')
      .get(id(guildId)) as
      | {
          category_id: string;
          staff_role_id: string;
          panel_channel_id: string | null;
          panel_message_id: string | null;
          options_json: string | null;
        }
      | undefined;
  }

  openTicket(guildId: string, ownerId: string) {
    return this.db
      .prepare('SELECT * FROM tickets WHERE guild_id=? AND owner_id=? AND closed=0')
      .get(id(guildId), id(ownerId)) as TicketRecord | undefined;
  }

  ticket(guildId: string, channelId: string) {
    return this.db
      .prepare('SELECT * FROM tickets WHERE guild_id=? AND channel_id=?')
      .get(id(guildId), id(channelId)) as TicketRecord | undefined;
  }

  addTicket(guildId: string, channelId: string, ownerId: string) {
    this.db
      .prepare('INSERT INTO tickets (guild_id, channel_id, owner_id) VALUES (?, ?, ?)')
      .run(id(guildId), id(channelId), id(ownerId));
  }

  claimTicket(guildId: string, channelId: string, staffId: string) {
    return (
      this.db
        .prepare(
          `UPDATE tickets SET claimed_by=?
      WHERE guild_id=? AND channel_id=? AND closed=0 AND claimed_by IS NULL`,
        )
        .run(id(staffId), id(guildId), id(channelId)).changes === 1
    );
  }

  closeTicket(guildId: string, channelId: string) {
    this.db
      .prepare('UPDATE tickets SET closed=1 WHERE guild_id=? AND channel_id=?')
      .run(id(guildId), id(channelId));
  }

  removeClosedTicket(guildId: string, channelId: string) {
    this.db
      .prepare('DELETE FROM tickets WHERE guild_id=? AND channel_id=? AND closed=1')
      .run(id(guildId), id(channelId));
  }

  isEnabled(guildId: string, extensionId: string): boolean {
    const row = this.db
      .prepare('SELECT enabled FROM settings WHERE guild_id=? AND extension_id=?')
      .get(id(guildId), plugin(extensionId));
    return row ? Boolean(row.enabled) : true;
  }

  setEnabled(guildId: string, extensionId: string, enabled: boolean) {
    if (typeof enabled !== 'boolean') {
      throw new Error('Expected boolean');
    }

    this.db
      .prepare(
        'INSERT INTO settings VALUES (?,?,?) ON CONFLICT(guild_id,extension_id) DO UPDATE SET enabled=excluded.enabled',
      )
      .run(id(guildId), plugin(extensionId), Number(enabled));
  }

  close() {
    this.db.close();
  }
}

export interface TicketRecord {
  channel_id: string;
  guild_id: string;
  owner_id: string;
  claimed_by: string | null;
  closed: number;
  control_message_id?: string | null;
  staff_role_id?: string | null;
  subject?: string;
  options_json?: string | null;
  answers_json?: string | null;
}
