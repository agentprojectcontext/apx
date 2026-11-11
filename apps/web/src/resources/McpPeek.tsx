import type { McpServerStatus } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { Button, Dialog, EmptyState, Icons, Spinner } from "@apx/ui";
import { useEffect, useState } from "react";
import { useSlice } from "../data/createStore.ts";
import { projectName } from "../data/identity.ts";
import { closeMcp, mcpPeek } from "../data/mcpPeek.ts";
import { listMcp } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { McpDetail } from "./McpDetail.tsx";
import { McpDialog } from "./McpDialog.tsx";

const identity = (server: McpServerStatus) => `${server.scope}:${server.project_id ?? ""}:${server.name}`;

export function McpPeek() {
  const target = useSlice(mcpPeek, (s) => s.target);
  return target ? (
    <McpPeekBody key={`${target.name}:${target.source ?? ""}`} name={target.name} source={target.source} />
  ) : null;
}

function McpPeekBody({ name, source }: { name: string; source: string | undefined }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [servers, setServers] = useState<McpServerStatus[]>();
  const [failed, setFailed] = useState<"unavailable" | "denied">();
  const [retry, setRetry] = useState(0);
  const [picked, setPicked] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads this resource
  useEffect(() => {
    let canceled = false;
    setFailed(undefined);
    setServers(undefined);
    let denied = false;
    void listMcp(undefined, {
      quiet: true,
      onError: (error) => {
        denied = error instanceof ApxError && error.code === "unauthorized";
      },
    }).then((all) => {
      if (canceled) return;
      if (!all) {
        setFailed(denied ? "denied" : "unavailable");
        return;
      }
      setServers(
        all.filter(
          (s) =>
            s.name === name &&
            (!source ||
              (source === "global" ? s.scope === "global" : s.scope === "project" && s.project_id === source)),
        ),
      );
    });
    return () => {
      canceled = true;
    };
  }, [name, source, retry]);
  const server = picked ? servers?.find((s) => identity(s) === picked) : servers?.length === 1 ? servers[0] : undefined;
  if (server?.definition) return <McpDialog server={server} onClose={closeMcp} onSaved={closeMcp} />;
  return (
    <Dialog open size="lg" title={name} closeLabel={t("common.close")} onOpenChange={(open) => !open && closeMcp()}>
      {failed ? (
        <EmptyState icon={<Icons.Server />} title={t(failed === "denied" ? "res.mcpDenied" : "res.mcpLoadError")}>
          <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </EmptyState>
      ) : !servers ? (
        <Spinner />
      ) : server ? (
        <McpDetail
          server={server}
          projectId={server.project_id}
          onChanged={() => setRetry((n) => n + 1)}
          onEdit={() => {}}
          onRemove={() => {}}
        />
      ) : !servers.length ? (
        <EmptyState icon={<Icons.Server />} title={t("res.mcpMissing")} />
      ) : (
        <div className="pform">
          <p>{t("res.mcpAmbiguous")}</p>
          {servers.map((s) => (
            <Button key={identity(s)} variant="secondary" onClick={() => setPicked(identity(s))}>
              {s.name} · {s.scope === "project" || s.only ? projectName(projects, s.project_id) : t("res.scope.global")}
            </Button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
