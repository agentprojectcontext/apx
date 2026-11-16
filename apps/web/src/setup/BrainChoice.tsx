import { Badge, Button, EngineIcon, Icons, Spinner } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { PlanLogin } from "../config/PlanLogin.tsx";
import { ProvidersGrid } from "../config/ProvidersGrid.tsx";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { loadProviders, useProviders } from "../data/providers.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

/** The two ways in a simple setup offers: the ChatGPT plan (signed in as Codex) or an OpenRouter account. */
const WAYS: Array<{ id: "chatgpt" | "openrouter"; icon: string; title: MessageKey; body: MessageKey }> = [
  { id: "chatgpt", icon: "codex", title: "setup.brain.codex", body: "setup.brain.codexBody" },
  { id: "openrouter", icon: "openrouter", title: "setup.brain.openrouter", body: "setup.brain.openrouterBody" },
];
const POPUP_FEATURES = "popup,width=560,height=780";
/** How often the providers are read while OpenRouter's page is open elsewhere. */
const POLL_MS = 2000;

/**
 * One click per way in: ChatGPT opens its sign-in, OpenRouter its approval page; once either is connected the setup
 * goes on by itself. A model app already on this computer (Ollama) stays behind as the backup, unasked.
 */
export function BrainChoice({ onPicked }: { onPicked: () => void }) {
  const t = useT();
  const list = useProviders((s) => s.list);
  const [plan, setPlan] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [more, setMore] = useState(false);
  const on = (id: string) => list.some((p) => p.id === id && p.enabled && p.key_set);
  const local = list.find((p) => p.local && p.enabled && p.key_set);
  // Either way connecting (here or in its own tab) moves the setup on, once.
  const before = useRef<Set<string>>(undefined);
  useEffect(() => {
    const now = new Set(WAYS.filter((w) => on(w.id)).map((w) => w.id));
    if (before.current && [...now].some((id) => !before.current?.has(id))) {
      setPlan(false);
      setWaiting(false);
      onPicked();
    }
    before.current = now;
  });
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void loadProviders(), POLL_MS);
    // The sign-in window says so the moment it is done: no need to wait for the next read.
    const told = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "apx:oauth-done") void loadProviders();
    };
    window.addEventListener("message", told);
    return () => {
      clearInterval(id);
      window.removeEventListener("message", told);
    };
  }, [waiting]);

  const openRouter = async () => {
    // A window of its own beside the setup, opened on the click itself so a popup blocker lets it through; pointed
    // at OpenRouter once the core answers. The desktop app sends it to the system browser.
    const tab = window.apxDesktop ? null : window.open("about:blank", "apx-openrouter", POPUP_FEATURES);
    try {
      const { url } = await client.call("openrouter.connect", {
        callback: `${window.location.origin}/oauth/openrouter`,
      });
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      setWaiting(true);
    } catch (e) {
      tab?.close();
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="wiz__options is-two">
        {WAYS.map((w) => {
          const connected = on(w.id);
          return (
            // ui: a choice card like the setup's others (wiz__option), not a button's look.
            <button
              key={w.id}
              type="button"
              className={`wiz__option wiz__way${connected ? " is-on" : ""}`}
              onClick={() => (w.id === "chatgpt" ? setPlan(true) : void openRouter())}
            >
              <span className="wiz__choicetitle">
                <EngineIcon engine={w.icon} size={20} />
                {t(w.title)}
                {connected && (
                  <Badge tone="brand" dot>
                    {t("setup.channels.connected")}
                  </Badge>
                )}
              </span>
              <span className="wiz__choicebody">{t(w.body)}</span>
              {w.id === "openrouter" && waiting && !connected && (
                <span className="wiz__hintline">
                  <Spinner size={12} /> {t("setup.brain.waiting")}
                </span>
              )}
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
      {more && <ProvidersGrid compact />}
      {plan && <PlanLogin onClose={() => setPlan(false)} />}
    </>
  );
}
