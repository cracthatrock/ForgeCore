import type {
  ChatInputCommandInteraction,
  PermissionResolvable,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { SettingsStore } from './store.js';

export interface CommandContext {
  interaction: ChatInputCommandInteraction<'raw' | 'cached'>;
  store: SettingsStore;
  registry: Registry;
}
export interface Command {
  ephemeral?: boolean;
  data: { toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  cooldownMs: number;
  memberPermissions?: PermissionResolvable;
  botPermissions?: PermissionResolvable;
  execute(context: CommandContext): Promise<unknown>;
}
export interface Extension {
  id: string;
  commands: Command[];
}
export interface RegisteredCommand extends Command {
  extensionId: string;
}
export interface Registry {
  plugins: Map<string, Extension>;
  commands: Map<string, RegisteredCommand>;
  definitions: RESTPostAPIChatInputApplicationCommandsJSONBody[];
}
export interface Logger {
  error(message: string, metadata?: Record<string, unknown>): void;
}
