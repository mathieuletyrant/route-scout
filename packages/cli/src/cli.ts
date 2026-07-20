#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  buildIndex,
  type EndpointUsage,
  type RouteScoutConfig,
  type UsageMatcher,
} from '@route-scout/core';
import { colors } from './colors.js';
import { loadConfigFile } from './load-config.js';
import { type Format, renderJson, renderMarkdown, renderTable } from './render.js';

const HELP = `route-scout — find where each OpenAPI endpoint is used

Usage:
  route-scout [options]

Discovery:
  --config <path>        Config file (default: routescout.config.{json,js,mjs} if present)
  --root <dir>           Base directory for all globs (default: cwd)
  --specs <glob>         OpenAPI spec glob (repeatable)
  --sources <glob>       Source file glob to scan (repeatable)
  --exclude <glob>       Glob to exclude (repeatable)

Usage matchers (override config defaults):
  --usage-symbol <tpl>   Symbol matcher template, e.g. "use{OperationId}" (repeatable)
  --usage-regex <tpl>    Regex matcher template, e.g. "fetch\\('{path}'" (repeatable)

Filters:
  --spec <text>          Only endpoints whose spec file contains <text>
  --method <m>           Only this HTTP method (repeatable)
  --tag <tag>            Only endpoints with this tag (repeatable)
  --unused-only          Only endpoints with zero call sites
  --used-only            Only endpoints with at least one call site

Output:
  --format <fmt>         table | json | md   (default: table)
  --out <path>           Write to a file instead of stdout
  -h, --help             Show this help
  -v, --version          Show version

Placeholders: {operationId} {OperationId} {operationId:camel|pascal|kebab|snake|constant}
              {method} {METHOD} {path} {pathRegex}
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      root: { type: 'string' },
      specs: { type: 'string', multiple: true },
      sources: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      'usage-symbol': { type: 'string', multiple: true },
      'usage-regex': { type: 'string', multiple: true },
      spec: { type: 'string' },
      method: { type: 'string', multiple: true },
      tag: { type: 'string', multiple: true },
      'unused-only': { type: 'boolean' },
      'used-only': { type: 'boolean' },
      format: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${await version()}\n`);
    return 0;
  }

  const cwd = process.cwd();
  const { config: fileConfig, from } = await loadConfigFile(cwd, values.config);
  const config = mergeConfig(fileConfig, values);

  const isFileOutput = Boolean(values.out);
  if (from && !isFileOutput) process.stderr.write(colors.dim(`Using config ${from}\n`));

  const result = await buildIndex(config, {
    onProgress: isFileOutput ? undefined : progress(),
  });
  clearProgress(isFileOutput);

  const endpoints = applyFilters(result.endpoints, values);
  const format = parseFormat(values.format);
  const rendered =
    format === 'json'
      ? renderJson(endpoints)
      : format === 'md'
        ? renderMarkdown(result, endpoints)
        : renderTable(result, endpoints);

  if (values.out) {
    await writeFile(values.out, `${rendered}\n`);
    process.stderr.write(`Wrote ${endpoints.length} endpoints to ${values.out}\n`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
  return 0;
}

type Values = Record<string, string | string[] | boolean | undefined>;

function mergeConfig(fileConfig: RouteScoutConfig, values: Values): RouteScoutConfig {
  const usage: UsageMatcher[] = [
    ...((values['usage-symbol'] as string[] | undefined)?.map(
      (template): UsageMatcher => ({ kind: 'symbol', template }),
    ) ?? []),
    ...((values['usage-regex'] as string[] | undefined)?.map(
      (template): UsageMatcher => ({ kind: 'regex', template }),
    ) ?? []),
  ];

  return {
    ...fileConfig,
    root: (values.root as string | undefined) ?? fileConfig.root,
    specs: (values.specs as string[] | undefined) ?? fileConfig.specs,
    sources: (values.sources as string[] | undefined) ?? fileConfig.sources,
    exclude: (values.exclude as string[] | undefined) ?? fileConfig.exclude,
    usage: usage.length > 0 ? usage : fileConfig.usage,
  };
}

function applyFilters(endpoints: EndpointUsage[], values: Values): EndpointUsage[] {
  const specFilter = values.spec as string | undefined;
  const methods = (values.method as string[] | undefined)?.map((m) => m.toLowerCase());
  const tags = values.tag as string[] | undefined;

  return endpoints.filter(({ operation, callSites }) => {
    if (specFilter && !operation.specFile.includes(specFilter)) return false;
    if (methods && !methods.includes(operation.method)) return false;
    if (tags && !tags.some((t) => operation.tags.includes(t))) return false;
    if (values['unused-only'] && callSites.length > 0) return false;
    if (values['used-only'] && callSites.length === 0) return false;
    return true;
  });
}

function parseFormat(value: string | undefined): Format {
  if (value === 'json' || value === 'md' || value === 'table') return value;
  if (value) throw new Error(`route-scout: unknown --format "${value}" (use table|json|md)`);
  return 'table';
}

let lastProgressLen = 0;
function progress(): (done: number, total: number) => void {
  if (!process.stderr.isTTY) return () => {};
  return (done, total) => {
    const msg = `Scanning ${done}/${total} source files…`;
    lastProgressLen = msg.length;
    process.stderr.write(`\r${msg}`);
  };
}
function clearProgress(isFileOutput: boolean): void {
  if (!isFileOutput && process.stderr.isTTY && lastProgressLen > 0) {
    process.stderr.write(`\r${' '.repeat(lastProgressLen)}\r`);
  }
}

async function version(): Promise<string> {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `${colors.red('error')} ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  },
);
