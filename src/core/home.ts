import { homedir } from 'node:os';
import { join } from 'node:path';

// Where cedia keeps the user's settings, sessions and caches: CEDIA_HOME, else ~/.cedia. A leaf module, so any part
// of core can name it without importing config.ts and everything config.ts imports.
export const cediaHome = () => process.env.CEDIA_HOME ?? join(homedir(), '.cedia');
