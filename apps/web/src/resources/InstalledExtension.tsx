import type { ExtensionInfo } from "@apx/protocol";
import { Badge, Button, Checkbox, Dialog, Icons, Input } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { DEFAULT_PID, secretary } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { scheduleText } from "../routines/scheduleText.ts";
import { go } from "../shell/nav.ts";
import { usePowerText } from "./ExtensionSummary.tsx";
import { ExtensionTest } from "./ExtensionTest.tsx";
import { openExtensionInstall } from "./extensionInstall.ts";
import type { Item } from "./extensionItems.ts";

// What the owner does with an installed extension, on its page: turn it on (approving exactly what it brings), give it
// its keys, update it or go back a version, turn it off or uninstall it; and below, the routines it suggests.

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs a call; a failure is said, never thrown into the screen. */
export async function attempt<R>(fn: () => Promise<R>, t: ReturnType<typeof useT>): Promise<R | undefined> {
  try {
    return await fn();
  } catch (e) {
    notify(t("error.extensions", { error: errText(e) }));
    return undefined;
  }
}

/** Where it came from, to read it again: a folder by its path, an address by downloading it; a file cannot be. */
const readAgain = (source: string) =>
  source.startsWith("https://")
    ? { url: source }
    : /^(~|\/|[A-Za-z]:[\\/])/.test(source)
      ? { path: source }
      : undefined;

