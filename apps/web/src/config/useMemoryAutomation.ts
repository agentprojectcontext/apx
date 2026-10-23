import type { Result } from "@apx/protocol";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

export function useMemoryAutomation() {
  const t = useT();
  const [jobs, setJobs] = useState<Result<"memory.status">["jobs"]>([]);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const version = generation.current;
    void client
      .call("memory.status", {})
      .then((result) => {
        if (active && version === generation.current) setJobs(result.jobs);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (busy || !jobs.some((job) => job.state === "pending" || job.state === "working")) return;
    let active = true;
    let pending = false;
    const version = generation.current;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void client
        .call("memory.status", {})
        .then((result) => {
          if (active && version === generation.current) setJobs(result.jobs);
        })
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobs, busy]);

  const run = async (backfill: boolean) => {
    if (running.current) return;
    running.current = true;
    const version = ++generation.current;
    setBusy(true);
    try {
      const result = await client.call("memory.maintenance", { backfill, dream: !backfill });
      if (mounted.current && version === generation.current) setJobs(result.jobs);
    } catch (error) {
      if (mounted.current && version === generation.current)
        notify(t("error.memory", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { jobs, busy, run };
}
