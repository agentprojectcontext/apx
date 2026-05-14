// Terminal UI utilities — ANSI colors, output helpers.
// Adapted from opencode_ref/packages/opencode/src/cli/ui.ts

import { createInterface } from "node:readline";

export const Style = {
  TEXT_HIGHLIGHT: "\x1b[96m",
  TEXT_DIM: "\x1b[90m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_WARNING: "\x1b[93m",
  TEXT_DANGER: "\x1b[91m",
  TEXT_SUCCESS: "\x1b[92m",
  TEXT_INFO: "\x1b[94m",
  TEXT_BOLD: "\x1b[1m",
  TEXT_BOLD_END: "\x1b[22m",
} as const;

let _lastEmpty = false;

export function println(...parts: string[]): void {
  _lastEmpty = false;
  process.stderr.write(parts.join(" ") + "\n");
}

export function print(...parts: string[]): void {
  _lastEmpty = false;
  process.stderr.write(parts.join(" "));
}

export function empty(): void {
  if (_lastEmpty) return;
  _lastEmpty = true;
  process.stderr.write("\n");
}

export function error(message: string): void {
  println(Style.TEXT_DANGER + "✖ " + Style.TEXT_NORMAL + message);
}

export function success(message: string): void {
  println(Style.TEXT_SUCCESS + "✔ " + Style.TEXT_NORMAL + message);
}

export function info(message: string): void {
  println(Style.TEXT_INFO + "ℹ " + Style.TEXT_NORMAL + message);
}

export function warn(message: string): void {
  println(Style.TEXT_WARNING + "⚠ " + Style.TEXT_NORMAL + message);
}

export function dim(message: string): string {
  return Style.TEXT_DIM + message + Style.TEXT_NORMAL;
}

export function highlight(message: string): string {
  return Style.TEXT_HIGHLIGHT + message + Style.TEXT_NORMAL;
}

export function bold(message: string): string {
  return Style.TEXT_BOLD + message + Style.TEXT_BOLD_END;
}

export async function input(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<string>((resolve) => {
    rl.question(Style.TEXT_HIGHLIGHT + prompt + Style.TEXT_NORMAL + " ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function logo(): void {
  if (!process.stdout.isTTY) {
    println(bold("APX"));
    return;
  }
  println(
    Style.TEXT_DIM +
    "  ██████╗ ██████╗ ██╗  ██╗\n" +
    Style.TEXT_INFO +
    "  ██╔══██╗██╔══██╗╚██╗██╔╝\n" +
    Style.TEXT_HIGHLIGHT +
    "  ███████║██████╔╝ ╚███╔╝ \n" +
    "  ██╔══██║██╔═══╝  ██╔██╗ \n" +
    Style.TEXT_NORMAL +
    "  ██║  ██║██║     ██╔╝ ██╗\n" +
    "  ╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝" +
    Style.TEXT_NORMAL,
  );
}

export function table(
  rows: Array<Record<string, string>>,
  cols: string[],
): void {
  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => (r[col] ?? "").length)),
  );
  const header = cols.map((col, i) => bold(col.padEnd(widths[i]!))).join("  ");
  println(header);
  println(dim("─".repeat(widths.reduce((a, b) => a + b + 2, -2))));
  for (const row of rows) {
    println(cols.map((col, i) => (row[col] ?? "").padEnd(widths[i]!)).join("  "));
  }
}
