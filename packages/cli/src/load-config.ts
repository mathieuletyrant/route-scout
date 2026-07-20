import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { RouteScoutConfig } from '@route-scout/core';

const CONFIG_NAMES = [
  'routescout.config.json',
  'routescout.config.js',
  'routescout.config.mjs',
  'routescout.config.cjs',
  '.routescoutrc.json',
];

export interface LoadedConfig {
  config: RouteScoutConfig;
  /** Absolute path of the config file that was loaded, or null if none. */
  from: string | null;
}

/** Load a config file: an explicit `--config` path, else the first discovered in `cwd`. */
export async function loadConfigFile(cwd: string, explicit?: string): Promise<LoadedConfig> {
  const path = explicit
    ? isAbsolute(explicit)
      ? explicit
      : resolve(cwd, explicit)
    : discover(cwd);

  if (!path) return { config: {}, from: null };
  if (!existsSync(path)) throw new Error(`route-scout: config file not found: ${path}`);

  const config = /\.json$/.test(path)
    ? (JSON.parse(await readFile(path, 'utf8')) as RouteScoutConfig)
    : await importConfig(path);

  return { config, from: path };
}

function discover(cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function importConfig(path: string): Promise<RouteScoutConfig> {
  const module = (await import(pathToFileURL(path).href)) as {
    default?: RouteScoutConfig;
  } & RouteScoutConfig;
  return module.default ?? module;
}
