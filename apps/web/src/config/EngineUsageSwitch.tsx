import { Button, Icons, Switch, Tooltip } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { usePack, useT } from "../i18n/index.ts";

/** Quota visibility is independent of whether this engine can run models. */
export function EngineUsageSwitch({ engine }: { engine: string }) {
  const [generation, setGeneration] = useState(0);
  const loaded = usePack("usage");
  return loaded ? (
    <UsageControl key={`${engine}:${generation}`} engine={engine} onRetry={() => setGeneration((n) => n + 1)} />
  ) : null;
}

function UsageControl({ engine, onRetry }: { engine: string; onRetry: () => void }) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = engine === "acp:opencode" ? "opencode" : engine;
  useEffect(() => {
    let active = true;
    void client.call("engines.usage_preferences", {}).then(
      (prefs) => {
        if (active) {
          setEnabled(prefs.engines[id] === true);
          setReady(true);
        }
      },
      () => {
        if (active) {
          setFailed(true);
          notify(t("engines.usageLoadError"));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [id, t]);
  const save = async (on: boolean) => {
    setSaving(true);
    try {
      const prefs = await client.call("engines.set_usage", { engine: id, enabled: on });
      setEnabled(prefs.engines[id] === true);
    } catch {
      notify(t("engines.usageSaveError"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Tooltip
      content={
        <span className="engine-usage-hint">
          {t(engine === "codex" ? "engines.usageCodexHint" : "engines.usageHint")}
        </span>
      }
    >
      <span className="engine-usage-switch">
        {!failed ? (
          <Switch
            size="sm"
            checked={enabled}
            disabled={saving || !ready}
            label={
              <>
                <Icons.Zap size={14} />
                <span className="sr-only">{t("engines.showUsage")}</span>
              </>
            }
            onCheckedChange={(on) => void save(on)}
          />
        ) : (
          <Button size="sm" variant="ghost" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        )}
      </span>
    </Tooltip>
  );
}
