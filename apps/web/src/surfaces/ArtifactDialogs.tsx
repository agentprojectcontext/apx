import { ConfirmDialog } from "@apx/ui";
import { Suspense } from "react";
import { useT } from "../i18n/index.ts";
import { PublicCopyDialog } from "../lazy.ts";
import { InstallArtifactDialog } from "./InstallArtifact.tsx";
import { closeLiveLink, useLiveLinkRequest } from "./publicCopies.ts";
import { usePublicRequest } from "./publicRequest.ts";
import { turnOnLiveLink } from "./ShareMenu.tsx";

export function ArtifactDialogs() {
  const request = usePublicRequest();
  const live = useLiveLinkRequest();
  const t = useT();
  return (
    <>
      <InstallArtifactDialog />
      {request && (
        <Suspense fallback={null}>
          <PublicCopyDialog key={request.draft ?? request.code ?? request.surface} request={request} />
        </Suspense>
      )}
      {live && (
        <ConfirmDialog
          title={t("share.liveTitle")}
          description={t("share.liveLead")}
          confirmLabel={t("share.liveOn")}
          cancelLabel={t("common.cancel")}
          closeLabel={t("common.close")}
          onConfirm={() => turnOnLiveLink(live)}
          onClose={closeLiveLink}
        />
      )}
    </>
  );
}
