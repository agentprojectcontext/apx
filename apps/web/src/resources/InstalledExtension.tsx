import type { ExtensionInfo } from "@apx/protocol";
import { Badge, Button, Icons, Input } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { DEFAULT_PID, secretary } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { scheduleText } from "../routines/scheduleText.ts";
import { go } from "../shell/nav.ts";

// Pieces of an installed extension's page: its keys and reading its files again (in its settings), and the routines
// it suggests, each added off.

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

/** Its keys (typed once, never shown again) and, for one from a folder or an address, reading its files again. */
export function ExtensionKeys({ e, onChanged }: { e: ExtensionInfo; onChanged(): Promise<void> }) {
  const t = useT();
  const run = async (fn: () => Promise<unknown>) => {
    await attempt(fn, t);
    await onChanged();
  };
  const again = readAgain(e.source);
  if (!e.secrets.length && !again) return null;
  return (
    <>
      {e.secrets.length > 0 && (
        <section className="mkt-settings__sec">
          <span className="pform__label">{t("ext.secrets")}</span>
          {e.secrets.map((s) => (
            <SecretRow
              key={s.name}
              label={s.label}
              set={s.set}
              url={s.url}
              onSave={(value) => run(() => client.call("extensions.set_secret", { id: e.id, name: s.name, value }))}
            />
          ))}
        </section>
      )}
      {again && (
        <section className="mkt-settings__sec">
          <span className="pform__label">{t("url" in again ? "ext.redownload" : "ext.reload")}</span>
          <p className="pform__hint mkt-settings__hint">
            {"url" in again ? t("ext.redownloadHint", { url: e.source }) : t("ext.reloadHint", { folder: e.source })}
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
        </section>
      )}
    </>
  );
}

/** Adds one of its routines to the Default project, off: the owner turns it on in Routines. */
export function useAddRoutine(): (r: ExtensionInfo["routines"][number]) => Promise<void> {
  const t = useT();
  const agents = useData((s) => s.agents);
  return async (r) => {
    const agent = secretary(agents)?.id;
    if (!agent) return;
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
export function ExtensionRoutines({
  e,
  onAdd,
  bare = false,
}: {
  e: ExtensionInfo;
  onAdd(r: ExtensionInfo["routines"][number]): Promise<void>;
  /** Without its title and line (inside a row that already names it). */
  bare?: boolean;
}) {
  const t = useT();
  const routines = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  useEffect(() => {
    if (!ready) void loadRoutines();
  }, [ready]);
  return (
    <div className="extroutines">
      {!bare && <span className="pform__label">{t("ext.routinesTitle")}</span>}
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
