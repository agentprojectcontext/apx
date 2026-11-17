import { Badge, Button, EngineIcon, Icons, Spinner } from "@apx/ui";
import { useEffect, useState } from "react";
import { PlanLogin } from "../config/PlanLogin.tsx";
import { ProvidersGrid } from "../config/ProvidersGrid.tsx";
import { useOpenRouterConnect } from "../data/openrouter.ts";
import { loadProviders, useProviders } from "../data/providers.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

/** The two ways in a simple setup offers: the ChatGPT plan or an OpenRouter account. */
const WAYS: Array<{ id: "chatgpt" | "openrouter"; icon: string; title: MessageKey; body: MessageKey }> = [
  { id: "chatgpt", icon: "codex", title: "setup.brain.codex", body: "setup.brain.codexBody" },
  { id: "openrouter", icon: "openrouter", title: "setup.brain.openrouter", body: "setup.brain.openrouterBody" },
];

/**
 * Two cards, each saying where it stands; a click connects it: ChatGPT opens its sign-in here, OpenRouter its approval in a
 * window of its own. Connecting does not move on by itself: the owner may connect both. A model app already on this
 * computer (Ollama) stays behind as the backup, unasked.
 */
export function BrainChoice() {
  const t = useT();
  const list = useProviders((s) => s.list);
  const [plan, setPlan] = useState(false);
  const [more, setMore] = useState(false);
  const on = (id: string) => list.some((p) => p.id === id && p.enabled && p.key_set);
  const local = list.find((p) => p.local && p.enabled && p.key_set);
  const openRouterOn = on("openrouter");
  // What is connected already (a model app on this computer, a sign-in from before) shows from the start.
  useEffect(() => {
    void loadProviders();
  }, []);
  const { waiting, connect: openRouter } = useOpenRouterConnect(openRouterOn);

  return (
    <>
      <div className="wiz__options is-two">
        {WAYS.map((w) => {
          const connected = on(w.id);
          const pending = !connected && (w.id === "openrouter" ? waiting : plan);
          return (
            // ui: the whole card connects, like the setup's other choice cards (wiz__option).
            <button
              key={w.id}
              type="button"
              className={`wiz__option wiz__way${connected ? " is-on" : ""}`}
              onClick={() => (w.id === "chatgpt" ? setPlan(true) : openRouter())}
            >
              <span className="wiz__choicetitle">
                <EngineIcon engine={w.icon} size={20} />
                {t(w.title)}
                <Badge tone={connected ? "brand" : pending ? "info" : "neutral"} dot={!pending}>
                  {pending && <Spinner size={10} />}
                  {t(
                    connected ? "setup.channels.connected" : pending ? "setup.brain.connecting" : "plans.notConnected",
                  )}
                </Badge>
              </span>
              <span className="wiz__choicebody">{t(w.body)}</span>
            </button>
          );
        })}
      </div>
      {local && <p className="wiz__hintline">{t("setup.brain.local", { name: local.label })}</p>}
      <div>
        <Button
          variant="ghost"
          size="sm"
          trailingIcon={more ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
          onClick={() => setMore((m) => !m)}
        >
          {t(more ? "setup.brain.less" : "setup.brain.more")}
        </Button>
      </div>
      {more && <ProvidersGrid compact onlyReady />}
      {plan && <PlanLogin onClose={() => setPlan(false)} />}
    </>
  );
}
