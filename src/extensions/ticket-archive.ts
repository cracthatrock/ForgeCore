import { ChannelType, PermissionFlagsBits, type GuildBasedChannel } from 'discord.js';

export async function validateArchive(
  channel: GuildBasedChannel | null,
  staffRole: string,
) {
  if (channel?.type !== ChannelType.GuildText)
    return 'Choose a text channel for transcript archives.';
  const me = await channel.guild.members.fetchMe();
  const permissions = PermissionFlagsBits;
  if (
    !channel
      .permissionsFor(me)
      ?.has([
        permissions.ViewChannel,
        permissions.SendMessages,
        permissions.AttachFiles,
        permissions.EmbedLinks,
      ])
  ) {
    return 'The bot needs View Channel, Send Messages, Attach Files and Embed Links in the transcript channel.';
  }
  const roles = await channel.guild.roles.fetch();
  for (const role of roles.values()) {
    if (
      role.id === staffRole ||
      (role.managed && role.tags?.botId === me.id) ||
      role.permissions.has(permissions.Administrator) ||
      role.permissions.has(permissions.ManageGuild)
    )
      continue;
    if (channel.permissionsFor(role)?.has(permissions.ViewChannel))
      return 'Use a private staff transcript channel. A non-staff role can currently view the selected channel.';
  }
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (
      overwrite.type !== 1 ||
      !overwrite.allow.has(permissions.ViewChannel) ||
      overwrite.id === me.id
    )
      continue;
    const member = await channel.guild.members.fetch(overwrite.id).catch(() => null);
    if (
      !member ||
      (!member.roles.cache.has(staffRole) &&
        !member.permissions.has(permissions.ManageGuild))
    )
      return 'A non-staff member has explicit access to the transcript channel. Remove that access or choose another channel.';
  }
  return null;
}
