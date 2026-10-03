// What APX's own processes take in memory, by what the owner can act on (the panel, a browser tab and its site, the
// GPU…), and a word when the whole goes past a limit. Pure: main.ts feeds it Electron's app.getAppMetrics().

/** Electron's process metric, the part used here (sizes in kilobytes). */
export type ProcessMetric = { pid: number; type: string; memory: { workingSetSize: number } };
export type ProcessKind = "main" | "gpu" | "panel" | "quick" | "tab" | "page" | "helper";
/** What a process is; a browser tab also says its site. Named in the owner's language by whoever shows it. */
export type ProcessOwner = { kind: ProcessKind; site?: string };
export type MemoryItem = { pid: number; kind: ProcessKind; site?: string; mb: number };
export type MemoryReport = { total_mb: number; items: MemoryItem[] };

const BY_TYPE: Record<string, ProcessKind> = { Browser: "main", GPU: "gpu", Tab: "page" };

/** Biggest first. */
export function memoryReport(
  metrics: readonly ProcessMetric[],
  owners: ReadonlyMap<number, ProcessOwner>,
): MemoryReport {
  const items = metrics
    .map((m) => ({
      pid: m.pid,
      ...(owners.get(m.pid) ?? { kind: BY_TYPE[m.type] ?? "helper" }),
      mb: Math.round(m.memory.workingSetSize / 1024),
    }))
    .sort((a, b) => b.mb - a.mb);
  return { total_mb: items.reduce((n, i) => n + i.mb, 0), items };
}

/** "6.2 GB" / "850 MB". */
export const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

/** The main process has no panel i18n: its few words, in the system's language. */
const TEXT = {
  en: {
    kinds: {
      main: "APX (main)",
      gpu: "GPU",
      panel: "Panel",
      quick: "Quick chat",
      tab: "Browser tab",
      page: "Page",
      helper: "Helper",
    } satisfies Record<ProcessKind, string>,
    warn: (total: string, top: string) => `APX is using ${total}; the most: ${top}.`,
  },
  es: {
    kinds: {
      main: "APX (principal)",
      gpu: "GPU",
      panel: "Panel",
      quick: "Chat rápido",
      tab: "Pestaña del navegador",
      page: "Página",
      helper: "Ayudante",
    } satisfies Record<ProcessKind, string>,
    warn: (total: string, top: string) => `APX está usando ${total}; el que más: ${top}.`,
  },
};
export type MemoryText = (typeof TEXT)["en"];
export const memoryText = (locale: string): MemoryText => (locale.startsWith("es") ? TEXT.es : TEXT.en);
export const itemName = (i: Pick<MemoryItem, "kind" | "site">, text: MemoryText) =>
  `${text.kinds[i.kind]}${i.site ? ` · ${i.site}` : ""}`;

/**
 * Past `limitMb`, says once (then not again for `quietMs`) how much APX takes and which process takes the most —
 * the clue to act on (close that tab, reload the panel) — with the whole list for the log.
 */
export function memoryWatch(o: {
  read(): MemoryReport;
  limitMb: number;
  quietMs: number;
  text: MemoryText;
  warn(message: string, report: MemoryReport): void;
  now?: () => number;
}) {
  let warnedAt = Number.NEGATIVE_INFINITY;
  const now = o.now ?? Date.now;
  return {
    check(): MemoryReport {
      const r = o.read();
      const top = r.items[0];
      if (top && r.total_mb >= o.limitMb && now() - warnedAt >= o.quietMs) {
        warnedAt = now();
        o.warn(o.text.warn(size(r.total_mb), `${itemName(top, o.text)} (${size(top.mb)})`), r);
      }
      return r;
    },
  };
}
