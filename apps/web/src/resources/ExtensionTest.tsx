import type { ExtensionInfo } from "@apx/protocol";
import { Button, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

type Outcome = { ok: boolean; text: string };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Test" for an extension that is on: its plugin asked for context on a sample text, as a turn would, and each of
 * its MCP servers started apart to list its tools.
 */
export function ExtensionTest({ e }: { e: ExtensionInfo }) {
  const t = useT();
  const [sample, setSample] = useState(t("ext.test.sample"));
  const [busy, setBusy] = useState<string>();
  const [out, setOut] = useState<Record<string, Outcome>>({});
  if (!e.enabled || (!e.plugin?.context && !e.mcp.length)) return null;
  const run = async (key: string, fn: () => Promise<Outcome>) => {
    setBusy(key);
    let o: Outcome;
    try {
      o = await fn();
    } catch (err) {
      o = { ok: false, text: errText(err) };
    }
    setBusy(undefined);
    setOut((cur) => ({ ...cur, [key]: o }));
  };
  const plugin = () =>
    run("plugin", async () => {
      const r = await client.call("extensions.test", { id: e.id, text: sample });
      return r.ok
        ? { ok: true, text: `${t("ext.test.took", { ms: r.ms })}\n${r.context ?? ""}` }
        : { ok: false, text: r.error ?? "" };
    });
  const server = (name: string) =>
    run(name, async () => {
      const r = await client.call("mcp.test", { scope: "global", server: name });
      return r.ok
        ? { ok: true, text: t("res.connected", { n: r.tools.length, ms: r.ms }) }
        : { ok: false, text: r.error ?? "" };
    });

  return (
    <div className="exttest">
      <div className="pform__label">{t("ext.test")}</div>
      {e.plugin?.context && (
        <>
          <div className="tgtoken">
            <Input
              aria-label={t("ext.test.sampleLabel")}
              value={sample}
              onChange={(ev) => setSample(ev.currentTarget.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.FlaskConical size={14} />}
              loading={busy === "plugin"}
              disabled={!sample.trim()}
              onClick={() => void plugin()}
            >
              {t("ext.test.context")}
            </Button>
          </div>
          <Result o={out.plugin} />
        </>
      )}
      {e.mcp.map((name) => (
        <div key={name}>
          <div className="tgtoken">
            <Icons.Plug size={14} />
            <span className="res__name">{name}</span>
            <span className="pcard__spacer" />
            <Button size="sm" variant="secondary" loading={busy === name} onClick={() => void server(name)}>
              {t("ext.test.server")}
            </Button>
          </div>
          <Result o={out[name]} />
        </div>
      ))}
    </div>
  );
}

function Result({ o }: { o: Outcome | undefined }) {
  if (!o) return null;
  return <pre className={o.ok ? "exttest__out" : "exttest__out is-error"}>{o.text}</pre>;
}
