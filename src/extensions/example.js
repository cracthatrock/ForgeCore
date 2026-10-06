import {SlashCommandBuilder,InteractionContextType} from 'discord.js';
// Trusted local code only. Follow this shape to build a new extension.
export const example={id:'example',commands:[{
 data:new SlashCommandBuilder().setName('hello').setDescription('Try the example extension').setContexts(InteractionContextType.Guild),cooldownMs:3000,
 async execute({interaction}){await interaction.editReply({content:'Hello! This command comes from a ForgeCore extension.',allowedMentions:{parse:[]}})}
}]};
