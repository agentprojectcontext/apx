import type { SurfaceSummary } from "@apx/protocol";
import { Button, Dialog, IconButton, Icons } from "@apx/ui";
import { useState } from "react";
import { removeSurface, setSurfaceFlags } from "../data/actions.ts";
import { projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ArtifactMemoryButton } from "./ArtifactMemory.tsx";
import { popOut } from "./artifactWindows.ts";
import { ShareMenu } from "./ShareMenu.tsx";
import { openWidgetChat } from "./WidgetChat.tsx";

/**
 * A widget's actions wherever its header shows (chat card, widget panel, board tile): its chat with the agent that
 * keeps it, and on the board and in Apps, lit while it is there, so it reads the same in every place.
 */
export function SurfaceActions({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  const project = useData((s) => projectName(s.projects, surface.project_id));
  return (
    <>
      <IconButton
        size="sm"
        label={t("widget.chat")}
        icon={<Icons.MessageSquare size={14} />}
        onClick={() => void openWidgetChat(surface)}
      />
      <IconButton
        size="sm"
        label={surface.pinned ? t("artifact.unpinFrom", { project }) : t("artifact.pinTo", { project })}
        icon={surface.pinned ? <Icons.PinOff size={14} /> : <Icons.Pin size={14} />}
        active={surface.pinned}
        onClick={() => void setSurfaceFlags(surface.id, { pinned: !surface.pinned })}
      />
      <IconButton
        size="sm"
        label={surface.app ? t("widget.openApp") : t("widget.installApp")}
        icon={<Icons.AppWindow size={14} />}
        active={surface.app}
        onClick={() => {
          if (surface.app) go.app(surface.id);
          else void setSurfaceFlags(surface.id, { app: true });
        }}
      />
      <ShareMenu surface={surface} variant="icon" />
      <ArtifactMemoryButton surface={surface} />
      <OpenInBrowser surface={surface} />
      <DeleteWidget surface={surface} />
    </>
  );
}

/** Deletes the widget for good, after asking: it leaves every board, panel and list, with what it remembered. */
function DeleteWidget({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const ok = await removeSurface(surface.id);
    setBusy(false);
    if (ok) setAsking(false);
  };
  return (
    <>
      <IconButton
        size="sm"
        label={t("widget.delete")}
        icon={<Icons.Trash2 size={14} />}
        onClick={() => setAsking(true)}
      />
      {asking && (
        <Dialog
          open
          size="sm"
          onOpenChange={(o) => !o && setAsking(false)}
          title={t("widget.delete.title")}
          description={t("widget.delete.body")}
          closeLabel={t("common.close")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove()}>
                {t("widget.delete")}
              </Button>
            </>
          }
        >
          {t("widget.delete.what", { title: surface.title })}
        </Dialog>
      )}
    </>
  );
}

/** The artifact alone in a window of its own (a desktop window in the app, a new tab on the web). */
function OpenInBrowser({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  return (
    <IconButton
      size="sm"
      label={t("artifact.openWindow")}
      icon={<Icons.ExternalLink size={14} />}
      onClick={() => popOut(surface)}
    />
  );
}
