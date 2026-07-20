const ESC = String.fromCharCode(27);

const enabled =
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const wrap =
  (open: number, close: number) =>
  (text: string): string =>
    enabled ? `${ESC}[${open}m${text}${ESC}[${close}m` : text;

export const colors = {
  enabled,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};
