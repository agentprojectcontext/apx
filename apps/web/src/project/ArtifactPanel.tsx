import type { SurfaceSummary } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import { useState } from "react";
import { Drawer } from "../common/Drawer.tsx";
import { useT } from "../i18n/index.ts";
import { DocumentActions } from "../panel/DocumentActions.tsx";
import { DocumentText } from "../panel/DocumentPanel.tsx";
import type { DocRef } from "../panel/documents.ts";
import { SurfaceActions } from "../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";

/** A widget beside the Artifacts list, live, with the actions its header has everywhere else (icons only). */
export function WidgetDrawer({ surface, onClose }: { surface: SurfaceSummary; onClose: () => void }) {
  return (
    <Drawer
      className="artifactpanel"
      label={surface.title}
      title={surface.title}
      onClose={onClose}
      actions={
        <div className="artifactpanel__actions">
          <SurfaceActions surface={surface} />
        </div>
      }
    >
      <div className="artifactpanel__body artifactpanel__body--widget">
        <SurfaceFrame surfaceId={surface.id} fit="fill" />
      </div>
    </Drawer>
  );
}

/** A document beside the Artifacts list: read in place, its source, its file, or the chat it came from. */
export function DocumentDrawer({
  doc,
  onOpenChat,
  onClose,
}: {
  /** With the chat it is in, for its folder. */
  doc: DocRef & { thread_id?: string };
  onOpenChat: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [raw, setRaw] = useState(doc.format === "text");
  return (
    <Drawer
      className="artifactpanel"
      label={doc.title}
      title={doc.title}
      onClose={onClose}
      actions={
        <div className="artifactpanel__actions">
          <IconButton
            size="sm"
            label={t("artifacts.openChat")}
            icon={<Icons.MessageSquare size={14} />}
            onClick={onOpenChat}
          />
          <IconButton
            size="sm"
            label={raw ? t("document.view") : t("document.source")}
            icon={raw ? <Icons.Eye size={14} /> : <Icons.Code size={14} />}
            active={raw}
            onClick={() => setRaw((v) => !v)}
          />
          <DocumentActions doc={doc} thread={doc.thread_id} />
        </div>
      }
    >
      <div className="artifactpanel__body">
        {doc.name !== doc.title && (
          <div className="artifactpanel__file" title={doc.name}>
            {doc.name}
          </div>
        )}
        <DocumentText key={doc.media_id} doc={doc} raw={raw} />
      </div>
    </Drawer>
  );
}
