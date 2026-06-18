import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

export const REPO_URL = process.env.BC_SOURCE_REPO_URL
  ?? 'https://github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History.git';

export const CACHE_ROOT = process.env.BC_SOURCE_CACHE_DIR
  ?? join(HOME, '.bc-source-mcp');

export const REPO_DIR = join(CACHE_ROOT, 'repo');
export const WORKTREES_DIR = join(CACHE_ROOT, 'worktrees');
export const INDEX_DB = join(CACHE_ROOT, 'index.db');
export const META_FILE = join(CACHE_ROOT, 'meta.json');

export const VERSIONS = ['23', '24', '25', '26', '27', '28', '29'] as const;
export type Version = typeof VERSIONS[number];

export const LOCALIZATIONS: { code: string; name: string }[] = [
  { code: 'w1', name: 'Worldwide (base)' },
  { code: 'at', name: 'Austria' },
  { code: 'au', name: 'Australia' },
  { code: 'be', name: 'Belgium' },
  { code: 'bg', name: 'Bulgaria' },
  { code: 'br', name: 'Brazil' },
  { code: 'ca', name: 'Canada' },
  { code: 'ch', name: 'Switzerland' },
  { code: 'co', name: 'Colombia' },
  { code: 'cz', name: 'Czechia' },
  { code: 'de', name: 'Germany' },
  { code: 'dk', name: 'Denmark' },
  { code: 'ee', name: 'Estonia' },
  { code: 'es', name: 'Spain' },
  { code: 'fi', name: 'Finland' },
  { code: 'fr', name: 'France' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'gr', name: 'Greece' },
  { code: 'hk', name: 'Hong Kong' },
  { code: 'hr', name: 'Croatia' },
  { code: 'hu', name: 'Hungary' },
  { code: 'ie', name: 'Ireland' },
  { code: 'in', name: 'India' },
  { code: 'is', name: 'Iceland' },
  { code: 'it', name: 'Italy' },
  { code: 'jp', name: 'Japan' },
  { code: 'kr', name: 'South Korea' },
  { code: 'lt', name: 'Lithuania' },
  { code: 'lv', name: 'Latvia' },
  { code: 'mx', name: 'Mexico' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'no', name: 'Norway' },
  { code: 'nz', name: 'New Zealand' },
  { code: 'pe', name: 'Peru' },
  { code: 'ph', name: 'Philippines' },
  { code: 'pl', name: 'Poland' },
  { code: 'pt', name: 'Portugal' },
  { code: 'ro', name: 'Romania' },
  { code: 'rs', name: 'Serbia' },
  { code: 'se', name: 'Sweden' },
  { code: 'si', name: 'Slovenia' },
  { code: 'sk', name: 'Slovakia' },
  { code: 'th', name: 'Thailand' },
  { code: 'tr', name: 'Turkey' },
  { code: 'tw', name: 'Taiwan' },
  { code: 'ua', name: 'Ukraine' },
  { code: 'us', name: 'United States' },
  { code: 'vn', name: 'Vietnam' },
];

export const LOCALIZATION_CODES = new Set(LOCALIZATIONS.map(l => l.code));

export const META_BRANCHES = new Set(['main', 'base', 'core', 'serena']);

export const SERVER_NAME = 'bc-source-mcp';
export const SERVER_VERSION = '0.1.0';
