import type { Routine } from "@apx/protocol";
import { Button, SettingRow, Skeleton, Switch, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

/** Team news: one switch per relay routine (one, unless the owner made more), each with its instructions. `onLeave`: closes what it is shown in before opening a chat. */
export function TeamNews({ onLeave }: { onLeave(): void }) {
  const strings = usePack("secretary");
  const routines = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  useEffect(() => {
    void loadRoutines();
  }, []);
  if (!strings || !ready) return <Skeleton height={80} />;
  const news = routines.filter((r) => r.action === "relay");
  return news.length ? (
    news.map((r) => <Capability key={r.id} routine={r} named={news.length > 1} onLeave={onLeave} />)
  ) : (
    <Capability onLeave={onLeave} />
  );
}

/** `named`: its routine's name shows, to tell several apart. */
function Capability({ routine, named, onLeave }: { routine?: Routine; named?: boolean; onLeave(): void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const title = t("routines.action.relay");
  const save = async (enabled: boolean, text?: string) => {
    setBusy(true);
    setError("");
    try {
      await client.call("secretary.set", {
        action: "relay",
        id: routine?.id,
        enabled,
        ...(text === undefined ? {} : { prompt: text }),
      });
      await loadRoutines();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <SettingRow title={title} description={t("routines.action.relayHint")}>
        <Switch
          aria-label={title}
          checked={routine?.enabled ?? false}
          disabled={busy}
          onCheckedChange={(enabled) => void save(enabled)}
        />
      </SettingRow>
      {routine && (
        <div className="tgtoken">
          {named && <span className="pform__hint">{routine.name}</span>}
          {routine.last && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onLeave();
                go.inboxThread(routine.last?.thread_id ?? "home");
              }}
            >
              {t("super.lastCheck")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPrompt(routine.prompt);
              setEditing(!editing);
            }}
          >
            {t("super.customize")}
          </Button>
        </div>
      )}
      {editing && (
        <>
          <Textarea
            aria-label={t("super.instructions")}
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
          />
          <Button
            size="sm"
            disabled={busy || !prompt.trim()}
            onClick={() => void save(routine?.enabled ?? false, prompt)}
          >
            {t("common.save")}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
