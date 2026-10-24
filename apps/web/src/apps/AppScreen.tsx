import { AgentAvatar, Button, EmptyState, IconButton, Icons, Menu } from "@apx/ui";
import { useState } from "react";
import { blobOf, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { ArtifactMemoryButton } from "../surfaces/ArtifactMemory.tsx";
import { ArtifactPropertiesDialog } from "../surfaces/ArtifactProperties.tsx";
import { downloadEntry, placeEntries } from "../surfaces/artifactMenu.tsx";
import { bringBack, popOut, useOutside } from "../surfaces/artifactWindows.ts";
import { dropLive, useRunningApps } from "../surfaces/livePool.ts";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";
import { openWidgetChat } from "../surfaces/widgetChatActions.ts";

/** A maximized surface; its saved app flag controls padding, independently of this view. */
export function AppScreen() {
  const t = useT();
  const appId = useNav((s) => s.appId);
  const app = useData((s) => (appId ? s.surfaces[appId] : undefined));
  const author = useData((s) => (app ? s.agents[app.created_by] : undefined));
  const projects = useData((s) => s.projects);
  const outside = useOutside(appId ?? "");
  const running = useRunningApps().includes(appId ?? "");
  const [props, setProps] = useState(false);
  // Back to whatever chat was open before the app.
  const back = () => nav.set({ view: "inbox" });

  if (!app) {
    return (
      <section className="appscreen">
        <EmptyState
          size="lg"
          icon={<Icons.AppWindow />}
          title={t("app.notFound")}
          action={
            <Button size="sm" variant="secondary" onClick={back}>
              {t("common.backToInbox")}
            </Button>
          }
        >
          {t("app.removed")}
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="appscreen" aria-label={app.title}>
      <header className="appscreen__head">
        <IconButton label={t("common.back")} icon={<Icons.ArrowLeft size={16} />} onClick={back} />
        <span className="appscreen__tile">
          <Icons.LayoutGrid size={14} />
        </span>
        <div className="appscreen__titles">
          <div className="appscreen__title">{app.title}</div>
          <div className="appscreen__sub">
            {author && <AgentAvatar name={author.name} blob={blobOf(author)} size={14} animated={false} />}
            {t(app.app ? "app.sub" : "widget.sub", {
              project: projectName(projects, app.project_id),
              author: author?.name ?? app.created_by,
              name: app.name,
            })}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.MessageSquare size={14} />}
          onClick={() => void openWidgetChat(app)}
        >
          {t("widget.chatShort")}
        </Button>
        <ShareMenu surface={app} />
        <ArtifactMemoryButton surface={app} />
        <IconButton
          size="sm"
          label={t("artifact.openWindow")}
          icon={<Icons.ExternalLink size={14} />}
          onClick={() => popOut(app)}
        />
        <Menu
          align="end"
          items={[
            { label: `${t("artifact.properties")}…`, icon: <Icons.Info size={16} />, onSelect: () => setProps(true) },
            downloadEntry(app, t),
            { type: "separator" },
            ...placeEntries(app, t, { removedFromApps: back }),
          ]}
          trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={16} />} />}
        />
        {running && (
          <IconButton
            size="sm"
            label={t("artifact.closeApp")}
            icon={<Icons.X size={16} />}
            onClick={() => {
              dropLive(app.id);
              back();
            }}
          />
        )}
      </header>
      {props && <ArtifactPropertiesDialog surface={app} onClose={() => setProps(false)} />}
      <div className="appscreen__body">
        {outside ? (
          <EmptyState
            size="lg"
            icon={<Icons.ExternalLink />}
            title={t("artifact.outsideTitle")}
            action={
              <Button size="sm" variant="secondary" onClick={() => bringBack(app.id)}>
                {t("artifact.bringBack")}
              </Button>
            }
          >
            {t("artifact.outsideHint")}
          </EmptyState>
        ) : (
          // An app keeps running when the owner leaves; a widget is a view, closed on leaving (unless apx-live).
          <SurfaceFrame surfaceId={app.id} fit="fill" open={app.app} />
        )}
      </div>
    </section>
  );
}
