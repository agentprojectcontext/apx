import type { SurfaceSummary } from "@apx/protocol";
import { Button, Dialog, IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useState } from "react";
import { removeSurface } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ArtifactMemoryDialog } from "./ArtifactMemory.tsx";
import { ArtifactPropertiesDialog } from "./ArtifactProperties.tsx";
import { downloadEntry, placeEntries } from "./artifactMenu.tsx";
import { popOut } from "./artifactWindows.ts";
import { pageMenu } from "./pageActions.tsx";
import { ShareMenu } from "./ShareMenu.tsx";
import { openWidgetChat } from "./widgetChatActions.ts";

/**
 * An artifact's actions wherever its header shows: asking its agent for changes (outside its chat), sharing, and the
 * rest under More. Deleting it for good is offered only where artifacts are kept (the board, its lists), not in a chat.
 */
export function SurfaceActions({ surface, inChat = false }: { surface: SurfaceSummary; inChat?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState<"memory" | "properties" | "delete">();
  const more: MenuEntry[] = surface.page
    ? pageMenu(surface, t, { share: false })
    : [
        ...(surface.in_apps
          ? ([
              { label: t("widget.openApp"), icon: <Icons.AppWindow size={16} />, onSelect: () => go.app(surface.id) },
            ] satisfies MenuEntry[])
          : []),
        ...placeEntries(surface, t),
        { type: "separator" },
        { label: t("artifact.openWindow"), icon: <Icons.ExternalLink size={16} />, onSelect: () => popOut(surface) },
        { label: `${t("artifact.memory")}…`, icon: <Icons.Database size={16} />, onSelect: () => setOpen("memory") },
        downloadEntry(surface, t),
        {
          label: `${t("artifact.properties")}…`,
          icon: <Icons.Info size={16} />,
          onSelect: () => setOpen("properties"),
        },
      ];
  if (!inChat)
    more.push(
      { type: "separator" },
      { label: `${t("artifact.delete")}…`, icon: <Icons.Trash2 size={16} />, onSelect: () => setOpen("delete") },
    );
  return (
    <>
      {!inChat && (
        <IconButton
          size="sm"
          label={t("widget.chat")}
          icon={<Icons.MessageSquare size={14} />}
          onClick={() => void openWidgetChat(surface)}
        />
      )}
      <ShareMenu surface={surface} variant="icon" />
      <Menu
        align="end"
        items={more}
        trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={14} />} />}
      />
      {open === "memory" && <ArtifactMemoryDialog surface={surface} onClose={() => setOpen(undefined)} />}
      {open === "properties" && <ArtifactPropertiesDialog surface={surface} onClose={() => setOpen(undefined)} />}
      {open === "delete" && <DeleteDialog surface={surface} onClose={() => setOpen(undefined)} />}
    </>
  );
}

/** Deletes the artifact for good, after asking: it leaves every board, panel and list, with what it remembered. */
function DeleteDialog({ surface, onClose }: { surface: SurfaceSummary; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const ok = await removeSurface(surface.id);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      title={t("artifact.delete.title")}
      description={t("widget.delete.body")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t("artifact.delete")}
          </Button>
        </>
      }
    >
      {t("widget.delete.what", { title: surface.title })}
    </Dialog>
  );
}
