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

Guilds intent by default; optional Message Content Intent for on-demand ticket transcripts and Server Members Intent for welcome events. Message bodies are not stored in SQLite. Command replies are ephemeral with mentions disabled; live welcome messages may mention only the joining member. Errors log command/server metadata, not raw exceptions, tokens or messages. SQL uses prepared statements. Cooldowns are process-local and reset on restart: run one instance for this milestone. SQLite settings persist in data/forge.sqlite; keep the database and WAL files on durable storage and back up consistently. This is a tested foundation, not a claim of complete production security.

## Checks and next milestones

Run `npm test`, `npm run check`, `npm run build` and `npm run format:check`. Run `npm run format` to apply consistent two-space indentation. Production source uses strict TypeScript; JavaScript test doubles exercise runtime validation. CI repeats these on Node 24. Integration checks: verify non-admin cannot configure modules, disabling example affects only one server, restart preserves settings, and re-enable restores hello.

Implemented: ticket and welcome modules with Discord OAuth dashboard. Next: constrained command builder.

## Welcome module

1. Enable **Server Members Intent** under **Bot → Privileged Gateway Intents** in the Discord Developer Portal. Set `WELCOME_MEMBERS=true` in `.env`, build and restart. [Discord requires the privileged Guild Members intent for join events](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx).
2. Open **Welcome** in the dashboard. Choose a text channel, customize title, message, color and footer, and optionally choose a basic join role. Leaving the channel empty enables role-only setup; leaving the role empty enables message-only setup.
3. Supported placeholders: `{user}` (member mention), `{username}`, `{server}` and `{count}`. Member count reflects Discord’s current server count, not an all-time join counter. The browser preview uses an example member and count; **Send test message** uses your account and posts to the chosen channel without assigning a role or saving settings. `/welcome` gives managers an ephemeral preview of saved settings.
4. Press **Save welcome**. Ensure the **welcome** extension is enabled under **Extensions**. Settings persist across restarts and apply to future joins; existing members are not processed retroactively.

The bot needs View Channel, Send Messages and Embed Links for greetings. Join roles also require the bot’s Manage Roles permission. A configuring manager needs Manage Roles, and the role must be below both their highest role and the bot’s highest role (the server owner is exempt from their own hierarchy check). Managed, everyone, configured ticket-support and elevated roles are rejected. The permission allowlist permits basic conversation and voice permissions; administrative, moderation and unknown permissions are denied. Effective channel access granted by a basic role still depends on your server’s channel overwrites, so choose a dedicated member role.

Live events skip bots. Membership screening defers role assignment until the member is no longer pending; the welcome message is sent once on arrival, not again when screening completes. Runtime role checks reject roles that become elevated after setup. Turning off the extension stops greetings and join roles. Failures log only the server ID and a generic diagnostic; a failed role assignment does not prevent the greeting. There is no join-event replay, durable retry queue, leave-message feature or retroactive role assignment in this milestone.

Live checklist: send a test greeting, join with a second human account, confirm only the configured member role is assigned, test membership screening if enabled, then disable the extension and confirm subsequent joins receive neither action. Automated tests use Discord doubles and isolated browser fixtures; a real join still needs your development server.

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

The previous `/ticket setup category:... staff:...` still configures the command-only flow; use the wizard or dashboard to publish a panel. Existing tickets remain accessible through slash commands. The wizard uses existing channels and roles; create those in Discord before running it.

## Server dashboard

The dashboard runs in the bot process and uses its existing SQLite settings. No separate database or frontend build is needed. Run from the ForgeCore directory so the static `dashboard/` assets are available.

