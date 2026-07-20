import { readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import {
  buildIndex,
  type EndpointUsage,
  type RouteScoutConfig,
  serverName,
} from '@route-scout/core';
import * as vscode from 'vscode';

/** An endpoint together with the workspace-folder root its paths resolve against. */
interface Scouted {
  root: string;
  endpoint: EndpointUsage;
}

let state: Scouted[] | null = null;
let building: Promise<Scouted[]> | null = null;

// Set on activation. `groupState` holds the view's grouping choice as workspace
// state (a view toggle, not a persisted setting), so changing it never has to
// write .vscode/settings.json. `refreshViews` re-renders after a state change.
let groupState: vscode.Memento | undefined;
let refreshViews: (() => void) | undefined;

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
    ignoreImports: cfg.get<boolean>('ignoreImports'),
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

// Matches `operationId: 'x'` / "operationId": "x" — in an OpenAPI spec
// (JSON/YAML) and in NestJS `@ApiOperation({ operationId: 'x' })` decorators.
const OPERATION_ID_LINE = /operationId["']?\s*:\s*["']([\w.\-/]+)["']/;

/** operationId → every scouted endpoint that declares it (api + internal channels). */
function byOperationId(): Map<string, Scouted[]> {
  const map = new Map<string, Scouted[]>();
  for (const scouted of state ?? []) {
    const id = scouted.endpoint.operation.operationId;
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(scouted);
    map.set(id, list);
  }
  return map;
}

/**
 * The same operationId can exist on several endpoints (e.g. the `api` and
 * `internal` channels in NestJS). Narrow candidates to the one this document is
 * really about: an exact spec-file match, else a leading path segment (`api` /
 * `internal`) that appears as a token in the file path (matching
 * `*.api.controller.ts` / `*.internal.controller.ts`). Falls back to all.
 */
function disambiguate(document: vscode.TextDocument, candidates: Scouted[]): Scouted[] {
  if (candidates.length <= 1) return candidates;

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder) {
    const rel = toPosix(relative(folder.uri.fsPath, document.uri.fsPath));
    const inSpec = candidates.filter((s) => s.endpoint.operation.specFile === rel);
    if (inSpec.length > 0) return inSpec;
  }

  const tokens = new Set(document.uri.fsPath.toLowerCase().split(/[^a-z0-9]+/));
  const hinted = candidates.filter((s) => {
    const segment = s.endpoint.operation.path.split('/').find(Boolean);
    return segment ? tokens.has(segment.toLowerCase()) : false;
  });
  return hinted.length > 0 && hinted.length < candidates.length ? hinted : candidates;
}

const callSiteLocations = (scouted: Scouted): vscode.Location[] =>
  scouted.endpoint.callSites.map(
    (site) =>
      new vscode.Location(
        vscode.Uri.file(join(scouted.root, site.file)),
        new vscode.Position(Math.max(0, site.line - 1), Math.max(0, site.column - 1)),
      ),
  );

/** Cmd/Ctrl+Click on an `operationId: '…'` line → jump to (or peek) its usages. */
class UsageDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location[] | undefined {
    if (!state) {
      void ensureIndex();
      return undefined;
    }
    const id = OPERATION_ID_LINE.exec(document.lineAt(position.line).text)?.[1];
    if (!id) return undefined;
    const endpoints = disambiguate(document, byOperationId().get(id) ?? []);
    const locations = endpoints.flatMap(callSiteLocations);
    return locations.length > 0 ? locations : undefined;
  }
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

    const index = byOperationId();
    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line += 1) {
      const id = OPERATION_ID_LINE.exec(document.lineAt(line).text)?.[1];
      if (!id || !index.has(id)) continue;
      const endpoints = disambiguate(document, index.get(id) ?? []);
      const range = new vscode.Range(line, 0, line, 0);
      // Usually one endpoint per id → a plain "⟶ N usages". When an id stays
      // ambiguous, one lens per endpoint, labelled by server to tell them apart.
      const multiple = endpoints.length > 1;
      for (const scouted of endpoints) {
        const count = scouted.endpoint.callSites.length;
        const suffix = count > 0 ? `${count} usage${count === 1 ? '' : 's'}` : 'no usages';
        const title = multiple
          ? `⟶ ${serverName(scouted.endpoint.operation)}: ${suffix}`
          : `⟶ ${suffix}`;
        lenses.push(
          new vscode.CodeLens(range, {
            title,
            command: 'routeScout.showCallSites',
            arguments: [scouted],
          }),
        );
      }
    }
    return lenses;
  }
}

// ---------------------------------------------------------------------------
// Tree view
// ---------------------------------------------------------------------------

type GroupBy = 'server' | 'tag' | 'method';
const GROUP_DIMENSIONS: GroupBy[] = ['server', 'tag', 'method'];

