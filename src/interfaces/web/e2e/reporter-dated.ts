import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(HERE, "reports");

interface Row {
  file: string;
  title: string;
  status: TestResult["status"];
  ms: number;
  error?: string;
}

// Writes a timestamped Markdown report (e2e/reports/REPORT-<ISO>.md) plus a
// stable LATEST.md, so every run is dated and the most recent result is easy
// to find. The user asked for "todo dateado" — this is that ledger.
export default class DatedReporter implements Reporter {
  private rows: Row[] = [];
  private startedAt = new Date();

  onBegin(_config: FullConfig, _suite: Suite) {
    this.startedAt = new Date();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.rows.push({
      file: path.relative(HERE, test.location.file),
      title: test.titlePath().slice(1).join(" › "),
      status: result.status,
      ms: result.duration,
      error: result.error?.message?.split("\n")[0],
    });
  }

  onEnd(result: FullResult) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const finishedAt = new Date();
    const stamp = finishedAt.toISOString().replace(/[:.]/g, "-");
    const md = this.render(result, finishedAt);
    const dated = path.join(REPORTS_DIR, `REPORT-${stamp}.md`);
    fs.writeFileSync(dated, md);
    fs.writeFileSync(path.join(REPORTS_DIR, "LATEST.md"), md);
    // eslint-disable-next-line no-console
    console.log(`\n[e2e] dated report → ${path.relative(process.cwd(), dated)}`);
  }

  private render(result: FullResult, finishedAt: Date): string {
    const total = this.rows.length;
    const by = (s: string) => this.rows.filter((r) => r.status === s).length;
    const passed = by("passed");
    const failed = by("failed") + by("timedOut");
    const skipped = by("skipped");
    const durS = ((finishedAt.getTime() - this.startedAt.getTime()) / 1000).toFixed(1);

    const byFile = new Map<string, Row[]>();
    for (const r of this.rows) {
      if (!byFile.has(r.file)) byFile.set(r.file, []);
      byFile.get(r.file)!.push(r);
    }

    const lines: string[] = [];
    lines.push(`# APX Web — E2E report`);
    lines.push("");
    lines.push(`- **Run:** ${finishedAt.toISOString()}`);
    lines.push(`- **Result:** ${result.status.toUpperCase()}`);
    lines.push(`- **Duration:** ${durS}s`);
    lines.push(
      `- **Totals:** ${passed}/${total} passed · ${failed} failed · ${skipped} skipped`,
    );
    lines.push("");
    for (const [file, rows] of byFile) {
      lines.push(`## ${file}`);
      lines.push("");
      lines.push(`| Status | Test | ms |`);
      lines.push(`|---|---|---|`);
      for (const r of rows) {
        const icon =
          r.status === "passed" ? "✅" : r.status === "skipped" ? "⏭️" : "❌";
        lines.push(`| ${icon} ${r.status} | ${esc(r.title)} | ${Math.round(r.ms)} |`);
        if (r.error) lines.push(`| | ↳ \`${esc(r.error)}\` | |`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}
