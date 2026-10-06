import { core } from './core.js';
import { example } from './example.js';
// Explicit allowlist: importing third-party extensions executes trusted code.
export const extensions = [core, example];