1. In your Discord application’s **OAuth2 → Redirects**, register `http://localhost:4190/auth/callback` exactly and save changes.
2. Add `DISCORD_CLIENT_SECRET` to `.env` using your application’s OAuth2 client secret. This is separate from the bot token; never commit either.
3. Set `DASHBOARD_ENABLED=true`, `DASHBOARD_URL=http://localhost:4190`, `DASHBOARD_PORT=4190` and `DASHBOARD_HOST=127.0.0.1`.
4. Build and restart the bot, then open `http://localhost:4190`. Sign in with Discord. The app requests only `identify` and `guilds` through the [authorization code flow](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx).
5. Select a server where you have Manage Server permission and the bot is installed. Configure routing, appearance, intake questions and a private archive, with live panel and ticket previews.
6. **Save settings** updates the settings used by new tickets. **Publish panel** additionally sends a new public support panel to your chosen Discord channel and makes the previous panel inactive. Existing tickets keep their snapshots. The selected panel destination is persisted when published.
7. Use **Extensions** to enable or disable installed modules for that server. Core administration cannot be disabled. Disabling tickets also disables ticket interaction controls until re-enabled.

The server rechecks your Discord membership and Manage Server permission for server requests, validates channel and role ownership, checks bot permissions and role hierarchy, and reuses private-archive validation. Saves require a session CSRF token and the configured origin. Tokens remain in server memory; browser cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Login sessions expire after at most one hour and disappear on restart. No OAuth refresh tokens are stored. The dashboard has request size, timeout and per-address rate limits. Preview text is rendered as text, not HTML; it approximates Discord embeds rather than interpreting Discord Markdown.

Local access is the default. Public hosting needs a persistent Node process and durable SQLite storage, an HTTPS reverse proxy, the matching HTTPS `DASHBOARD_URL` and registered callback, and an appropriate `DASHBOARD_HOST`. Do not expose the local HTTP configuration publicly. The server checks Host against the configured origin; your proxy must preserve that host. Sessions and operation locks are process-local: run one instance. OAuth errors such as `invalid oauth2_redirect_uri` mean the registered callback and requested callback differ.

Source layout: `src/dashboard/server.ts` handles OAuth and authorized settings routes, `src/dashboard/validation.ts` validates form data, and `dashboard/` contains the responsive frontend. Automated dashboard checks use synthetic OAuth responses and Discord objects; actual login and publishing must be checked with your own development server.

## Customizing your support desk

The setup wizard now has four pages. Use **Back** and **Next** to move between Routing, Appearance, Intake form and Transcript archive. Your saved settings are loaded when you run setup again; changes apply when you publish.

- **Appearance:** edit panel title, description, hex color, button label and footer; separately edit ticket title, welcome message and color. Preview the panel before publishing.
- **Intake form:** toggle the form off to open a channel immediately, or edit its title and one to five questions. Write each question on its own line: `required|short|Your question` or `optional|paragraph|Your question`. Short inputs allow 100 characters; paragraph inputs allow 1,000. The ticket card previews up to 700 characters per answer; exported transcripts include full submitted answers.
- **Transcript archive:** select a private staff text channel, or disable archive saving. The bot checks its sending/attachment permissions and rejects channels visible to non-staff roles or explicit non-staff member overwrites. Staff and server managers can view archives. It checks again when exporting, in case channel permissions have changed.

Closing automatically saves a text transcript in the configured archive when Message Content Intent is enabled and `TICKET_TRANSCRIPTS=true`. Manual exports save an archive copy too. If archiving fails, the bot reports the failure and preserves the ticket channel so you can retry. Exports still include at most the newest 1,000 available messages. Existing tickets keep the appearance, answers and archive destination from when they were opened. Archive messages and submitted answers remain until a server manager removes them; no automatic retention policy is implemented.

## Closed tickets and deletion

On **Routing** in `/ticket setup`, optionally select a closed-ticket category. Clear that selection to keep tickets in their original category. Publish to save the setting for new tickets. Closing moves the channel with `lockPermissions:false`, preserving its private overwrites. Reopening returns it to its original category. A failed move is reported while the ticket remains closed and locked.

Closed cards now offer **Delete ticket**. Only support staff or server managers can confirm permanent deletion. The bot rechecks ticket state and authorization at confirmation time. If a transcript archive is configured, deletion is blocked until a fresh transcript is successfully saved there. Without an archive, the confirmation warns that messages cannot be recovered. Successful deletion also removes the ticket's database record; existing archive files are retained.
