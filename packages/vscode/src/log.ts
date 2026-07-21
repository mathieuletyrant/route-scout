import * as vscode from 'vscode';

// A single "Route Scout" output channel (a `LogOutputChannel`: timestamped,
// level-aware, filterable via "Developer: Set Log Level"). The whole extension
// logs through `log`; `initLog()` is called once on activation and the returned
// channel is disposed with the extension.

let channel: vscode.LogOutputChannel | undefined;

export function initLog(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel('Route Scout', { log: true });
  return channel;
}

export const log = {
  trace: (message: string, ...args: unknown[]): void => channel?.trace(message, ...args),
  debug: (message: string, ...args: unknown[]): void => channel?.debug(message, ...args),
  info: (message: string, ...args: unknown[]): void => channel?.info(message, ...args),
  warn: (message: string, ...args: unknown[]): void => channel?.warn(message, ...args),
  error: (error: string | Error, ...args: unknown[]): void => channel?.error(error, ...args),
  /** Reveal the channel in the Output panel (the `routeScout.showLogs` command). */
  show: (): void => channel?.show(),
};
