import { AgentAvatar, Button, EmptyState, IconButton, Icons } from "@apx/ui";
import { setSurfaceFlags } from "../data/actions.ts";
import { blobOf, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { ArtifactMemoryButton } from "../surfaces/ArtifactMemory.tsx";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";
import { openWidgetChat } from "../surfaces/WidgetChat.tsx";

/** A maximized surface; its saved app flag controls padding, independently of this view. */
export function AppScreen() {
  const t = useT();
  const appId = useNav((s) => s.appId);
  const app = useData((s) => (appId ? s.surfaces[appId] : undefined));
  const author = useData((s) => (app ? s.agents[app.created_by] : undefined));
  const projects = useData((s) => s.projects);
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
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={app.pinned ? <Icons.PinOff size={14} /> : <Icons.Pin size={14} />}
          onClick={() => void setSurfaceFlags(app.id, { pinned: !app.pinned })}
        >
          {app.pinned ? t("widget.unpin") : t("widget.pin")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={app.app ? <Icons.Trash2 size={14} /> : <Icons.AppWindow size={14} />}
          onClick={async () => {
            await setSurfaceFlags(app.id, { app: !app.app });
            if (app.app) back();
          }}
        >
          {t(app.app ? "app.remove" : "widget.installApp")}
        </Button>
      </header>
      <div className="appscreen__body">
        <SurfaceFrame surfaceId={app.id} fit="fill" />
      </div>
    </section>
  );
}
