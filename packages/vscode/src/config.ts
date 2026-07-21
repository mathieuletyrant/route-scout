import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RouteScoutConfig } from '@route-scout/core';
import * as vscode from 'vscode';

// Core config + the extension-only `definitions` (globs of files that *declare*
// operationIds, e.g. NestJS controllers). Editor-navigation only — the core
// scanner ignores it, so it stays out of `@route-scout/core`.
export type ScoutConfig = RouteScoutConfig & { definitions?: string[] };

/** Read the effective config for a workspace folder: a `configFile` if set, else the settings. */
export function readConfig(folder: vscode.WorkspaceFolder): ScoutConfig {
  const cfg = vscode.workspace.getConfiguration('routeScout', folder.uri);
  const root = folder.uri.fsPath;

  const configFile = cfg.get<string>('configFile')?.trim();
  if (configFile) {
    const abs = join(root, configFile);
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as ScoutConfig;
    return { ...parsed, root };
  }

  return {
    root,
    specs: cfg.get<string[]>('specs'),
    sources: cfg.get<string[]>('sources'),
    exclude: cfg.get<string[]>('exclude'),
    usage: cfg.get<RouteScoutConfig['usage']>('usage'),
    ignoreImports: cfg.get<boolean>('ignoreImports'),
    ignoreLines: cfg.get<string[]>('ignoreLines'),
    importAware: cfg.get<boolean>('importAware'),
    importFrom: cfg.get<string[]>('importFrom'),
    definitions: cfg.get<string[]>('definitions'),
  };
}
