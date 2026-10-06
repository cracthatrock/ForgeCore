# ForgeCore

A TypeScript Discord bot foundation with trusted code extensions, slash commands and persistent per-server extension settings. First milestone of a configurable bot platform. TicketForge and WelcomeForge prototypes remain separate.

## Quick start

Requires Node 24 or newer. From this folder:

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and fill DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID. Create a dedicated Discord application and development server; do not reuse a production token unless you intend to run that bot here.
3. Invite the bot using the `bot` and `applications.commands` OAuth scopes. No Administrator permission or privileged intents are needed for these commands.
4. Run `npm run deploy`. This replaces this application's slash commands in the specified development server. It does not register globally.
5. Run `npm run build`, then `npm start`. Try `/ping`, `/hello`, `/extensions` and `/extensions name:example enabled:false`.

Keep .env private. Never paste a bot token into chat or commit it. Live Discord testing requires your application credentials; no credentials are bundled. Stop with Ctrl+C. Deploy again when command definitions change.

## Layout

- src/index.ts: Discord lifecycle and event wiring.
- src/config.ts: startup configuration validation.
- src/dispatch.ts: server boundary, permissions, extension state, cooldown and error handling.
- src/registry.ts: validates explicit extension registration and command collisions.
- src/store.ts: SQLite settings keyed by both server and extension.
- src/extensions/: core admin tools and a small example extension.
- src/deploy.ts: explicit development-server command registration.
- tests/: meaningful security boundary and behavior checks.

## Add an extension

Copy src/extensions/example.ts, give it a unique ID and command name, then explicitly import it in src/extensions/index.ts. Every command needs data (SlashCommandBuilder), cooldownMs (at least 1000) and an async execute function receiving {interaction,store,registry}. The dispatcher defers an ephemeral response before execution; finish with interaction.editReply. Declare memberPermissions and botPermissions for privileged actions. Also set default member permissions for Discord command visibility: defaults do not replace runtime checks.

Use interaction.guildId for all server-owned records. Never trust a client-supplied server ID in a future dashboard. For role/channel actions, verify target ownership, role hierarchy and permissions within that server. Extensions are trusted executable code with process access; they are not sandboxed plugins. Only install reviewed code. Dashboard-authored workflows will use validated predefined actions, never arbitrary JavaScript.

## Security and operational limits

Only Guilds intent; no message-content collection. User-facing replies are ephemeral with mentions disabled. Errors log command/server metadata, not raw exceptions, tokens or messages. SQL uses prepared statements. Cooldowns are process-local and reset on restart: run one instance for this milestone. SQLite settings persist in data/forge.sqlite; keep the database and WAL files on durable storage and back up consistently. This is a tested foundation, not a claim of complete production security.

## Checks and next milestones

Run `npm test`, `npm run check`, `npm run build` and `npm run format:check`. Run `npm run format` to apply consistent two-space indentation. Production source uses strict TypeScript; JavaScript test doubles exercise runtime validation. CI repeats these on Node 24. Integration checks: verify non-admin cannot configure modules, disabling example affects only one server, restart preserves settings, and re-enable restores hello.

Next: ticket module; welcome module with explicitly required intent; Discord OAuth dashboard with server permission rechecks and CSRF protections; constrained command builder. None of these later features is implemented yet.

Sources: https://discordjs.guide/legacy/app-creation/creating-commands and https://discordjs.guide/legacy/popular-topics/permissions-extended
