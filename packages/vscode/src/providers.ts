import { join, relative } from 'node:path';

import { serverName } from '@route-scout/core';
import * as vscode from 'vscode';

import { disambiguate, endpointIdentity, OPERATION_ID_LINE, type Scouted, toPosix } from './nav.js';
import { byOperationId, ensureIndex, getState, getSymbolNav } from './store.js';

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

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;
    matches.forEach(({ endpoint, root }, i) => {
      const op = endpoint.operation;
      const count = endpoint.callSites.length;
      if (i > 0) md.appendMarkdown('\n\n---\n\n');
      md.appendMarkdown(`**${op.method.toUpperCase()}** \`${op.path}\` — _${serverName(op)}_\n\n`);
      if (op.summary) md.appendMarkdown(`${op.summary}\n\n`);
      md.appendMarkdown(`$(references) ${count} usage${count === 1 ? '' : 's'}`);
      if (op.operationId) {
        const args = encodeURIComponent(
          JSON.stringify([root, op.operationId, op.specFile, [...endpointIdentity(op)]]),
        );
        md.appendMarkdown(
          `  ·  [$(go-to-file) Go to endpoint](command:routeScout.goToEndpoint?${args})`,
        );
      }
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
      const endpoints = disambiguateDoc(document, index.get(id) ?? []);
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
