import { AgentAvatar, Button, EmptyState, IconButton, Icons } from "@apx/ui";
import { setSurfaceFlags } from "../data/actions.ts";
import { blobOf, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { nav, useNav } from "../shell/nav.ts";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";

/** An installed app (a surface with app=true) filling the main area. */
export function AppScreen() {
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
          title="App no encontrada"
          action={
            <Button size="sm" variant="secondary" onClick={back}>
              Volver al Inbox
            </Button>
          }
        >
          Puede que la hayan quitado de apps.
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="appscreen" aria-label={app.title}>
      <header className="appscreen__head">
        <IconButton label="Volver" icon={<Icons.ArrowLeft size={16} />} onClick={back} />
        <span className="appscreen__tile">
          <Icons.LayoutGrid size={14} />
        </span>
        <div className="appscreen__titles">
          <div className="appscreen__title">{app.title}</div>
          <div className="appscreen__sub">
            {author && <AgentAvatar name={author.name} blob={blobOf(author)} size={14} animated={false} />}
            App de {projectName(projects, app.project_id)} · hecha por {author?.name ?? app.created_by} · {app.name}
          </div>
        </div>
        <ShareMenu surface={app} />
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={app.pinned ? <Icons.PinOff size={14} /> : <Icons.Pin size={14} />}
          onClick={() => void setSurfaceFlags(app.id, { pinned: !app.pinned })}
        >
          {app.pinned ? "Quitar del panel" : "Fijar al panel"}
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
          Quitar de apps
        </Button>
      </header>
      <div className="appscreen__body">
        <SurfaceFrame surfaceId={app.id} fit="fill" />
      </div>
    </section>
  );
}
