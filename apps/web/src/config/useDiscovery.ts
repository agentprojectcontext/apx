import type { DiscoverySettings, DiscoveryStatus, Project, Routine } from "@apx/protocol";
import { ApxError, ErrorCode } from "@apx/protocol/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";

export function useDiscovery() {
  const [status, setStatus] = useState<DiscoveryStatus>();
  const [draft, setDraft] = useState<DiscoverySettings>();
  const [baseline, setBaseline] = useState<DiscoverySettings>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [error, setError] = useState<"load" | "save" | "conflict">();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(() => {
    const seq = ++sequence.current;
    setError(undefined);
    setSaved(false);
    void Promise.all([
      client.call("discovery.settings", {}),
      client.call("projects.list", {}),
      client.call("routines.list", {}),
    ]).then(
      ([value, ps, rs]) => {
        if (sequence.current !== seq) return;
        setStatus(value);
        setDraft(value.settings);
        setBaseline(value.settings);
        setProjects(ps.projects.filter((p) => p.registered !== false && !p.unreadable));
        setRoutines(rs.routines.filter((r) => !r.project_id && r.agent_id === "superagent" && r.action === "agent"));
      },
      () => {
        if (sequence.current === seq) setError("load");
      },
    );
  }, []);
  useEffect(() => {
    load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  const save = async () => {
    if (!draft || !status) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const value = await client.call("discovery.configure", { ...draft, expected: baseline });
      setStatus(value);
      setDraft(value.settings);
      setBaseline(value.settings);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApxError &&
          err.code === ErrorCode.Conflict &&
          err.message.startsWith("Discovery settings changed")
          ? "conflict"
          : "save",
      );
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    draft,
    setDraft,
    setStatus,
    projects,
    routines,
    error,
    saved,
    busy,
    load,
    async refresh() {
      setBusy(true);
      try {
        const value = await client.call("discovery.settings", {});
        setStatus(value);
        if (JSON.stringify(value.settings) !== JSON.stringify(baseline)) setError("conflict");
      } catch {
        setError("load");
      } finally {
        setBusy(false);
      }
    },
    save,
    dirty: JSON.stringify(draft) !== JSON.stringify(baseline),
  };
}
