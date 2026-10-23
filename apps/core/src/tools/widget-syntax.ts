// Syntax-only check of a widget's inline scripts, so a typo is refused before the owner sees an empty widget.
import { spawn } from "node:child_process";
import vm from "node:vm";

// One pass, so a script inside a comment or a <template> is skipped and one containing "<!--" is not cut short.
const BLOCK = /<!--[\s\S]*?-->|<template\b[\s\S]*?<\/template\s*>|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
/** The whole check stays well under show_widget's 10s deadline: module scripts are checked at once. */
const BUDGET_MS = 3_000;
const MAX_MODULES = 8;

type Fail = { line: number; column: number; message: string };

/** Line and caret column of a V8 syntax error, from the "file:LINE / source / ^" header of its stack. */
function locate(stack: string): { line: number; column: number } {
  const [head = "", , caret = ""] = stack.split("\n");
  return { line: Number(head.slice(head.lastIndexOf(":") + 1)) || 1, column: Math.max(caret.indexOf("^"), 0) + 1 };
}

function checkClassic(src: string, lineOffset: number): Fail | null {
  try {
    new vm.Script(src, { filename: "widget.js", lineOffset }); // compiles only, never runs
    return null;
  } catch (e) {
    if (!(e instanceof SyntaxError)) return null;
    return { ...locate(e.stack ?? ""), message: e.message };
  }
}

// A child process parses a module without running it and off the event loop. See HISTORY.md#widget-module-check.
// It runs the core's own binary (under the desktop app that is Electron, which inherits ELECTRON_RUN_AS_NODE).
// Any failure to run the check (no binary, aborted, timed out) passes the script: the check never blocks a widget.
async function checkModule(src: string, lineOffset: number, signal: AbortSignal): Promise<Fail | null> {
  const r = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
    let stderr = "";
    try {
      const child = spawn(process.execPath, ["--check", "--input-type=module", "-"], { signal });
      child.stderr.setEncoding("utf8").on("data", (d: string) => {
        stderr += d;
      });
      child.on("error", () => resolve({ status: null, stderr }));
      child.on("close", (status) => resolve({ status, stderr }));
      child.stdin.on("error", () => {});
      child.stdin.end(src);
    } catch {
      resolve({ status: null, stderr });
    }
  });
  if (r.status !== 1) return null;
  const message = /^SyntaxError: (.*)$/m.exec(r.stderr)?.[1];
  if (!message) return null;
  const at = locate(r.stderr);
  return { ...at, line: at.line + lineOffset, message };
}

/**
 * The first inline script that does not parse, as a refusal for the agent naming the tool that was called; null when
 * all do (or there are none). `signal` ends any running check (the turn was stopped).
 */
export async function widgetScriptError(
  html: string,
  tool: "show_widget" | "edit_widget" | "file_write",
  signal?: AbortSignal,
): Promise<string | null> {
  const stop = AbortSignal.any([AbortSignal.timeout(BUDGET_MS), ...(signal ? [signal] : [])]);
  const checks: { startLine: number; startCol: number; fail: Fail | null | Promise<Fail | null> }[] = [];
  let line = 1;
  let counted = 0;
  let modules = 0;
  for (const m of html.matchAll(BLOCK)) {
    if (m[1] === undefined) continue; // a comment or a template
    const attrs = m[1];
    const src = m[2] ?? "";
    if (/(?:^|\s)src\s*=/i.test(attrs) || !src.trim()) continue;
    const type = /(?:^|\s)type\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
    if (!JS_TYPES.has(type)) continue;
    const bodyAt = (m.index ?? 0) + m[0].lastIndexOf("</") - src.length;
    for (let i = html.indexOf("\n", counted); i !== -1 && i < bodyAt; i = html.indexOf("\n", i + 1)) line++;
    counted = bodyAt;
    const startCol = bodyAt - html.lastIndexOf("\n", bodyAt - 1);
    if (type !== "module") checks.push({ startLine: line, startCol, fail: checkClassic(src, line - 1) });
    else if (modules++ < MAX_MODULES)
      checks.push({ startLine: line, startCol, fail: checkModule(src, line - 1, stop) });
  }
  for (const c of checks) {
    const fail = await c.fail;
    if (!fail) continue;
    const column = fail.line === c.startLine ? fail.column + c.startCol - 1 : fail.column;
    return `refused: the script at line ${fail.line} (column ${column}) of the widget does not parse: ${fail.message}. Fix it and call ${tool} again.`;
  }
  return null;
}
