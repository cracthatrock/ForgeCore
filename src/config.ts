export function loadConfig(env = process.env) {
  const token = env.DISCORD_TOKEN?.trim();
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const guildId = env.DISCORD_GUILD_ID?.trim();
  if (!token || !clientId || !/^\d{17,20}$/.test(clientId ?? ''))
    throw new Error('Set DISCORD_TOKEN and a valid DISCORD_CLIENT_ID in .env.');
  if (!guildId || !/^\d{17,20}$/.test(guildId ?? ''))
    throw new Error('Set DISCORD_GUILD_ID to your development server ID.');
  return {
    token,
    clientId,
    guildId,
    databasePath: env.DATABASE_PATH || 'data/forge.sqlite',
  };
}
