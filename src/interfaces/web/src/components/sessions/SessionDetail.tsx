import { useEffect, useState } from "react";
import useSWR from "swr";
import { Bot, Copy, FolderOpen, Terminal as TerminalIcon, TriangleAlert, X } from "lucide-react";
import { Sessions, Deck, type SessionRow } from "../../lib/api";
import { Badge, Button, Empty, Loading, Tip } from "../ui";
import { useToast } from "../Toast";
import { usePersonaName } from "../../hooks/usePersonaName";
import { SessionTerminal } from "./SessionTerminal";
import { t } from "../../i18n";

const ENGINE_TONE: Record<string, "success" | "info" | "warning" | "muted"> = {
  apx: "success", claude: "info", codex: "warning", opencode: "info",
};

/**
 * The right-hand pane: what this session was, and the two ways to continue it.
 *
 * The command is shown, not just executed. Opening the terminal here is the
 * quick path, but the same session often wants a real terminal — a second
 * window, a different machine, a tmux pane — so the line stays visible and
 * copyable rather than hidden behind the button that runs it.
 */
export function SessionDetail({
  row,
  onAskPersona,
}: {
  row: SessionRow;
  onAskPersona: (s: SessionRow) => void;
}) {
  const toast = useToast();
  const persona = usePersonaName();
  const [termOpen, setTermOpen] = useState(false);

  const detail = useSWR(
    `/api/sessions/${row.id}?engine=${row.engine}`,
    () => Sessions.detail(row.id, row.engine),
  );

  // Switching sessions closes the terminal: leaving it open would keep showing
  // the previous session's CLI under the new session's heading.
  useEffect(() => { setTermOpen(false); }, [row.id, row.engine]);

  const d = detail.data;
  const cwd = d?.cwd || row.cwd || null;
  const command = d?.resume_command || null;

  const copy = async (text: string, ok: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(ok); }
    catch { toast.error(t("base.sessions_copy_failed")); }
  };

  const openFolder = async () => {
    if (!cwd) { toast.error(t("base.sessions_no_folder")); return; }
    try { await Deck.exec({ kind: "open_path", target: cwd }); }
    catch (e) { toast.error(t("base.sessions_folder_failed", { msg: (e as Error).message })); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <Badge tone={ENGINE_TONE[row.engine] || "muted"}>{row.engine}</Badge>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{d?.title || row.title || row.id}</div>
          <div className="truncate font-mono text-[10px] text-muted-fg">{row.id}</div>
        </div>
        {termOpen && (
          <Tip content={t("base.sessions_term_close")}>
            <Button size="sm" variant="ghost" aria-label={t("base.sessions_term_close")} onClick={() => setTermOpen(false)}>
              <X size={14} />
            </Button>
          </Tip>
        )}
      </div>

      {/* Actions. "Continue" leads: it is why this pane is open. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Button size="sm" variant="primary" disabled={!command} onClick={() => setTermOpen(true)}>
          <TerminalIcon size={13} /> {t("base.sessions_act_open_terminal")}
        </Button>
        <Button size="sm" variant="secondary" disabled={!command} onClick={() => copy(command!, t("base.sessions_cmd_copied"))}>
          <Copy size={13} /> {t("base.sessions_act_cmd")}
        </Button>
        <Button size="sm" variant="ghost" disabled={!cwd} onClick={openFolder}>
          <FolderOpen size={13} /> {t("base.sessions_act_folder")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAskPersona(row)}>
          <Bot size={13} /> {t("base.sessions_act_ask", { name: persona })}
        </Button>
      </div>

      {termOpen && command ? (
        <div className="relative min-h-0 flex-1 p-2">
          <SessionTerminal engine={row.engine} id={row.id} className="relative h-full w-full" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
          {detail.isLoading && <Loading />}
          {detail.error && <Empty icon={TriangleAlert}>{t("base.sessions_error", { msg: (detail.error as Error).message })}</Empty>}

          {command && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-fg">
                {t("base.sessions_detail_command")}
              </div>
              <button
                type="button"
                onClick={() => copy(command, t("base.sessions_cmd_copied"))}
                title={t("base.sessions_act_cmd")}
                className="w-full truncate rounded-md border border-border bg-muted/40 px-2 py-1.5 text-left font-mono text-[11px] hover:bg-muted"
              >
                {command}
              </button>
            </div>
          )}

          {cwd && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-fg">
                {t("base.sessions_detail_folder")}
              </div>
              <div className="break-all font-mono text-[11px] text-muted-fg">{cwd}</div>
            </div>
          )}

          {d?.mtime ? (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-fg">
                {t("base.sessions_detail_updated")}
              </div>
              <div className="text-[12px] text-muted-fg">{new Date(d.mtime).toLocaleString()}</div>
            </div>
          ) : null}

          {d?.last_prompt && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-fg">
                {t("base.sessions_detail_last_prompt")}
              </div>
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[12px]">
                {d.last_prompt}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
