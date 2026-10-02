import type { ExtensionInfo } from "@apx/protocol";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import {
  listMcp,
  listSecrets,
  listSkills,
  type McpServerStatus,
  type SecretInfo,
  type SkillInfo,
} from "../data/resources.ts";

export type ResourcesData = {
  skills: SkillInfo[] | undefined;
  servers: McpServerStatus[] | undefined;
  secrets: SecretInfo[] | undefined;
  extensions: ExtensionInfo[] | undefined;
};

/**
 * Everything the Resources tabs show, loaded together so the tab counters are right from the start. In a project:
 * its own and the inherited global ones. Globally: the owner's plus every project's own skills, for the scope chips.
 */
export function useResources(projectId: string | undefined, projectIds: string[]) {
  const [data, setData] = useState<ResourcesData>({
    skills: undefined,
    servers: undefined,
    secrets: undefined,
    extensions: undefined,
  });
  const key = projectIds.join(",");
  const loadSkills = useCallback(async () => {
    const own = (await listSkills(projectId)) ?? [];
    // Globally, each project's own skills join the list (the inherited copies are already in `own`).
    const more = projectId
      ? []
      : (
          await Promise.all(
            key
              .split(",")
              .filter(Boolean)
              .map((p) => listSkills(p)),
          )
        ).flatMap((l) => (l ?? []).filter((s) => s.scope === "project"));
    setData((d) => ({ ...d, skills: [...own, ...more] }));
  }, [projectId, key]);
  const loadServers = useCallback(async () => {
    const servers = await listMcp(projectId);
    setData((d) => ({ ...d, servers: servers ?? [] }));
  }, [projectId]);
  const loadSecrets = useCallback(async () => {
    const secrets = await listSecrets();
    setData((d) => ({ ...d, secrets: secrets ?? [] }));
  }, []);
  const loadExtensions = useCallback(async () => {
    try {
      const r = await client.call("extensions.list", {});
      setData((d) => ({ ...d, extensions: r.extensions }));
    } catch {
      setData((d) => ({ ...d, extensions: [] }));
    }
  }, []);
  useEffect(() => {
    void loadSkills();
    void loadServers();
    void loadSecrets();
    void loadExtensions();
  }, [loadSkills, loadServers, loadSecrets, loadExtensions]);
  return { data, setData, loadSkills, loadServers, loadSecrets, loadExtensions };
}

export type Resources = ReturnType<typeof useResources>;
