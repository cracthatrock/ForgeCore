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

Guilds intent by default; optional Message Content Intent for on-demand ticket transcripts. Message bodies are not stored in SQLite. User-facing replies are ephemeral with mentions disabled. Errors log command/server metadata, not raw exceptions, tokens or messages. SQL uses prepared statements. Cooldowns are process-local and reset on restart: run one instance for this milestone. SQLite settings persist in data/forge.sqlite; keep the database and WAL files on durable storage and back up consistently. This is a tested foundation, not a claim of complete production security.

## Checks and next milestones

Run `npm test`, `npm run check`, `npm run build` and `npm run format:check`. Run `npm run format` to apply consistent two-space indentation. Production source uses strict TypeScript; JavaScript test doubles exercise runtime validation. CI repeats these on Node 24. Integration checks: verify non-admin cannot configure modules, disabling example affects only one server, restart preserves settings, and re-enable restores hello.

Implemented: ticket module. Next: welcome module with explicitly required intent; Discord OAuth dashboard with server permission rechecks and CSRF protections; constrained command builder. None of these later features is implemented yet.

Sources: https://discordjs.guide/legacy/app-creation/creating-commands and https://discordjs.guide/legacy/popular-topics/permissions-extended

## Tickets

Register the new command with `npm run deploy`. The bot needs View Channels, Send Messages, Read Message History, Attach Files, Manage Channels and Manage Roles. Place its role above your support role.

1. Create a category and a dedicated support role.
2. A member with Manage Server runs `/ticket setup category:<category> staff:<role>`.
3. Members use `/ticket open`. Everyone is denied visibility except the owner, support role and bot. Discord administrators can still access tickets.
4. Staff use `/ticket claim` inside the ticket. First claim wins.
5. Owner or staff use `/ticket close`. The owner's replies are locked; the channel is preserved. Staff can still write. Administrators bypass channel restrictions.
6. To export, enable Message Content Intent in the Developer Portal, set `TICKET_TRANSCRIPTS=true` in `.env`, and restart. Owner or staff use `/ticket transcript` inside a ticket. The private text attachment contains up to the newest 1,000 messages and available attachment links. Deleted messages and attachment file copies are excluded. [Discord message-content documentation](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx).

Ticket configuration, ownership, claims and closed state persist in SQLite. One open ticket per member per server is enforced. Changing setup affects new channels; existing permissions are not rewritten. Disable commands with `/extensions name:tickets enabled:false`. Server managers can delete preserved channels manually. Run a single instance: operation locks are process-local.

Live checklist: verify ordinary-user setup denial, visibility with a second account, duplicate opens, staff-only claims, close and reopen, restart persistence, transcript export and extension disabling. Automated checks use simulated Discord interactions; live channel creation still needs testing with your bot credentials.

## Guided support setup

Run `/ticket setup` without options to open the private setup wizard. Select your support role, ticket category and public panel channel, then press **Publish support panel**. The wizard expires after ten minutes and rechecks Manage Server before publishing. The bot needs Embed Links in addition to the ticket permissions above.

Members click **Get support**, enter a subject and description, and receive a private ticket with a status card. Staff use **Claim** or **Unclaim**; the assigned member is shown on the card. **Close** asks for confirmation. Closed tickets offer **Reopen** (staff only) and **Export transcript**. Controls use persistent ticket records and continue to work after a restart. Setup drafts expire on restart. Republishing makes old panels inactive. Reopening is blocked if the owner has another open ticket.

The previous `/ticket setup category:... staff:...` still configures the command-only flow; use the wizard to publish a panel. Existing tickets remain accessible through slash commands. The wizard uses existing channels and roles; create those in Discord before running it. There is no web dashboard yet.

## Customizing your support desk

The setup wizard now has four pages. Use **Back** and **Next** to move between Routing, Appearance, Intake form and Transcript archive. Your saved settings are loaded when you run setup again; changes apply when you publish.

- **Appearance:** edit panel title, description, hex color, button label and footer; separately edit ticket title, welcome message and color. Preview the panel before publishing.
- **Intake form:** toggle the form off to open a channel immediately, or edit its title and one to five questions. Write each question on its own line: `required|short|Your question` or `optional|paragraph|Your question`. Short inputs allow 100 characters; paragraph inputs allow 1,000. The ticket card previews up to 700 characters per answer; exported transcripts include full submitted answers.
- **Transcript archive:** select a private staff text channel, or disable archive saving. The bot checks its sending/attachment permissions and rejects channels visible to non-staff roles or explicit non-staff member overwrites. Staff and server managers can view archives. It checks again when exporting, in case channel permissions have changed.

Closing automatically saves a text transcript in the configured archive when Message Content Intent is enabled and `TICKET_TRANSCRIPTS=true`. Manual exports save an archive copy too. If archiving fails, the bot reports the failure and preserves the ticket channel so you can retry. Exports still include at most the newest 1,000 available messages. Existing tickets keep the appearance, answers and archive destination from when they were opened. Archive messages and submitted answers remain until a server manager removes them; no automatic retention policy is implemented.
