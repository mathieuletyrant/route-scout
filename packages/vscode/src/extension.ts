import { readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { buildIndex, type EndpointUsage, type RouteScoutConfig } from '@route-scout/core';
import * as vscode from 'vscode';

/** An endpoint together with the workspace-folder root its paths resolve against. */
interface Scouted {
  root: string;
  endpoint: EndpointUsage;
}

let state: Scouted[] | null = null;
let building: Promise<Scouted[]> | null = null;

const toPosix = (p: string): string => p.split('\\').join('/');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readConfig(folder: vscode.WorkspaceFolder): RouteScoutConfig {
  const cfg = vscode.workspace.getConfiguration('routeScout', folder.uri);
  const root = folder.uri.fsPath;

  const configFile = cfg.get<string>('configFile')?.trim();
  if (configFile) {
    const abs = join(root, configFile);
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as RouteScoutConfig;
    return { ...parsed, root };
  }

  return {
    root,
    specs: cfg.get<string[]>('specs'),
    sources: cfg.get<string[]>('sources'),
    exclude: cfg.get<string[]>('exclude'),
    usage: cfg.get<RouteScoutConfig['usage']>('usage'),
    ignoreLines: cfg.get<string[]>('ignoreLines'),
  };
}

// ---------------------------------------------------------------------------
// Index lifecycle
// ---------------------------------------------------------------------------

async function buildAll(): Promise<Scouted[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const scouted: Scouted[] = [];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Route Scout: indexing endpoints…' },
    async () => {
      for (const folder of folders) {
        try {
          const config = readConfig(folder);
          const result = await buildIndex(config);
          for (const endpoint of result.endpoints) {
            scouted.push({ root: result.root, endpoint });
          }
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Route Scout: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
  );

  return scouted;
}

function ensureIndex(): Promise<Scouted[]> {
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

function invalidate(): void {
  state = null;
  building = null;
}

// ---------------------------------------------------------------------------
// Locating an operation inside its spec document
// ---------------------------------------------------------------------------

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Best-effort line (0-based) of an operation within its spec document. */
function locateOperation(document: vscode.TextDocument, endpoint: EndpointUsage): number | null {
  const { operationId, path } = endpoint.operation;
  const byId = operationId
    ? new RegExp(`operationId["']?\\s*:\\s*["']?${escapeRe(operationId)}\\b`)
    : null;
  const byPath = new RegExp(`["']?${escapeRe(path)}["']?\\s*:`);

  let pathLine: number | null = null;
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    if (byId?.test(text)) return line;
    if (pathLine === null && byPath.test(text)) pathLine = line;
  }
  return pathLine;
}

// ---------------------------------------------------------------------------
// CodeLens
// ---------------------------------------------------------------------------

class UsageCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!state) {
      void ensureIndex().then(() => this.refresh());
      return [];
    }

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return [];
    const root = folder.uri.fsPath;
    const relPath = toPosix(relative(root, document.uri.fsPath));

    const lenses: vscode.CodeLens[] = [];
    for (const scouted of state) {
      if (scouted.root !== root || scouted.endpoint.operation.specFile !== relPath) continue;
      const line = locateOperation(document, scouted.endpoint);
      if (line === null) continue;

      const count = scouted.endpoint.callSites.length;
      lenses.push(
        new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title: count > 0 ? `⟶ ${count} usage${count === 1 ? '' : 's'}` : '⟶ no usages',
          command: 'routeScout.showCallSites',
          arguments: [scouted],
        }),
      );
    }
    return lenses;
  }
}

// ---------------------------------------------------------------------------
// Tree view
// ---------------------------------------------------------------------------

type SpecNode = { kind: 'spec'; specFile: string; children: Scouted[] };
type EndpointNode = { kind: 'endpoint'; scouted: Scouted };
type CallSiteNode = { kind: 'callsite'; root: string; file: string; line: number; preview: string };
type Node = SpecNode | EndpointNode | CallSiteNode;

class EndpointTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const scouted = await ensureIndex();
      const bySpec = new Map<string, Scouted[]>();
      for (const s of scouted) {
        const list = bySpec.get(s.endpoint.operation.specFile) ?? [];
        list.push(s);
        bySpec.set(s.endpoint.operation.specFile, list);
      }
      return [...bySpec.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([specFile, children]) => ({ kind: 'spec', specFile, children }));
    }
    if (element.kind === 'spec') {
      return element.children.map((scouted) => ({ kind: 'endpoint', scouted }));
    }
    if (element.kind === 'endpoint') {
      const { root } = element.scouted;
      return element.scouted.endpoint.callSites.map((site) => ({
        kind: 'callsite',
        root,
        file: site.file,
        line: site.line,
        preview: site.preview,
      }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'spec') {
      const used = node.children.filter((s) => s.endpoint.callSites.length > 0).length;
      const item = new vscode.TreeItem(node.specFile, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${used}/${node.children.length} used`;
      item.iconPath = new vscode.ThemeIcon('symbol-file');
      return item;
    }
    if (node.kind === 'endpoint') {
      const { operation, callSites } = node.scouted.endpoint;
      const count = callSites.length;
      const item = new vscode.TreeItem(
        `${operation.method.toUpperCase()} ${operation.path}`,
        count > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.description = count > 0 ? `${count} usage${count === 1 ? '' : 's'}` : 'unused';
      item.iconPath = new vscode.ThemeIcon(count > 0 ? 'plug' : 'circle-slash');
      item.tooltip = new vscode.MarkdownString(
        [
          `**${operation.method.toUpperCase()}** \`${operation.path}\``,
          operation.operationId ? `operationId: \`${operation.operationId}\`` : null,
          operation.summary ?? null,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      return item;
    }
    const item = new vscode.TreeItem(
      `${basename(node.file)}:${node.line}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = dirname(node.file);
    item.iconPath = new vscode.ThemeIcon('go-to-file');
    item.tooltip = node.preview;
    item.command = {
      command: 'routeScout.openCallSite',
      title: 'Open call site',
      arguments: [node.root, node.file, node.line],
    };
    return item;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function openCallSite(root: string, file: string, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(root, file)));
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function showCallSites(scouted: Scouted): Promise<void> {
  const { endpoint, root } = scouted;
  if (endpoint.callSites.length === 0) {
    void vscode.window.showInformationMessage(
      `${endpoint.operation.method.toUpperCase()} ${endpoint.operation.path} — no usages found.`,
    );
    return;
  }

  type Item = vscode.QuickPickItem & { line: number; file: string };
  const items: Item[] = endpoint.callSites.map((site) => ({
    label: `$(go-to-file) ${basename(site.file)}:${site.line}`,
    description: dirname(site.file),
    detail: site.preview,
    file: site.file,
    line: site.line,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `${endpoint.operation.method.toUpperCase()} ${endpoint.operation.path} — ${endpoint.callSites.length} usage(s)`,
    placeHolder: 'Jump to a usage…',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked) await openCallSite(root, picked.file, picked.line);
}

async function findEndpoint(): Promise<void> {
  const scouted = await ensureIndex();
  if (scouted.length === 0) {
    void vscode.window.showInformationMessage(
      'Route Scout: no OpenAPI operations found. Check the `routeScout.specs` setting.',
    );
    return;
  }

  type Item = vscode.QuickPickItem & { scouted: Scouted };
  const items: Item[] = scouted
    .slice()
    .sort((a, b) => {
      const oa = a.endpoint.operation;
      const ob = b.endpoint.operation;
      return oa.specFile.localeCompare(ob.specFile) || oa.path.localeCompare(ob.path);
    })
    .map((s) => {
      const { operation, callSites } = s.endpoint;
      return {
        label: `${operation.method.toUpperCase()} ${operation.path}`,
        description:
          callSites.length > 0 ? `$(references) ${callSites.length}` : '$(circle-slash) unused',
        detail: `${operation.specFile}${operation.operationId ? `  ·  ${operation.operationId}` : ''}`,
        scouted: s,
      };
    });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Route Scout: find an endpoint',
    placeHolder: 'Search by method, path, spec, or operationId…',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked) await showCallSites(picked.scouted);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

const SPEC_LIKE = /\.(json|jsonc|ya?ml)$/i;
const SOURCE_LIKE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;

export function activate(context: vscode.ExtensionContext): void {
  const codeLens = new UsageCodeLensProvider();
  const tree = new EndpointTreeProvider();

  const refreshAll = (): void => {
    codeLens.refresh();
    tree.refresh();
  };

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: 'json' }, { language: 'jsonc' }, { language: 'yaml' }],
      codeLens,
    ),
    vscode.window.registerTreeDataProvider('routeScout.tree', tree),
    vscode.commands.registerCommand('routeScout.findEndpoint', () => findEndpoint()),
    vscode.commands.registerCommand('routeScout.showCallSites', (scouted: Scouted) =>
      showCallSites(scouted),
    ),
    vscode.commands.registerCommand(
      'routeScout.openCallSite',
      (root: string, file: string, line: number) => openCallSite(root, file, line),
    ),
    vscode.commands.registerCommand('routeScout.rebuild', async () => {
      invalidate();
      await ensureIndex();
      refreshAll();
      void vscode.window.showInformationMessage('Route Scout: index rebuilt.');
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('routeScout')) {
        invalidate();
        refreshAll();
      }
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
