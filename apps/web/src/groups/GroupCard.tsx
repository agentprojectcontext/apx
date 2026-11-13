import "../styles/screens.css";
import type { GroupSettings, Thread } from "@apx/protocol";
import { AgentAvatar, Help, IconButton, Icons, Menu, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { useAgentOptions } from "../common/pickers/agentOptions.tsx";
import { ModelRefPicker } from "../config/models/ModelRefPicker.tsx";
import { client } from "../data/client.ts";
import { blobOf } from "../data/identity.ts";
import { loadCatalog, refLabel, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";

const MAX = 5;
const MIN = 2;

type Change = {
  agent_ids?: string[];
  models?: Record<string, string | null>;
  model?: string | null;
  router_model?: string | null;
};

/**
 * A group chat's card beside it, as a room's is: the models first (one for everyone, or each member's, and the model
 * that picks who answers), then its members (add, take out). Each change is kept at once.
 */
export function GroupCard({ thread, onClose }: { thread: Thread; onClose(): void }) {
  return usePack("group") ? <Card thread={thread} onClose={onClose} /> : null;
}

function Card({ thread, onClose }: { thread: Thread; onClose(): void }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const catalog = useModels((s) => s.catalog);
  const catalogLoad = useModels((s) => s.catalogLoad);
  const options = useAgentOptions(thread.project_id, !thread.project_id, thread.project_id ? "secretary" : "all");
  const [settings, setSettings] = useState<GroupSettings | undefined>();
  useEffect(() => {
    if (catalogLoad === "idle") void loadCatalog();
  }, [catalogLoad]);
  useEffect(() => {
    void client
      .call("threads.group_get", { thread: thread.id })
      .then(setSettings)
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"));
  }, [thread.id]);
  const change = (c: Change) =>
    void client
      .call("threads.group_set", { thread: thread.id, ...c })
      .then(setSettings)
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"));
  const ids = settings?.agent_ids ?? thread.agent_ids;
  const name = (id: string) => agents[id]?.name ?? id;
  // What a picker shows with nothing picked here: the model that runs then, named.
  const own = (id: string) => {
    const ref = settings?.defaults.members[id];
    return ref ? t("group.ownSuffix", { model: refLabel(ref, catalog) }) : undefined;
  };
  const aux = settings?.defaults.router;
  const everyone = settings?.model;
  const addable = options.filter((o) => !ids.includes(o.value));
  return (
    <aside className="chan__card chan__card--room groupcard" aria-label={t("group.card")}>
      <header className="chan__cardhead">
        <span>{t("group.card")}</span>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      <div className="chan__cardbody">
        <div className="chan__cardwho">
          <span className="chan__cardavatar" aria-hidden>
            <Icons.Users size={20} />
          </span>
          <span className="chan__cardwhomain">
            <span className="chan__cardname">{thread.title}</span>
            <span className="chan__cardvia">
              <span>{t("group.cardHint")}</span>
            </span>
          </span>
        </div>

        <section className="groupcard__section" aria-label={t("group.models")}>
          <h3 className="groupcard__title">{t("group.models")}</h3>
          <Switch
            label={t("group.sameModel")}
            description={everyone ? undefined : t("group.sameModelHint")}
            checked={Boolean(everyone)}
            onCheckedChange={(on) => {
              const first = ids[0];
              const start = (first && (settings?.models[first] ?? settings?.defaults.members[first])) || undefined;
              if (!on) change({ model: null });
              else if (start) change({ model: start });
            }}
          />
          {everyone ? (
            <ModelRefPicker label={t("group.sameModel")} value={everyone} onChange={(ref) => change({ model: ref })} />
          ) : (
            <ul className="groupcard__list">
              {ids.map((id) => {
                const model = settings?.models[id];
                const a = agents[id];
                return (
                  <li key={id} className="groupcard__row">
                    <span className="groupcard__who">
                      {a && <AgentAvatar name={a.name} blob={blobOf(a)} size={18} animated={false} />}
                      <span className="groupcard__name">{name(id)}</span>
                    </span>
                    <span className="groupcard__model">
                      <ModelRefPicker
                        label={t("group.modelOf", { name: name(id) })}
                        {...(model ? { value: model } : {})}
                        {...(own(id) ? { placeholder: own(id) } : {})}
                        onChange={(ref) => change({ models: { [id]: ref } })}
                      />
                      {model && (
                        <IconButton
                          size="sm"
                          label={t("group.resetModel")}
                          icon={<Icons.RotateCcw size={13} />}
                          onClick={() => change({ models: { [id]: null } })}
                        />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="groupcard__label">
            <span>{t("group.routerModel")}</span>
            <Help label={t("group.routerHelpLabel")} title={t("group.routerModel")}>
              {t("group.routerHelp")}
            </Help>
          </div>
          <span className="groupcard__model">
            <ModelRefPicker
              label={t("group.routerModel")}
              {...(settings?.router_model ? { value: settings.router_model } : {})}
              {...(aux ? { placeholder: t("group.auxSuffix", { model: refLabel(aux, catalog) }) } : {})}
              onChange={(ref) => change({ router_model: ref })}
            />
            {settings?.router_model && (
              <IconButton
                size="sm"
                label={t("group.resetRouter")}
                icon={<Icons.RotateCcw size={13} />}
                onClick={() => change({ router_model: null })}
              />
            )}
          </span>
        </section>

        <section className="groupcard__section" aria-label={t("group.members")}>
          <div className="groupcard__head">
            <h3 className="groupcard__title">
              {t("group.members")}{" "}
              <span className="groupcard__count">
                {ids.length}/{MAX}
              </span>
            </h3>
            {ids.length < MAX && addable.length > 0 && (
              <Menu
                align="end"
                trigger={<IconButton size="sm" label={t("group.addMember")} icon={<Icons.Plus size={14} />} />}
                items={addable.map((o) => ({
                  label: o.label,
                  icon: o.icon,
                  onSelect: () => change({ agent_ids: [...ids, o.value] }),
                }))}
              />
            )}
          </div>
          <ul className="groupcard__list">
            {ids.map((id) => {
              const a = agents[id];
              return (
                <li key={id} className="groupcard__row groupcard__member">
                  <span className="groupcard__who">
                    {a && <AgentAvatar name={a.name} blob={blobOf(a)} size={24} animated={false} />}
                    <span className="groupcard__text">
                      <span className="groupcard__name">{name(id)}</span>
                      {a?.role && <span className="groupcard__role">{a.role}</span>}
                    </span>
                  </span>
                  {ids.length > MIN && (
                    <IconButton
                      size="sm"
                      label={t("group.remove", { name: name(id) })}
                      icon={<Icons.X size={13} />}
                      onClick={() => change({ agent_ids: ids.filter((x) => x !== id) })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </aside>
  );
}
