import { Suspense } from "react";
import { PublicCopyDialog } from "../lazy.ts";
import { InstallArtifactDialog } from "./InstallArtifact.tsx";
import { usePublicRequest } from "./publicRequest.ts";

export function ArtifactDialogs() {
  const request = usePublicRequest();
  return (
    <>
      <InstallArtifactDialog />
      {request && (
        <Suspense fallback={null}>
          <PublicCopyDialog key={request.draft ?? request.code ?? request.surface} request={request} />
        </Suspense>
      )}
    </>
  );
}
