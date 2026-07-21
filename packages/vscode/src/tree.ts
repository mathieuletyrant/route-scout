import { basename, dirname } from 'node:path';

import { serverName } from '@route-scout/core';
import * as vscode from 'vscode';

import type { Scouted } from './nav.js';
import { ensureIndex, getGroupState } from './store.js';

export type GroupBy = 'server' | 'tag' | 'method';
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
export function readGroupByDims(): GroupBy[] {
  const raw =
    getGroupState()?.get<GroupBy[]>('groupBy') ??
    vscode.workspace.getConfiguration('routeScout').get<string | string[]>('groupBy');
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v): v is GroupBy =>
    GROUP_DIMENSIONS.includes(v as GroupBy),
  );
  return list.length > 0 ? list : ['server'];
}

export const GROUP_PRESETS: Array<{ label: string; dims: GroupBy[] }> = [
  { label: 'Server', dims: ['server'] },
  { label: 'Server → Tag', dims: ['server', 'tag'] },
  { label: 'Server → Method', dims: ['server', 'method'] },
  { label: 'Tag', dims: ['tag'] },
  { label: 'Tag → Method', dims: ['tag', 'method'] },
  { label: 'Method', dims: ['method'] },
];

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

export class EndpointTreeProvider implements vscode.TreeDataProvider<Node> {
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
