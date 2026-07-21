import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  DEFAULT_EXCLUDE,
  DEFAULT_SOURCES,
  DEFAULT_SPECS,
  DEFAULT_USAGE,
  serverName,
} from '@route-scout/core';
import * as vscode from 'vscode';

import { log } from './log.js';
import {
  type DeclLoc,
  endpointIdentity,
  OPERATION_ID_LINE,
  pickDeclaration,
  type Scouted,
} from './nav.js';
import {
  ensureIndex,
  getDeclarationNav,
  getGroupState,
  getSymbolNav,
  invalidate,
  refreshViews,
} from './store.js';
import { GROUP_PRESETS, type GroupBy, readGroupByDims } from './tree.js';

export async function openCallSite(root: string, file: string, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(root, file)));
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/** Reverse navigation: open the spec and reveal the operation's `operationId` line. */
async function openSpec(root: string, specFile: string, operationId: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(root, specFile)));
  let line = 0;
  for (let i = 0; i < document.lineCount; i += 1) {
    if (OPERATION_ID_LINE.exec(document.lineAt(i).text)?.[1] === operationId) {
      line = i;
      break;
    }
  }
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/** Ask which declaration to open when several match the endpoint equally well. */
async function promptDeclaration(decls: DeclLoc[]): Promise<DeclLoc | undefined> {
  type Item = vscode.QuickPickItem & { decl: DeclLoc };
  const picked = await vscode.window.showQuickPick<Item>(
    decls.map((decl) => ({
      label: `$(go-to-file) ${basename(decl.file)}`,
      description: dirname(decl.file),
      decl,
    })),
    {
      title: 'Route Scout: go to endpoint',
      placeHolder: 'Several files declare this operationId — pick one…',
    },
  );
  return picked?.decl;
}

/**
 * Jump to the endpoint's declaration (a `definitions` file, e.g. a controller)
 * if known, else its spec. `identity` is the chosen endpoint's channel/server
 * tokens (see `endpointIdentity`) — it's what routes the right controller when
 * several declare the same operationId. When no single one wins, ask rather than
 * jumping to an arbitrary one.
 */
export async function goToEndpoint(
  root: string,
  operationId: string,
  specFile: string,
  identity: string[],
): Promise<void> {
  const decls = getDeclarationNav()?.get(operationId) ?? [];
  const choice = pickDeclaration(decls, new Set(identity));
  log.debug(
    `goToEndpoint ${operationId} [${identity.join(', ')}] — ${decls.length} declaration(s); ` +
      (choice.best
        ? `→ ${choice.best.file}`
        : choice.ambiguous
          ? `ambiguous, prompting (${choice.ranked.map((d) => d.file).join(', ')})`
          : '→ spec'),
  );
  const decl =
    choice.best ?? (choice.ambiguous ? await promptDeclaration(choice.ranked) : undefined);
  if (decl) {
    await openCallSite(decl.root, decl.file, decl.line);
    return;
  }
  // Ambiguous + dismissed picker: don't silently jump somewhere the user rejected.
  if (choice.ambiguous) return;
  await openSpec(root, specFile, operationId);
}

/** From a call site (symbol at the cursor) → jump to that endpoint's definition (or spec). */
export async function revealEndpoint(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  await ensureIndex();

  const range = editor.document.getWordRangeAtPosition(editor.selection.active);
  const word = range && editor.document.getText(range);
  const matches = word ? getSymbolNav()?.get(word) : undefined;
  if (!matches || matches.length === 0) {
    void vscode.window.showInformationMessage(
      'Route Scout: no endpoint matches the symbol at the cursor.',
    );
    return;
  }

  type Item = vscode.QuickPickItem & { scouted: Scouted };
  const target =
    matches.length === 1
      ? matches[0]
      : (
          await vscode.window.showQuickPick<Item>(
            matches.map((scouted) => ({
              label: `${scouted.endpoint.operation.method.toUpperCase()} ${scouted.endpoint.operation.path}`,
              description: serverName(scouted.endpoint.operation),
              scouted,
            })),
            { title: 'Route Scout: go to endpoint' },
          )
        )?.scouted;

  if (!target) return;
  const op = target.endpoint.operation;
  if (op.operationId) {
    await goToEndpoint(target.root, op.operationId, op.specFile, [...endpointIdentity(op)]);
  }
}

export async function showCallSites(scouted: Scouted): Promise<void> {
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

export async function findEndpoint(): Promise<void> {
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

export async function setGroupBy(): Promise<void> {
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
  await getGroupState()?.update('groupBy', picked.dims);
  refreshViews();
}

/** Scaffold a `routescout.config.json` at the workspace root and open it. */
export async function initConfig(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Route Scout: open a folder first.');
    return;
  }
  const target = vscode.Uri.file(join(folder.uri.fsPath, 'routescout.config.json'));
  if (existsSync(target.fsPath)) {
    void vscode.window.showInformationMessage('routescout.config.json already exists.');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
    return;
  }

  const found = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '**/*{openapi,swagger}*.{json,yaml,yml}'),
    '**/node_modules/**',
    20,
  );
  const config = {
    $schema:
      'https://raw.githubusercontent.com/mathieuletyrant/route-scout/refs/heads/main/schema.json',
    specs: DEFAULT_SPECS,
    sources: DEFAULT_SOURCES,
    exclude: [...DEFAULT_EXCLUDE, '**/__generated__/**', '**/*-client/**', '**/*.generated.ts'],
    usage: DEFAULT_USAGE,
  };
  await vscode.workspace.fs.writeFile(
    target,
    Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8'),
  );
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));

  const message =
    found.length > 0
      ? `Created routescout.config.json — found ${found.length} spec file(s).`
      : 'Created routescout.config.json — no specs detected yet, adjust `specs`.';
  const pick = await vscode.window.showInformationMessage(message, 'Use as config file');
  if (pick === 'Use as config file') {
    try {
      await vscode.workspace
        .getConfiguration('routeScout', folder.uri)
        .update('configFile', 'routescout.config.json', vscode.ConfigurationTarget.WorkspaceFolder);
      invalidate();
      refreshViews();
    } catch (error) {
      void vscode.window.showWarningMessage(
        `Route Scout: set "routeScout.configFile" manually — ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
