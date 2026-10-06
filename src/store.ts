import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  }

  configureTickets(guildId: string, categoryId: string, staffRoleId: string) {
    this.db
      .prepare(
        `INSERT INTO ticket_config VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET category_id=excluded.category_id,
      staff_role_id=excluded.staff_role_id`,
      )
      .run(id(guildId), id(categoryId), id(staffRoleId));
  }

  ticketConfig(guildId: string) {
    return this.db
      .prepare('SELECT * FROM ticket_config WHERE guild_id=?')
      .get(id(guildId)) as { category_id: string; staff_role_id: string } | undefined;
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
}