// `rest` is the remaining grouping dimensions to apply below this group, which
// is what makes grouping nest arbitrarily (e.g. server → tag → endpoints).
type GroupNode = {
  kind: 'group';
  label: string;
  icon: string;
  scouted: Scouted[];
  rest: GroupBy[];
};
type EndpointNode = { kind: 'endpoint'; scouted: Scouted };
type CallSiteNode = { kind: 'callsite'; root: string; file: string; line: number; preview: string };
type Node = GroupNode | EndpointNode | CallSiteNode;

/** The ordered grouping dimensions: workspace-state override, else the setting. */
function readGroupByDims(): GroupBy[] {
  const raw =
    groupState?.get<GroupBy[]>('groupBy') ??
    vscode.workspace.getConfiguration('routeScout').get<string | string[]>('groupBy');
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v): v is GroupBy =>
    GROUP_DIMENSIONS.includes(v as GroupBy),
  );
  return list.length > 0 ? list : ['server'];
}

/** Group labels a scouted endpoint belongs to (an operation can carry several tags). */
function groupLabelsFor(scouted: Scouted, dim: GroupBy): string[] {
  const op = scouted.endpoint.operation;
  if (dim === 'method') return [op.method.toUpperCase()];
  if (dim === 'tag') return op.tags.length > 0 ? op.tags : ['(untagged)'];
  return [serverName(op)];
}

const GROUP_ICON: Record<GroupBy, string> = {
  server: 'server',
  tag: 'tag',
  method: 'symbol-method',
};

/** Bucket endpoints by the first dimension; the remaining dims nest below each group. */
function buildGroups(scouted: Scouted[], dims: GroupBy[]): GroupNode[] {
  const [dim, ...rest] = dims;
  if (!dim) return [];
  const byLabel = new Map<string, Scouted[]>();
  for (const s of scouted) {
    for (const label of groupLabelsFor(s, dim)) {
      const list = byLabel.get(label) ?? [];
      list.push(s);
      byLabel.set(label, list);
    }
  }
  return [...byLabel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, children]) => ({
      kind: 'group',
      label,
      icon: GROUP_ICON[dim],
      scouted: children,
      rest,
    }));
}

class EndpointTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const scouted = await ensureIndex();
      return buildGroups(scouted, readGroupByDims());
    }
    if (element.kind === 'group') {
      return element.rest.length > 0
        ? buildGroups(element.scouted, element.rest)
        : element.scouted.map((scouted) => ({ kind: 'endpoint', scouted }));
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
    if (node.kind === 'group') {
      const used = node.scouted.filter((s) => s.endpoint.callSites.length > 0).length;
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${used}/${node.scouted.length} used`;
      item.iconPath = new vscode.ThemeIcon(node.icon);
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
        label: `${serverName(operation)}  ${operation.method.toUpperCase()} ${operation.path}`,
        description:
          callSites.length > 0 ? `$(references) ${callSites.length}` : '$(circle-slash) unused',
        detail: operation.operationId ?? undefined,
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

const GROUP_PRESETS: Array<{ label: string; dims: GroupBy[] }> = [
  { label: 'Server', dims: ['server'] },
  { label: 'Server → Tag', dims: ['server', 'tag'] },
  { label: 'Server → Method', dims: ['server', 'method'] },
  { label: 'Tag', dims: ['tag'] },
  { label: 'Tag → Method', dims: ['tag', 'method'] },
  { label: 'Method', dims: ['method'] },
];

async function setGroupBy(): Promise<void> {
  const current = readGroupByDims().join(' → ');
  type Item = vscode.QuickPickItem & { dims: GroupBy[] };
  const items: Item[] = GROUP_PRESETS.map((preset) => ({
    label: preset.label,
    description: preset.dims.join(' → '),
    dims: preset.dims,
    picked: preset.dims.join(',') === readGroupByDims().join(','),
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `Route Scout: group endpoints by… (current: ${current})`,
  });
  if (!picked) return;
  await groupState?.update('groupBy', picked.dims);
  refreshViews?.();
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

// Settings that change what gets indexed (vs. display-only settings like groupBy).
const REINDEX_KEYS = [
  'specs',
  'sources',
  'exclude',
  'usage',
  'ignoreImports',
  'ignoreLines',
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
  const codeLens = new UsageCodeLensProvider();
  const tree = new EndpointTreeProvider();

  const refreshAll = (): void => {
    codeLens.refresh();
    tree.refresh();
  };
  groupState = context.workspaceState;
  refreshViews = refreshAll;

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(PROVIDER_SELECTOR, codeLens),
    vscode.languages.registerDefinitionProvider(PROVIDER_SELECTOR, new UsageDefinitionProvider()),
    vscode.window.registerTreeDataProvider('routeScout.tree', tree),
    vscode.commands.registerCommand('routeScout.findEndpoint', () => findEndpoint()),
    vscode.commands.registerCommand('routeScout.showCallSites', (scouted: Scouted) =>
      showCallSites(scouted),
    ),
    vscode.commands.registerCommand('routeScout.setGroupBy', () => setGroupBy()),
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
