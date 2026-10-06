import { core } from './core.js';
import { example } from './example.js';
import { tickets } from './tickets.js';

// Explicit allowlist: importing third-party extensions executes trusted code.
export const extensions = [core, example, tickets];
