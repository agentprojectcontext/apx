import type { Result, Routine } from "@apx/protocol";
import { Button, SettingRow, Skeleton, Switch, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SubHead } from "./SectionHead.tsx";

export function SecretaryCapabilities() {
  const strings = usePack("secretary");
  const t = useT();
  const routines = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  const [gmail, setGmail] = useState<Result<"integrations.list">["integrations"][number]>();
  useEffect(() => {
    let live = true;
    void loadRoutines();
    void client
      .call("integrations.list", {})
      .then((r) => {
        if (live) setGmail(r.integrations.find((i) => i.id === "gmail"));
      })
      .catch(() => {
        /* Connection availability remains unknown; the core still enforces readability. */
      });
    return () => {
      live = false;
    };
  }, []);
  if (!strings) return <Skeleton height={80} />;
  return (
    <>
      <SubHead>{t("super.capabilities")}</SubHead>
      <p className="config__lead">{t("super.capabilitiesHint")}</p>
      {gmail && (
        <p className="pform__hint">
          {t(gmail.connected && gmail.oauth?.client === "own" ? "super.mailConnected" : "super.mailWaiting")}
        </p>
      )}
      {!ready ? (
        <Skeleton height={80} />
      ) : (
        (["relay", "mail"] as const).map((action) => {
          const entries = routines.filter((r) => r.action === action);
          return entries.length ? (
            entries.map((r) => <Capability key={r.id} action={action} routine={r} />)
          ) : (
            <Capability key={action} action={action} />
          );
        })
      )}
    </>
  );
}

function Capability({ action, routine }: { action: "relay" | "mail"; routine?: Routine }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const title = t(action === "relay" ? "routines.action.relay" : "routines.action.mail");
  const save = async (enabled: boolean, text?: string) => {
    setBusy(true);
    setError("");
    try {
      await client.call("secretary.set", {
        action,
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
      <SettingRow
        title={title}
        description={t(action === "relay" ? "routines.action.relayHint" : "super.mailAvailability")}
      >
        <Switch
          aria-label={title}
          checked={routine?.enabled ?? false}
          disabled={busy}
          onCheckedChange={(enabled) => void save(enabled)}
        />
      </SettingRow>
      {routine && (
        <div className="tgtoken">
          <span className="pform__hint">{routine.name}</span>
          {routine.last && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                go.config(null);
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
      {action === "mail" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            go.config(null);
            go.resources("integrations");
          }}
        >
          {t("super.connectMail")}
        </Button>
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
