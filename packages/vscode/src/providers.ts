import { join, relative } from 'node:path';

import { serverName } from '@route-scout/core';
import * as vscode from 'vscode';

import { disambiguate, endpointIdentity, OPERATION_ID_LINE, type Scouted, toPosix } from './nav.js';
import { byOperationId, ensureIndex, getState, getSymbolNav, hasClients } from './store.js';

/** Adapt {@link disambiguate} to a live editor document (see `nav.ts`). */
function disambiguateDoc(document: vscode.TextDocument, candidates: Scouted[]): Scouted[] {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const rel = folder ? toPosix(relative(folder.uri.fsPath, document.uri.fsPath)) : undefined;
  return disambiguate(document.uri.fsPath, rel, candidates);
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
export class UsageDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location[] | undefined {
    if (!getState()) {
      void ensureIndex();
      return undefined;
    }
    const id = OPERATION_ID_LINE.exec(document.lineAt(position.line).text)?.[1];
    if (!id) return undefined;
    const endpoints = disambiguateDoc(document, byOperationId().get(id) ?? []);
    const locations = endpoints.flatMap(callSiteLocations);
    return locations.length > 0 ? locations : undefined;
  }
}

/**
 * Are these same-operationId endpoints impossible to tell apart from a call
 * site? Without `clients`, nothing attributes usages, so any collision is
 * ambiguous. With `clients`, usages are attributed by spec — so only a
 * duplicate operationId **within one spec** (e.g. api + internal channels in
 * the same document) stays ambiguous.
 */
function ambiguous(endpoints: Scouted[]): boolean {
  if (endpoints.length <= 1) return false;
  if (!hasClients()) return true;
  const perSpec = new Map<string, number>();
  for (const { endpoint } of endpoints) {
    const spec = endpoint.operation.specFile;
    perSpec.set(spec, (perSpec.get(spec) ?? 0) + 1);
  }
  return [...perSpec.values()].some((n) => n > 1);
}

/** Hover on a usage (a hook / operationId / client call) → endpoint + link to its spec. */
export class EndpointHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const symbolNav = getSymbolNav();
    if (!symbolNav) {
      void ensureIndex();
      return undefined;
    }
    const range = document.getWordRangeAtPosition(position);
    if (!range) return undefined;
    const matches = symbolNav.get(document.getText(range));
    if (!matches || matches.length === 0) return undefined;

    // Show the count once as "shared" only when it genuinely can't be split:
    // an operationId collision that `clients` can't attribute (see `ambiguous`).
    const shared = ambiguous(matches);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;
    if (shared) {
      const count = matches[0]!.endpoint.callSites.length;
      const id = matches[0]!.endpoint.operation.operationId;
      md.appendMarkdown(
        `$(references) **${count} usage${count === 1 ? '' : 's'}** shared across ${matches.length} ` +
          `endpoints${id ? ` with operationId \`${id}\`` : ''} — not attributable individually\n\n`,
      );
    }
    matches.forEach(({ endpoint, root }, i) => {
      const op = endpoint.operation;
      const count = endpoint.callSites.length;
      if (i > 0) md.appendMarkdown('\n\n---\n\n');
      md.appendMarkdown(`**${op.method.toUpperCase()}** \`${op.path}\` — _${serverName(op)}_\n\n`);
      if (op.summary) md.appendMarkdown(`${op.summary}\n\n`);
      const parts: string[] = [];
      if (!shared) parts.push(`$(references) ${count} usage${count === 1 ? '' : 's'}`);
      if (op.operationId) {
        const args = encodeURIComponent(
          JSON.stringify([root, op.operationId, op.specFile, [...endpointIdentity(op)]]),
        );
        parts.push(`[$(go-to-file) Go to endpoint](command:routeScout.goToEndpoint?${args})`);
      }
      if (parts.length > 0) md.appendMarkdown(parts.join('  ·  '));
    });
    return new vscode.Hover(md, range);
  }
}

export class UsageCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!getState()) {
      void ensureIndex().then(() => this.refresh());
      return [];
    }

    const index = byOperationId();
    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line += 1) {
      const id = OPERATION_ID_LINE.exec(document.lineAt(line).text)?.[1];
      if (!id || !index.has(id)) continue;
      const group = index.get(id) ?? [];
      const endpoints = disambiguateDoc(document, group);
      const range = new vscode.Range(line, 0, line, 0);
      // Usually one endpoint per id → a plain "⟶ N usages". When an id stays
      // ambiguous, one lens per endpoint, labelled by server to tell them apart.
      const multiple = endpoints.length > 1;
      // Flag "(shared)" only for a collision `clients` can't attribute — i.e. the
      // same operationId duplicated within one spec (see `ambiguous`).
      const shared = ambiguous(group);
      for (const scouted of endpoints) {
        const count = scouted.endpoint.callSites.length;
        const usages = count > 0 ? `${count} usage${count === 1 ? '' : 's'}` : 'no usages';
        const suffix = shared && count > 0 ? `${usages} (shared)` : usages;
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
