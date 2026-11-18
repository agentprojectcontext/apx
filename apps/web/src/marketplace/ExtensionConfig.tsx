import type { ExtensionInfo } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, Select, Switch } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { attempt } from "../resources/InstalledExtension.tsx";

// An extension's own settings page (manifest 2): a form built from its settings, and its pages, each opened in a
// sandboxed frame that may read and set only its own settings through a small bridge.

type Value = string | number | boolean;
type Setting = ExtensionInfo["settings"][number];

/** One setting's field: a switch, a choice or text (a sensitive one as a password). */
export function SettingField({
  s,
  value,
  onChange,
}: {
  s: Setting;
  value: Value | undefined;
  onChange(v: Value): void;
}) {
  const t = useT();
  if (s.type === "boolean")
    return (
      <Field label={s.label} hint={s.description}>
        {() => <Switch aria-label={s.label} checked={value === true} onCheckedChange={(v) => onChange(v)} />}
      </Field>
    );
  if (s.options)
    return (
      <Field label={s.label} hint={s.description}>
        {() => (
          <Select
            label={s.label}
            value={String(value ?? "")}
            onValueChange={(v) => onChange(String(v))}
            options={s.options?.map((o) => ({ value: o, label: o })) ?? []}
          />
        )}
      </Field>
    );
  return (
    <Field label={s.label} hint={s.description}>
      {(id) => (
        <Input
          id={id}
          type={s.sensitive ? "password" : s.type === "number" ? "number" : "text"}
          autoComplete="off"
          placeholder={s.sensitive && s.set ? t("int.keepSecret") : s.type === "directory" ? "~/…" : ""}
          value={value === undefined ? "" : String(value)}
          onChange={({ currentTarget: { value: v } }) => onChange(v)}
        />
      )}
    </Field>
  );
}

/** A page of the extension in a frame with no origin of its own and no network; it talks only through `apx`. */
function PageDialog({ e, page, onClose }: { e: ExtensionInfo; page: { id: string; title: string }; onClose(): void }) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string>();
  useEffect(() => {
    void attempt(() => client.call("extensions.page", { id: e.id, page: page.id }), t).then((r) => setHtml(r?.html));
  }, [e.id, page.id, t]);
  useEffect(() => {
    const listen = async (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow) return;
      const m = ev.data as { apx?: number; call?: string; args?: Record<string, unknown> };
      if (typeof m?.apx !== "number" || typeof m.call !== "string") return;
      const reply = (result: unknown, error?: string) =>
        frame.current?.contentWindow?.postMessage({ apx: m.apx, result, ...(error ? { error } : {}) }, "*");
      try {
        if (m.call === "settings.get")
          return reply(Object.fromEntries(e.settings.filter((s) => !s.sensitive).map((s) => [s.name, s.value])));
        if (m.call === "secrets.has") return reply(e.settings.find((s) => s.name === m.args?.name)?.set ?? false);
        if (m.call === "settings.set" || m.call === "secrets.set") {
          const values = (m.call === "secrets.set" ? { [String(m.args?.name)]: m.args?.value } : m.args) as Record<
            string,
            Value | null
          >;
          await client.call("extensions.settings", { id: e.id, values });
          return reply(true);
        }
        if (m.call === "close") return onClose();
        reply(undefined, "unknown call");
      } catch (err) {
        reply(undefined, err instanceof Error ? err.message : String(err));
      }
    };
    const handler = (ev: MessageEvent) => void listen(ev);
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [e, onClose]);
  // Its own script and styles only; no network, no other origin.
  const doc =
    html &&
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"><script>(function(){var n=0,w={};addEventListener("message",function(e){var m=e.data;if(m&&w[m.apx]){w[m.apx](m);delete w[m.apx];}});function call(c,a){return new Promise(function(ok,no){var id=++n;w[id]=function(m){m.error?no(new Error(m.error)):ok(m.result)};parent.postMessage({apx:id,call:c,args:a},"*")})}window.apx={settings:{get:function(){return call("settings.get")},set:function(v){return call("settings.set",v)}},secrets:{has:function(n){return call("secrets.has",{name:n})},set:function(n,v){return call("secrets.set",{name:n,value:v})}},close:function(){return call("close")}};})();</script>${html}`;
  return (
    <Dialog open size="lg" title={page.title} closeLabel={t("common.close")} onOpenChange={(o) => !o && onClose()}>
      {doc && (
        <iframe
          ref={frame}
          className="mkt-pageframe"
          title={page.title}
          sandbox="allow-scripts allow-forms"
          srcDoc={doc}
        />
      )}
    </Dialog>
  );
}

export function ExtensionConfig({ e, onChanged }: { e: ExtensionInfo; onChanged(): Promise<void> }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, Value>>({});
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<{ id: string; title: string }>();
  if (!e.settings.length && !e.pages.length) return null;
  const save = async () => {
    setBusy(true);
    const ok = await attempt(() => client.call("extensions.settings", { id: e.id, values }), t);
    setBusy(false);
    if (!ok) return;
    setValues({});
    notify(t("mkt.settingsSaved"), "info");
    await onChanged();
  };
  return (
    <section className="extpage__sec mkt-config">
      <h4>{t("mkt.settings")}</h4>
      {e.settings.map((s) => (
        <SettingField
          key={s.name}
          s={s}
          value={values[s.name] ?? (s.sensitive ? undefined : s.value)}
          onChange={(v) => setValues((x) => ({ ...x, [s.name]: v }))}
        />
      ))}
      {e.settings.length > 0 && (
        <div>
          <Button size="sm" disabled={!Object.keys(values).length} loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      )}
      {e.pages.map((p) => (
        <div key={p.id}>
          <Button size="sm" variant="secondary" leadingIcon={<Icons.PanelRight size={14} />} onClick={() => setPage(p)}>
            {t("mkt.openPage", { title: p.title })}
          </Button>
        </div>
      ))}
      {page && <PageDialog e={e} page={page} onClose={() => setPage(undefined)} />}
    </section>
  );
}
