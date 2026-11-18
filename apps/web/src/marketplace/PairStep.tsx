import type { ExtensionInfo, Result } from "@apx/protocol";
import { pairingLink } from "@apx/protocol/client";
import { Button, Icons, SummaryItem } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode } from "../common/QrCode.tsx";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

// Pairing an extension's app on another device (a TV, a phone, a computer), inside the add box: how to get the app,
// then the code. With APX: a one-time code and QR, done when a new device appears. With the extension: its own
// pairing tool gives the code to type in the app.

type Pairing = Result<"devices.pair_start">;
export type PairState = "idle" | "waiting" | "paired" | "failed";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The text an MCP tool answered (its text parts). */
const textOf = (r: Result<"mcp.call">) =>
  (r.content ?? [])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");

/** A tool's answer as the owner reads it: its code and address when it gives them (as JSON), else its text. */
function readable(text: string): { code?: string; address?: string; text?: string } {
  try {
    const v = JSON.parse(text) as { code?: unknown; address?: unknown };
    if (v && typeof v.code === "string")
      return { code: v.code, ...(typeof v.address === "string" ? { address: v.address } : {}) };
  } catch {}
  return { text };
}

async function download(ext: ExtensionInfo): Promise<void> {
  const f = await client.call("extensions.companion_file", { id: ext.id });
  const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Starts and follows a pairing; `start` needs the extension on when it pairs through its own tool. */
export function usePairing(ext: ExtensionInfo | undefined) {
  const [state, setState] = useState<PairState>("idle");
  const [pairing, setPairing] = useState<Pairing>();
  const [code, setCode] = useState<string>();
  const [error, setError] = useState("");
  const known = useRef<Set<string>>(undefined);

  // Pairing with APX: done once a device APX did not know before shows up.
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => {
      void client.call("devices.list", {}).then((r) => {
        if (known.current && r.devices.some((d) => !known.current?.has(d.id))) {
          setState("paired");
          setPairing(undefined);
        }
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [pairing]);
  // A code not used stops working when the box closes.
  useEffect(
    () => () => {
      if (pairing) void client.call("devices.pair_cancel", { code: pairing.code }).catch(() => {});
    },
    [pairing],
  );

  const start = useCallback(async () => {
    const c = ext?.companion;
    if (!ext || !c) return;
    setError("");
    setState("waiting");
    try {
      if (c.pairing.with === "apx") {
        known.current = new Set((await client.call("devices.list", {})).devices.map((d) => d.id));
        setPairing(await client.call("devices.pair_start", {}));
      } else {
        const r = await client.call("mcp.call", {
          scope: "global",
          server: `${ext.id}-${c.pairing.server}`,
          tool: c.pairing.tool,
          arguments: {},
        });
        if (r.isError) throw new Error(textOf(r) || "error");
        setCode(textOf(r));
      }
    } catch (e) {
      setState("failed");
      setError(errText(e));
    }
  }, [ext]);

  /** The owner typed the extension's code in the app: APX cannot see that, so they say it. */
  const confirm = useCallback(() => setState("paired"), []);
  return { state, pairing, code, error, start, confirm };
}

/** How to get the app, then the code to type or scan while APX waits for it. */
export function PairBody({ ext, pair }: { ext: ExtensionInfo; pair: ReturnType<typeof usePairing> }) {
  const t = useT();
  const c = ext.companion;
  const [failed, setFailed] = useState("");
  if (!c) return null;
  const typed = pair.code ? readable(pair.code) : undefined;
  return (
    <div className="mkt-pair">
      <SummaryItem icon={<span className="mkt-pair__n">1</span>} title={t("box.pairInstall", { app: c.name })}>
        {c.steps.length > 0 && c.steps.join(" ")}
        <span className="mkt-pair__get">
          {c.file && (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.Download size={14} />}
              onClick={() => void download(ext).catch((e) => setFailed(errText(e)))}
            >
              {t("mkt.pairDownload", { file: c.file.split("/").at(-1) ?? c.file })}
            </Button>
          )}
          {c.url && (
            <a href={c.url} target="_blank" rel="noreferrer">
              {t("mkt.pairGet")} <Icons.ExternalLink size={12} />
            </a>
          )}
        </span>
      </SummaryItem>
      <SummaryItem icon={<span className="mkt-pair__n">2</span>} title={t("box.pairCode")}>
        {t("box.pairSameNetwork")}
      </SummaryItem>
      {pair.pairing && (
        <div className="mkt-pair__code">
          <QrCode value={pairingLink(pair.pairing)} label={t("mkt.pairScan")} size={120} />
          <div>
            <span className="mkt-code">{pair.pairing.code}</span>
            <span className="mkt-pair__wait">{t("box.pairWaiting")}</span>
          </div>
        </div>
      )}
      {typed && (
        <div className="mkt-pair__code">
          <div>
            {typed.address && <span className="mkt-code__address">{typed.address}</span>}
            {typed.code ? (
              <span className="mkt-code">{typed.code}</span>
            ) : (
              <pre className="mkt-code mkt-code--text">{typed.text}</pre>
            )}
          </div>
        </div>
      )}
      {failed && <p className="install__error">{failed}</p>}
    </div>
  );
}
