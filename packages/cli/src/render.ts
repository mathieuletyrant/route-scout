import type { EndpointUsage, HttpMethod, IndexResult } from '@route-scout/core';

import { colors } from './colors.js';

export type Format = 'table' | 'json' | 'md';

const methodColor: Record<HttpMethod, (s: string) => string> = {
  get: colors.green,
  post: colors.yellow,
  put: colors.blue,
  patch: colors.blue,
  delete: colors.red,
  head: colors.gray,
  options: colors.gray,
  trace: colors.gray,
};

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length);

export function renderJson(endpoints: EndpointUsage[]): string {
  return JSON.stringify(endpoints, null, 2);
}

export function renderTable(result: IndexResult, endpoints: EndpointUsage[]): string {
  const lines: string[] = [];
  const bySpec = groupBy(endpoints, (e) => e.operation.specFile);

  for (const [specFile, group] of bySpec) {
    lines.push(colors.bold(specFile));
    const methodWidth = Math.max(...group.map((e) => e.operation.method.length), 6);
    for (const { operation, callSites } of group) {
      const method = methodColor[operation.method](
        pad(operation.method.toUpperCase(), methodWidth),
      );
      const count = callSites.length;
      const badge =
        count > 0
          ? colors.cyan(`${count} call site${count === 1 ? '' : 's'}`)
          : colors.gray('unused');
      const id = operation.operationId ? colors.dim(`  ${operation.operationId}`) : '';
      lines.push(`  ${method}  ${pad(operation.path, 40)}  ${badge}${id}`);
    }
    lines.push('');
  }

  lines.push(summary(result, endpoints));
  return lines.join('\n');
}

export function renderMarkdown(result: IndexResult, endpoints: EndpointUsage[]): string {
  const lines: string[] = ['# Endpoint usage report', ''];
  const used = endpoints.filter((e) => e.callSites.length > 0);
  const unused = endpoints.filter((e) => e.callSites.length === 0);

  lines.push(
    `Specs: ${result.stats.specFiles} · Operations: ${endpoints.length} · ` +
      `Used: ${used.length} · Unused: ${unused.length} · ` +
      `Source files scanned: ${result.stats.sourceFiles}`,
    '',
  );

  for (const [specFile, group] of groupBy(used, (e) => e.operation.specFile)) {
    lines.push(`## ${specFile}`, '');
    for (const { operation, callSites } of group) {
      const id = operation.operationId ? ` \`${operation.operationId}\`` : '';
      lines.push(
        `### ${operation.method.toUpperCase()} ${operation.path}${id} — ${callSites.length} call site(s)`,
        '',
      );
      for (const site of callSites) lines.push(`- \`${site.file}:${site.line}\``);
      lines.push('');
    }
  }

  if (unused.length > 0) {
    lines.push('## Unused endpoints', '');
    for (const { operation } of unused) {
      const id = operation.operationId ? ` \`${operation.operationId}\`` : '';
      lines.push(
        `- ${operation.method.toUpperCase()} ${operation.path}${id} — \`${operation.specFile}\``,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function summary(result: IndexResult, endpoints: EndpointUsage[]): string {
  const used = endpoints.filter((e) => e.callSites.length > 0).length;
  const unused = endpoints.length - used;
  return colors.dim(
    `${endpoints.length} operations · ${colors.green(`${used} used`)} · ` +
      `${colors.gray(`${unused} unused`)} · ${result.stats.sourceFiles} source files scanned`,
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
