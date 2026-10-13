import type { LocalEmbedding, ServiceInfo } from "@apx/protocol";
import { Badge, Button, Icons, Spinner } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { ServiceDialog } from "../config/ServiceDialog.tsx";
import { ServicesSection } from "../config/ServicesSection.tsx";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

const OLLAMA_SITE = "https://ollama.com/download";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Memory by meaning needs an embedding engine: Ollama on the core's machine when it is there (its models, the one that
 * fits, pulled from here), a link to get it when it is not, or any engine of the owner's own. Once there is one, the
 * engines are listed as in Settings › Memory: whether each answers, and why not.
 */
export function EmbedderCard() {
  const t = useT();
  const [s, setS] = useState<LocalEmbedding>();
  // The engines there are (their ids), once the owner opens "use another engine".
  const [own, setOwn] = useState<string[]>();
  const [asked, setAsked] = useState(false);
  const [engines, setEngines] = useState<ServiceInfo[]>();
  const load = useCallback(async () => {
    try {
      setS(await client.call("embeddings.local", {}));
    } catch {
      setS(undefined);
    }
  }, []);
  const loadEngines = useCallback(async () => {
    const r = await client.call("services.list", { kind: "embedding" }).catch(() => undefined);
    setEngines(r?.services ?? []);
  }, []);
  useEffect(() => {
    void loadEngines();
  }, [loadEngines]);
  const inUse = engines?.find((e) => e.enabled);
  useEffect(() => {
    void load();
  }, [load]);
  const pulling = Boolean(s?.pull && !s.pull.error);
  useEffect(() => {
    if (!pulling) return;
    const iv = setInterval(() => void load(), 1000);
    return () => clearInterval(iv);
  }, [pulling, load]);

  const install = async (model: string) => {
    setAsked(true);
    try {
      setS(await client.call("embeddings.install", { model }));
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    setAsked(false);
  };
  const openOwn = async () => {
    const r = await client.call("services.list", { kind: "embedding" }).catch(() => undefined);
    setOwn(r?.services.map((x) => x.id) ?? []);
  };
  const site = () => {
    if (window.apxDesktop?.openExternal) void window.apxDesktop.openExternal(OLLAMA_SITE);
    else window.open(OLLAMA_SITE, "_blank", "noopener,noreferrer");
  };

  const pick = s?.library.find((m) => m.id === s.recommended);
  const has = (id: string) => s?.ollama.models.some((m) => m.name === id || m.name === `${id}:latest`);
  const pull = s?.pull;
  const pct = pull?.total ? Math.floor((pull.completed / pull.total) * 100) : 0;
  return (
    <div className="wiz__card wiz__embed">
      <span className="wiz__rowmain">
        <span className="wiz__rowname">{t("setup.embed.title")}</span>
        <span className="wiz__rowbody">
          {s?.active ? t("setup.memory.engine", { engine: s.active }) : t("setup.embed.none")}
          {s?.active && inUse?.status === "unreachable" && (
            <>
              {" "}
              <Badge tone="danger" dot>
                {t("svc.status.unreachable")}
              </Badge>
            </>
          )}
        </span>
      </span>
      {!s ? (
        <span className="wiz__hintline">
          <Spinner size={12} /> {t("setup.embed.looking")}
        </span>
      ) : s.ollama.running ? (
        <>
          <span className="wiz__hintline">
            {t("setup.embed.ollama", { version: s.ollama.version ?? "" })}
            {s.ollama.models.length === 0 && ` ${t("setup.embed.noModels")}`}
          </span>
          {s.ollama.models.length > 0 && (
            <div className="wiz__embedmodels">
              {s.ollama.models.map((m) => {
                const on = Boolean(s.active?.includes(m.name.replace(/:latest$/, "")));
                return (
                  <Button
                    key={m.name}
                    size="sm"
                    variant={on ? "primary" : "secondary"}
                    aria-pressed={on}
                    disabled={asked || pulling}
                    leadingIcon={on ? <Icons.Check size={14} /> : undefined}
                    onClick={() => void install(m.name.replace(/:latest$/, ""))}
                  >
                    {m.name.replace(/:latest$/, "")}
                  </Button>
                );
              })}
            </div>
          )}
          {pick && !has(pick.id) && (
            <div className="wiz__embedpick">
              <span className="wiz__rowbody">
                {t("setup.embed.recommended", { model: pick.id, gb: s.memory_gb, mb: pick.mb })}{" "}
                <Badge tone="brand">{t("setup.embed.fits")}</Badge>
              </span>
              {pull && !pull.error ? (
                <span className="wiz__hintline" role="status">
                  <Spinner size={12} /> {t("setup.embed.pulling", { model: pull.model, pct })}
                </span>
              ) : (
                <div>
                  <Button
                    size="sm"
                    loading={asked}
                    leadingIcon={<Icons.Download size={14} />}
                    onClick={() => void install(pick.id)}
                  >
                    {t("setup.embed.pull", { model: pick.id })}
                  </Button>
                </div>
              )}
            </div>
          )}
          {pull?.error && <span className="wiz__hintline is-error">{pull.error}</span>}
        </>
      ) : engines?.length ? null : (
        <>
          <span className="wiz__hintline">{t("setup.embed.noOllama")}</span>
          <div className="wiz__inline">
            <Button size="sm" variant="secondary" leadingIcon={<Icons.ExternalLink size={14} />} onClick={site}>
              {t("setup.embed.getOllama")}
            </Button>
            <Button size="sm" variant="ghost" leadingIcon={<Icons.RefreshCw size={14} />} onClick={() => void load()}>
              {t("setup.embed.retry")}
            </Button>
          </div>
        </>
      )}
      {engines?.length ? (
        <ServicesSection
          kind="embedding"
          embedded
          onChange={(list) => {
            setEngines(list);
            void load();
          }}
        />
      ) : (
        <div>
          <Button size="sm" variant="ghost" leadingIcon={<Icons.Plus size={14} />} onClick={() => void openOwn()}>
            {t("setup.embed.own")}
          </Button>
        </div>
      )}
      {own && (
        <ServiceDialog
          kind="embedding"
          initial={undefined}
          taken={own}
          onClose={() => setOwn(undefined)}
          onSaved={() => {
            setOwn(undefined);
            void load();
            void loadEngines();
          }}
        />
      )}
    </div>
  );
}
