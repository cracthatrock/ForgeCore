# Record a ForgeCore demo

Aim for 90 seconds. Talking is optional: use the captions below. The included [45-second dashboard walkthrough](media/forgecore-walkthrough.mp4) is a captioned preview using example data. This guide adds the live Discord proof.

## Prepare once

1. Use your development server. Create a welcome channel, ticket panel channel, private transcript channel, ticket categories, basic member role and support role.
2. Run ForgeCore and open the dashboard at `http://localhost:4190`. Sign in before recording. Enable the required intents for the features you plan to demonstrate.
3. Configure a tidy support panel, a welcome greeting and one `/rules` reply with a link button. Keep the reply short enough to read on screen.
4. Open Discord beside the dashboard, close unrelated tabs and enable Do Not Disturb. Record only those windows, with readable text. Keep tokens, `.env`, OAuth secrets, email addresses and unrelated server conversations outside the recording.
5. Start with the support dashboard selected. Do one practice run so you know which channels to open.

## Record these shots

| Time   | What to show                                                                                       | Caption                                                |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0–7s   | Dashboard with the server selected                                                                 | ForgeCore — a configurable Discord bot and dashboard   |
| 7–20s  | Appearance settings: edit panel title/color and show the preview                                   | Customize your support experience                      |
| 20–35s | Publish the panel, switch to Discord and click Get support; complete the form                      | From dashboard settings to a private ticket            |
| 35–48s | Show the ticket status card, claim it, then close; show the closed category and archive if enabled | A complete support flow: claim, close and archive      |
| 48–60s | Welcome settings and Send test message; switch to the posted greeting                              | Personalized welcome messages and optional join roles  |
| 60–77s | Command studio: save/publish `/rules`, then run it in Discord                                      | Create useful commands without editing code            |
| 77–84s | Extension toggles and a brief view of the organized source folders                                 | Modular TypeScript. Persistent server settings.        |
| 84–90s | GitHub README and repository URL                                                                   | Explore ForgeCore at github.com/cracthatrock/ForgeCore |

**Send test message demonstrates the greeting only.** It does not prove join-role assignment. To include that proof, use a second human account joining the development server, then show the assigned basic role. Do not describe a test greeting as a real join event.

## Optional voiceover

“This is ForgeCore, my configurable Discord bot foundation. The dashboard lets server managers customize support panels, ticket forms and transcript routing. Those settings power the real Discord flow: members open private tickets, staff claim them, and closed conversations can be archived. The welcome module supports personalized greetings and basic join roles. Command studio lets managers build useful slash-command replies with embeds, links, role checks and cooldowns. It’s built in TypeScript with SQLite persistence and trusted extensions, with setup documentation and automated checks available on GitHub.”

## Finish

Trim waiting, repeated clicks and login screens. Export MP4 at 1080p and keep captions readable on a phone. Watch once with sound off to ensure the flow makes sense. Upload to your preferred video host, then add the real video link to the README’s See it in action section. Keep the example-data walkthrough labeled separately.

Suggested title: **ForgeCore | Discord bot + dashboard demo**.

Suggested description: **A TypeScript Discord bot foundation with configurable tickets, welcome messages and dashboard-built slash commands. Source and setup: https://github.com/cracthatrock/ForgeCore**.