/** The side panel of an installed extension's page. */
export function InstalledSide({
  item,
  onChanged,
  onConnect,
}: {
  item: Item & { ext: ExtensionInfo };
  onChanged(): Promise<void>;
  /** Opens the dialog that connects its account (its keys). */
  onConnect(): void;
}) {
  const t = useT();
  const power = usePowerText();
  const e = item.ext;
  const [editing, setEditing] = useState(false);
  const [ok, setOk] = useState({ hosts: false, keys: false, files: false });
  const run = async (fn: () => Promise<unknown>) => {
    await attempt(fn, t);
    await onChanged();
  };
  const missing = e.secrets.filter((s) => !s.set);
  const again = readAgain(e.source);
  return (
    <>
      {item.update && item.url && (
        <>
          <p className="extpage__callout extpage__callout--info">
            <Icons.Info size={16} /> {t("extx.updateCallout", { version: item.update })}
          </p>
          <Button onClick={() => openExtensionInstall({ url: item.url })}>{t("extx.seeUpdate")}</Button>
        </>
      )}
      {!e.enabled ? (
        <>
          {e.update && e.update.adds.length > 0 && (
            <div className="extupdate">
              <p className="pform__hint">{t("ext.updateAdds", { version: e.version, from: e.update.from })}</p>
              <ul>
                {e.update.adds.map((p) => (
                  <li key={`${p.kind}${p.name}`}>{power(p)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="extpage__approve">
            <b>{t("extx.approveTitle")}</b>
            <Checkbox
              checked={ok.hosts}
              onCheckedChange={(v) => setOk((o) => ({ ...o, hosts: v === true }))}
              label={
                e.hosts.length
                  ? t("extx.approve.hosts", { hosts: e.hosts.join(", ") })
                  : e.runs_code
                    ? t("extx.approve.anyHost")
                    : t("extx.approve.noHosts")
              }
            />
            <Checkbox
              checked={ok.keys}
              onCheckedChange={(v) => setOk((o) => ({ ...o, keys: v === true }))}
              label={
                e.secrets.length
                  ? t("extx.approve.keys", { keys: e.secrets.map((s) => s.label).join(", ") })
                  : t("extx.approve.noKeys")
              }
            />
            <Checkbox
              checked={ok.files}
              onCheckedChange={(v) => setOk((o) => ({ ...o, files: v === true }))}
              label={t("extx.approve.files", { version: e.version })}
            />
            {e.runs_code && (
              <p className="pform__hint">
                <Icons.TriangleAlert size={12} /> {t("ext.runsCode")}
              </p>
            )}
          </div>
          <Button
            leadingIcon={<Icons.Power size={14} />}
            disabled={!(ok.hosts && ok.keys && ok.files)}
            onClick={() => void run(() => client.call("extensions.enable", { id: e.id, enabled: true }))}
          >
            {t("extx.turnOn")}
          </Button>
        </>
      ) : (
        <>
          {item.attention ? (
            <p className="extpage__callout extpage__callout--warn">
              <Icons.TriangleAlert size={16} /> {t(`extx.fix.${item.attention}`)}
            </p>
          ) : (
            <p className="extpage__callout extpage__callout--ok">
              <Icons.Check size={16} /> {t("extx.onNote")}
            </p>
          )}
          {missing.length > 0 && <Button onClick={onConnect}>{t("mkt.connectAction")}</Button>}
          <Button
            variant="secondary"
            leadingIcon={<Icons.Power size={14} />}
            onClick={() => void run(() => client.call("extensions.enable", { id: e.id, enabled: false }))}
          >
            {t("extx.turnOff")}
          </Button>
        </>
      )}
      <div className="extpage__row">
        {e.update && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.RotateCcw size={14} />}
            onClick={() => void run(() => client.call("extensions.rollback", { id: e.id }))}
          >
            {t("ext.rollback", { version: e.update.from })}
          </Button>
        )}
        <Button size="sm" variant="ghost" leadingIcon={<Icons.Pencil size={14} />} onClick={() => setEditing(true)}>
          {t("res.edit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Icons.Trash2 size={14} />}
          onClick={() => void run(() => client.call("extensions.remove", { id: e.id }))}
        >
          {t("extx.uninstall")}
        </Button>
      </div>
      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(false)}
          title={t("res.editMcp", { name: e.name })}
          footer={
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("common.close")}
            </Button>
          }
        >
          <div className="pform">
            {e.secrets.length > 0 && <span className="pform__label">{t("ext.secrets")}</span>}
            {e.secrets.map((s) => (
              <SecretRow
                key={s.name}
                label={s.label}
                set={s.set}
                url={s.url}
                onSave={(value) => run(() => client.call("extensions.set_secret", { id: e.id, name: s.name, value }))}
              />
            ))}
            {again && (
              <>
                <span className="pform__label">{t("url" in again ? "ext.redownload" : "ext.reload")}</span>
                <p className="pform__hint">
                  {"url" in again
                    ? t("ext.redownloadHint", { url: e.source })
                    : t("ext.reloadHint", { folder: e.source })}
                </p>
                <div>
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Icons.RefreshCw size={14} />}
                    onClick={() => void run(() => client.call("extensions.install", again))}
                  >
                    {t("url" in again ? "ext.redownload" : "ext.reloadButton")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Below its page: the routines it suggests and, for a plugin that adds context, a way to try it. */
export function InstalledExtras({ e }: { e: ExtensionInfo }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const addRoutine = async (r: ExtensionInfo["routines"][number]) => {
    const agent = secretary(agents)?.id;
    if (!agent) return;
    // Added off: the owner reviews it in Routines before it runs on its own.
    const saved = await attempt(
      () =>
        client.call("routines.set", { name: r.name, agent, schedule: r.schedule, prompt: r.prompt, enabled: false }),
      t,
    );
    if (saved) {
      notify(t("ext.routineAdded", { name: r.name }), "info");
      void loadRoutines();
    }
  };
  return (
    <>
      {e.routines.length > 0 && <ExtensionRoutines e={e} onAdd={addRoutine} />}
      <ExtensionTest e={e} />
    </>
  );
}

/** A secret the extension needs: typed once, never shown again. */
function SecretRow(props: {
  label: string;
  set: boolean;
  url?: string | undefined;
  onSave: (value: string | null) => Promise<void>;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <div className="tgtoken">
      <Input
        type="password"
        autoComplete="off"
        aria-label={props.label}
        placeholder={props.set ? t("ext.secretSet", { label: props.label }) : props.label}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
      {props.set && !value ? (
        <>
          <Badge tone="brand" dot>
            {t("ext.saved")}
          </Badge>
          <Button size="sm" variant="secondary" onClick={() => void props.onSave(null)}>
            {t("ext.clear")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          disabled={!value}
          onClick={() =>
            void props.onSave(value).then(() => {
              setValue("");
            })
          }
        >
          {t("common.save")}
        </Button>
      )}
      {props.url && (
        <a className="pform__hint" href={props.url} target="_blank" rel="noreferrer">
          {t("ext.getIt")}
        </a>
      )}
    </div>
  );
}

/**
 * The routines an extension suggests: what each one would do and when. None runs by itself: added, it waits in
 * Routines (Default project) turned off until the owner turns it on; once there, this says so and opens it.
 */
function ExtensionRoutines({
  e,
  onAdd,
}: {
  e: ExtensionInfo;
  onAdd(r: ExtensionInfo["routines"][number]): Promise<void>;
}) {
  const t = useT();
  const routines = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  useEffect(() => {
    if (!ready) void loadRoutines();
  }, [ready]);
  return (
    <div className="extroutines">
      <span className="pform__label">{t("ext.routinesTitle")}</span>
      <p className="pform__hint">{t("ext.routinesLead")}</p>
      {e.routines.map((r) => {
        const there = routines.find((x) => x.name === r.name && !x.project_id);
        return (
          <div key={r.name} className="extroutine">
            <Icons.Clock size={14} className="extroutine__icon" />
            <div className="extroutine__main">
              <div className="extroutine__name">
                {r.name} <span className="extroutine__when">· {scheduleText(r.schedule, t)}</span>
              </div>
              <div className="extroutine__prompt">{r.prompt.split("\n").find((l) => l.trim()) ?? ""}</div>
            </div>
            {there ? (
              <>
                <Badge tone={there.enabled ? "brand" : "neutral"} dot>
                  {there.enabled ? t("ext.routineOn") : t("ext.routineOff")}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => go.project(DEFAULT_PID, "routines")}>
                  {t("ext.routineOpen")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Plus size={14} />}
                onClick={() => void onAdd(r)}
              >
                {t("ext.addRoutine")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
