import * as vscode from 'vscode';

import {
  findEndpoint,
  goToEndpoint,
  initConfig,
  openCallSite,
  revealEndpoint,
  setGroupBy,
  showCallSites,
} from './commands.js';
import { initLog, log } from './log.js';
import type { Scouted } from './nav.js';
import {
  EndpointHoverProvider,
  UsageCodeLensProvider,
  UsageDefinitionProvider,
} from './providers.js';
import { ensureIndex, initViewState, invalidate } from './store.js';
import { EndpointTreeProvider } from './tree.js';

// Settings that change what gets indexed (vs. display-only settings like groupBy).
const REINDEX_KEYS = [
  'specs',
  'sources',
  'exclude',
  'usage',
  'ignoreImports',
  'ignoreLines',
  'importAware',
  'importFrom',
  'configFile',
];

const SPEC_LIKE = /\.(json|jsonc|ya?ml)$/i;
const SOURCE_LIKE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;

// Operations are declared in spec files and referenced by `operationId` in
// NestJS controllers alike, so CodeLens + Go-to-Definition run on both.
const PROVIDER_SELECTOR: vscode.DocumentSelector = [
  { language: 'json' },
  { language: 'jsonc' },
  { language: 'yaml' },
  { language: 'typescript' },
  { language: 'typescriptreact' },
  { language: 'javascript' },
  { language: 'javascriptreact' },
];

export function activate(context: vscode.ExtensionContext): void {
  const channel = initLog();
  log.info('Route Scout activated.');

  const codeLens = new UsageCodeLensProvider();
  const tree = new EndpointTreeProvider();

  const refreshAll = (): void => {
    codeLens.refresh();
    tree.refresh();
  };
  initViewState(context.workspaceState, refreshAll);

  context.subscriptions.push(
    channel,
    vscode.commands.registerCommand('routeScout.showLogs', () => log.show()),
    vscode.languages.registerCodeLensProvider(PROVIDER_SELECTOR, codeLens),
    vscode.languages.registerDefinitionProvider(PROVIDER_SELECTOR, new UsageDefinitionProvider()),
    vscode.languages.registerHoverProvider(PROVIDER_SELECTOR, new EndpointHoverProvider()),
    vscode.window.registerTreeDataProvider('routeScout.tree', tree),
    vscode.commands.registerCommand('routeScout.findEndpoint', () => findEndpoint()),
    vscode.commands.registerCommand('routeScout.showCallSites', (scouted: Scouted) =>
      showCallSites(scouted),
    ),
    vscode.commands.registerCommand('routeScout.setGroupBy', () => setGroupBy()),
    vscode.commands.registerCommand('routeScout.initConfig', () => initConfig()),
    vscode.commands.registerCommand('routeScout.revealEndpoint', () => revealEndpoint()),
    vscode.commands.registerCommand(
      'routeScout.openCallSite',
      (root: string, file: string, line: number) => openCallSite(root, file, line),
    ),
    vscode.commands.registerCommand(
      'routeScout.goToEndpoint',
      (root: string, operationId: string, specFile: string, identity: string[]) =>
        goToEndpoint(root, operationId, specFile, identity),
    ),
    vscode.commands.registerCommand('routeScout.rebuild', async () => {
      invalidate();
      await ensureIndex();
      refreshAll();
      void vscode.window.showInformationMessage('Route Scout: index rebuilt.');
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('routeScout')) return;
      // Only reindex when a scanning-relevant setting changed; groupBy is display-only.
      if (REINDEX_KEYS.some((key) => event.affectsConfiguration(`routeScout.${key}`))) invalidate();
      refreshAll();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const cfg = vscode.workspace.getConfiguration('routeScout', document.uri);
      if (!cfg.get<boolean>('rebuildOnSave')) return;
      const path = document.uri.fsPath;
      if (SPEC_LIKE.test(path) || SOURCE_LIKE.test(path)) {
        invalidate();
        refreshAll();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      invalidate();
      refreshAll();
    }),
  );

  void ensureIndex().then(refreshAll);
}

export function deactivate(): void {
  invalidate();
}
