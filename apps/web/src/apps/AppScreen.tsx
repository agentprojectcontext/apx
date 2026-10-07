import { AgentAvatar, Button, EmptyState, IconButton, Icons } from "@apx/ui";
import { setSurfaceFlags } from "../data/actions.ts";
import { blobOf, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";
import { openWidgetChat } from "../surfaces/WidgetChat.tsx";

/** An installed app (a surface with app=true) filling the main area. */
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
            {t("app.sub", {
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
          leadingIcon={<Icons.Trash2 size={14} />}
          onClick={async () => {
            await setSurfaceFlags(app.id, { app: false });
            back();
          }}
        >
          {t("app.remove")}
        </Button>
      </header>
      <div className="appscreen__body">
        <SurfaceFrame surfaceId={app.id} fit="fill" />
      </div>
    </section>
  );
}
