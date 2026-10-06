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
