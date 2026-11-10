// Files' artifacts: every widget, app and web page an agent made, open or closed, as cards like a file's.
import type { Author, SurfaceSummary } from "@apx/protocol";
import { IconButton, Icons, Menu, Tooltip } from "@apx/ui";
import { useMemo, useState } from "react";
import { loadThread } from "../data/actions.ts";
import { DEFAULT_PID } from "../data/identity.ts";
import { data, useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ArtifactMemoryDialog } from "../surfaces/ArtifactMemory.tsx";
import { ArtifactPropertiesDialog } from "../surfaces/ArtifactProperties.tsx";
import { KindIcon, kindLabel, kindOf } from "../surfaces/artifactKind.tsx";
import { artifactMenu } from "../surfaces/artifactMenu.tsx";
import { useRunningApps } from "../surfaces/livePool.ts";
import { type ArtifactFilter, filterArtifacts } from "./artifactList.ts";
import { CardLine } from "./sharedFile.tsx";

/** Every artifact in the system that a filter keeps, kept live as agents make, change or delete them. */
export function useArtifacts({ project, query, order }: ArtifactFilter): SurfaceSummary[] {
  const surfaces = useData((s) => s.surfaces);
  return useMemo(
    () => filterArtifacts(Object.values(surfaces), { project, query, order }, DEFAULT_PID),
    [surfaces, project, query, order],
  );
}

/** The chat an artifact was made in, at the message that shows it when that message is found. */
async function goToArtifactChat(s: SurfaceSummary): Promise<void> {
  const thread = s.thread_id;
  if (!thread) return;
  await loadThread(thread);
  const st = data.get();
  if (st.threadLoad[thread] === "error") return;
  const engine = st.threads[thread]?.engine;
  const shown = (st.messages[thread] ?? []).findLast((m) =>
    m.parts.some((p) => p.type === "surface" && p.surface_id === s.id),
  );
  if (shown) go.message(thread, shown.id, engine);
  else if (engine) go.engine(engine, thread);
  else go.thread(thread);
}

const maker = (s: SurfaceSummary): Author =>
  s.created_by === "owner" ? { kind: "user" } : { kind: "agent", id: s.created_by };

function ArtifactCard({
  surface: s,
  running,
  onMemory,
  onProperties,
}: {
  surface: SurfaceSummary;
  running: boolean;
  onMemory: () => void;
  onProperties: () => void;
}) {
  const t = useT();
  const kind = kindOf(s);
  const open = t("files.artifacts.open", { title: s.title });
  return (
    <li className="sharedf__card">
      <Tooltip content={open}>
        {/* ui: the card's picture opens it, the same control as a file card's. */}
        <button type="button" className="sharedf__open" onClick={() => go.app(s.id)} aria-label={open}>
          <span className={`sharedf__thumb is-artifact is-${kind}`}>
            <KindIcon kind={kind} size={24} />
          </span>
        </button>
      </Tooltip>
      <span className="sharedf__actions">
        {s.thread_id && (
          <IconButton
            label={t("shared.goTo")}
            icon={<Icons.MessageSquare size={16} />}
            onClick={() => void goToArtifactChat(s)}
          />
        )}
        <Menu
          align="end"
          trigger={<IconButton label={t("common.more")} icon={<Icons.Ellipsis size={16} />} />}
          items={artifactMenu(s, t, { onMemory, onProperties, running })}
        />
      </span>
      <div className="sharedf__cardbody">
        <span className="sharedf__name" title={s.title}>
          {s.title}
        </span>
        <CardLine author={maker(s)} at={s.updated_at} projectId={s.project_id} hint={kindLabel(kind, t)} />
      </div>
    </li>
  );
}

/** Artifacts as cards: a click opens one, its chat is one button away, and the rest of its menu is under "More". */
export function ArtifactGrid({ items }: { items: readonly SurfaceSummary[] }) {
  const running = new Set(useRunningApps());
  const surfaces = useData((s) => s.surfaces);
  const [memoryOf, setMemoryOf] = useState<string>();
  const [propsOf, setPropsOf] = useState<string>();
  const memory = memoryOf ? surfaces[memoryOf] : undefined;
  const props = propsOf ? surfaces[propsOf] : undefined;
  return (
    <>
      <ul className="sharedf__grid">
        {items.map((s) => (
          <ArtifactCard
            key={s.id}
            surface={s}
            running={running.has(s.id)}
            onMemory={() => setMemoryOf(s.id)}
            onProperties={() => setPropsOf(s.id)}
          />
        ))}
      </ul>
      {memory && <ArtifactMemoryDialog surface={memory} onClose={() => setMemoryOf(undefined)} />}
      {props && <ArtifactPropertiesDialog surface={props} onClose={() => setPropsOf(undefined)} />}
    </>
  );
}
