import "../styles/screens.css";
import type { GroupSettings, Thread } from "@apx/protocol";
import { AgentAvatar, IconButton, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { CardField } from "../channels/ChatCard.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { ModelRefPicker } from "../config/models/ModelRefPicker.tsx";
import { client } from "../data/client.ts";
import { blobOf } from "../data/identity.ts";
import { loadCatalog, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";

const MAX = 5;
const MIN = 2;

type Change = { agent_ids?: string[]; models?: Record<string, string | null>; router_model?: string | null };

/**
 * A group chat's card beside it, as a room's is: its members (add, take out), the model each answers with here or one
 * for everyone, and the model that picks who answers. Each change is kept at once.
 */
export function GroupCard({ thread, onClose }: { thread: Thread; onClose(): void }) {
  return usePack("group") ? <Card thread={thread} onClose={onClose} /> : null;
}

function Card({ thread, onClose }: { thread: Thread; onClose(): void }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const catalogLoad = useModels((s) => s.catalogLoad);
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
        <CardField label={t("group.members")}>
          <ul className="groupcard__members">
            {ids.map((id) => {
              const a = agents[id];
              const model = settings?.models[id];
              return (
                <li key={id} className="groupcard__member">
                  <span className="groupcard__who">
                    {a && <AgentAvatar name={a.name} blob={blobOf(a)} size={20} animated={false} />}
                    <span className="groupcard__name">{a?.name ?? id}</span>
                    {ids.length > MIN && (
                      <IconButton
                        size="sm"
                        label={t("group.remove", { name: a?.name ?? id })}
                        icon={<Icons.X size={13} />}
                        onClick={() => change({ agent_ids: ids.filter((x) => x !== id) })}
                      />
                    )}
                  </span>
                  <span className="groupcard__model">
                    <ModelRefPicker
                      label={t("group.ownModel")}
                      {...(model ? { value: model } : {})}
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
          {ids.length < MAX && (
            <AgentSelect
              value={undefined}
              label={t("group.add")}
              none={t("group.add")}
              projectId={thread.project_id}
              all={!thread.project_id}
              size="sm"
              onChange={(id) => id && !ids.includes(id) && change({ agent_ids: [...ids, id] })}
            />
          )}
        </CardField>
        <CardField label={t("group.allModel")}>
          <ModelRefPicker
            label={t("group.allModelPick")}
            onChange={(ref) => change({ models: Object.fromEntries(ids.map((id) => [id, ref])) })}
          />
        </CardField>
        <CardField label={t("group.router")} hint={t("group.routerHint")}>
          <span className="groupcard__model">
            <ModelRefPicker
              label={t("group.routerAux")}
              {...(settings?.router_model ? { value: settings.router_model } : {})}
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
        </CardField>
      </div>
    </aside>
  );
}
