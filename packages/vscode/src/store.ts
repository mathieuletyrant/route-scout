import { relative } from 'node:path';

import { buildIndex, expandTemplate, resolveConfig } from '@route-scout/core';
import * as vscode from 'vscode';

import { readConfig } from './config.js';
import { log } from './log.js';
import { type DeclLoc, declarationsIn, type Scouted, toPosix } from './nav.js';

// --- Index state -----------------------------------------------------------
// The whole extension reads the index through this module, so it lives here as
// module state rather than being threaded through every provider and command.

let state: Scouted[] | null = null;
let building: Promise<Scouted[]> | null = null;

// operationId → its declaration site(s) from `definitions` files. Lets
// "Go to Endpoint" jump to the real definition (controller) instead of the spec.
let declarationNav: Map<string, DeclLoc[]> | null = null;

// symbol (matcher expansion) or operationId → endpoints, for hover + reverse
// navigation from a call site back to its spec. Rebuilt with the index.
let symbolNav: Map<string, Scouted[]> | null = null;

export const getState = (): Scouted[] | null => state;
export const getSymbolNav = (): Map<string, Scouted[]> | null => symbolNav;
export const getDeclarationNav = (): Map<string, DeclLoc[]> | null => declarationNav;

function addNav(nav: Map<string, Scouted[]>, key: string | null, scouted: Scouted): void {
  if (!key) return;
  const list = nav.get(key) ?? [];
  if (!list.includes(scouted)) list.push(scouted);
  nav.set(key, list);
}

async function buildAll(): Promise<Scouted[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const scouted: Scouted[] = [];
  const nav = new Map<string, Scouted[]>();
  const decls = new Map<string, DeclLoc[]>();

  log.info(`Indexing ${folders.length} workspace folder(s)…`);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Route Scout: indexing endpoints…' },
    async () => {
      for (const folder of folders) {
        try {
          const config = readConfig(folder);
          log.debug(`[${folder.name}] indexing ${config.root}`);
          const symbolTemplates = resolveConfig(config)
            .usage.filter((m) => m.kind === 'symbol')
            .map((m) => m.template);
          const result = await buildIndex(config);
          for (const endpoint of result.endpoints) {
            const item: Scouted = { root: result.root, endpoint };
            scouted.push(item);
            // Reverse-nav keys: the operationId and every symbol-matcher expansion.
            addNav(nav, endpoint.operation.operationId, item);
            for (const template of symbolTemplates) {
              addNav(nav, expandTemplate(template, endpoint.operation, 'literal'), item);
            }
          }
          const { stats } = result;
          log.info(
            `[${folder.name}] ${stats.operations} operations in ${stats.specFiles} spec(s), ` +
              `${stats.usedOperations} used across ${stats.sourceFiles} source(s).`,
          );
          await collectDeclarations(folder, config.definitions ?? [], decls);
        } catch (error) {
          log.error(error instanceof Error ? error : String(error));
          void vscode.window
            .showErrorMessage(
              `Route Scout: ${error instanceof Error ? error.message : String(error)}`,
              'Show logs',
            )
            .then((pick) => {
              if (pick === 'Show logs') log.show();
            });
        }
      }
    },
  );

  symbolNav = nav;
  declarationNav = decls;
  log.info(`Index ready: ${scouted.length} endpoint(s), ${decls.size} declared operationId(s).`);
  return scouted;
}

/** Scan `definitions` files for `operationId: '…'` declarations (e.g. controllers). */
async function collectDeclarations(
  folder: vscode.WorkspaceFolder,
  globs: string[],
  decls: Map<string, DeclLoc[]>,
): Promise<void> {
  const root = folder.uri.fsPath;
  for (const glob of globs) {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, glob),
      '**/node_modules/**',
    );
    for (const uri of uris) {
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const file = toPosix(relative(root, uri.fsPath));
      for (const { id, line } of declarationsIn(text)) {
        const list = decls.get(id) ?? [];
        list.push({ root, file, line });
        decls.set(id, list);
      }
    }
  }
}

export function ensureIndex(): Promise<Scouted[]> {
  if (state) return Promise.resolve(state);
  if (building) return building;
  building = buildAll()
    .then((scouted) => {
      state = scouted;
      return scouted;
    })
    .finally(() => {
      building = null;
    });
  return building;
}

export function invalidate(): void {
  state = null;
  building = null;
  symbolNav = null;
  declarationNav = null;
}

/**
 * operationId → every scouted endpoint that declares it (api + internal
 * channels). Memoized against the current `state`; rebuilds only when the index
 * changes (CodeLens/Definition can fire often on large specs).
 */
let opIndexCache: { for: Scouted[] | null; map: Map<string, Scouted[]> } | null = null;
export function byOperationId(): Map<string, Scouted[]> {
  if (opIndexCache?.for === state) return opIndexCache.map;
  const map = new Map<string, Scouted[]>();
  for (const scouted of state ?? []) {
    const id = scouted.endpoint.operation.operationId;
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(scouted);
    map.set(id, list);
  }
  opIndexCache = { for: state, map };
  return map;
}

// --- View wiring -----------------------------------------------------------
// Set once on activation. `groupState` holds the view's grouping choice as
// workspace state (a view toggle, not a persisted setting), so changing it never
// writes .vscode/settings.json. `onRefresh` re-renders the views after a change.

let groupState: vscode.Memento | undefined;
let onRefresh: (() => void) | undefined;

export function initViewState(memento: vscode.Memento, refresh: () => void): void {
  groupState = memento;
  onRefresh = refresh;
}

export const getGroupState = (): vscode.Memento | undefined => groupState;
export const refreshViews = (): void => onRefresh?.();
