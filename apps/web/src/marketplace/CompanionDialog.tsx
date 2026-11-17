import type { ExtensionInfo, Result } from "@apx/protocol";
import { pairingLink } from "@apx/protocol/client";
import { Button, Dialog, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { QrCode } from "../common/QrCode.tsx";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { ConnectHead, type LinkState } from "./ConnectHead.tsx";

// Pairing an extension's companion app (a TV, a phone, a computer): the app joined to APX by dots, how to install it,
// then its pairing. With APX: a one-time code and QR, done when a new device appears. With the extension: its own
// pairing tool gives the code to type in the app.

type Companion = NonNullable<ExtensionInfo["companion"]>;
type Pairing = Result<"devices.pair_start">;

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

export function CompanionDialog({ item, ext, onClose }: { item: Item; ext: ExtensionInfo; onClose(): void }) {
  const t = useT();
  const c = ext.companion as Companion;
  const [state, setState] = useState<LinkState>("idle");
  const [pairing, setPairing] = useState<Pairing>();
  const [code, setCode] = useState<string>();
  const [error, setError] = useState("");
  const [known, setKnown] = useState<Set<string>>();

  // Pairing with APX: done once a device APX did not know before shows up.
  useEffect(() => {
    if (!pairing || !known) return;
    const timer = setInterval(() => {
      void client.call("devices.list", {}).then((r) => {
        if (r.devices.some((d) => !known.has(d.id))) {
          setState("connected");
          setPairing(undefined);
        }
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [pairing, known]);
  // A code not used stops working when the dialog closes.
  useEffect(
    () => () => {
      if (pairing) void client.call("devices.pair_cancel", { code: pairing.code }).catch(() => {});
    },
    [pairing],
  );

  const start = async () => {
    setError("");
    setState("connecting");
    try {
      if (c.pairing.with === "apx") {
        setKnown(new Set((await client.call("devices.list", {})).devices.map((d) => d.id)));
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
      setState("broken");
      setError(t("mkt.pairFailed", { error: errText(e) }));
    }
  };

  return (
    <Dialog
      open
      size="sm"
      title={t("mkt.pairTitle", { name: c.name })}
      description={t("mkt.pairLead", { app: c.name })}
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && onClose()}
      footer={
        <Button variant={state === "connected" ? "primary" : "secondary"} onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="mkt-connect">
        <ConnectHead item={item} from="app" state={state} />
        <ol className="mkt-steps">
          <li>
            <b>{t("mkt.pairInstall")}</b>
            {c.steps.length > 0 && (
              <ul>
                {c.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
            <span className="mkt-steps__row">
              {c.file && (
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Icons.Download size={14} />}
                  onClick={() => void download(ext).catch((e) => setError(errText(e)))}
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
          </li>
          <li>
            <b>{t("mkt.pairCode")}</b>
            {state === "connected" ? (
              <p className="extpage__callout extpage__callout--ok">
                <Icons.Check size={16} /> {t("mkt.pairDone", { name: c.name })}
              </p>
            ) : pairing ? (
              <>
                <QrCode value={pairingLink(pairing)} label={t("mkt.pairScan")} size={180} />
                <span className="mkt-code">{pairing.code}</span>
                <p className="extpage__note">{t("mkt.pairWaiting")}</p>
              </>
            ) : code ? (
              <>
                <p className="extpage__note">{t("mkt.pairExtension")}</p>
                {(() => {
                  const r = readable(code);
                  return r.code ? (
                    <>
                      {r.address && <span className="mkt-code__address">{r.address}</span>}
                      <span className="mkt-code">{r.code}</span>
                    </>
                  ) : (
                    <pre className="mkt-code mkt-code--text">{r.text}</pre>
                  );
                })()}
              </>
            ) : !ext.enabled && c.pairing.with === "extension" ? (
              <p className="extpage__note">{t("mkt.pairNeedsOn")}</p>
            ) : (
              <div>
                <Button size="sm" loading={state === "connecting"} onClick={() => void start()}>
                  {t("mkt.pairGetCode")}
                </Button>
              </div>
            )}
            {error && <p className="install__error">{error}</p>}
          </li>
        </ol>
      </div>
    </Dialog>
  );
}
