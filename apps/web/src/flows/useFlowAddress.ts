// The Flow's address in the editor (DECISIONS.md#d-178): saved, or for a new Flow the one the owner chose, else the one
// its name gives. Renaming a saved Flow's address takes effect at once; a new Flow's is kept until its first save.

import { ApxError } from "@apx/protocol/client";
import { flowPathOf } from "@apx/protocol/flow-path";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import type { Address } from "./HookFields.tsx";
import { type Flow, pathOf } from "./steps.tsx";

export function useFlowAddress(o: {
  flow: Flow | undefined;
  id: string | undefined;
  /** A new Flow's id once made here or by the super-agent. */
  made: string | undefined;
  name: string;
  projectId: string;
}) {
  const t = useT();
  const { id, made, projectId } = o;
  const [savedPath, setSavedPath] = useState(o.flow ? pathOf(o.flow) : undefined);
  const [chosenPath, setChosenPath] = useState<string>();
  const path = savedPath ?? chosenPath ?? flowPathOf(o.name);
  // A Flow the super-agent made here: its address comes with it.
  useEffect(() => {
    if (!made || savedPath) return;
    let live = true;
    void client.call("flows.list", { project: projectId || undefined }).then(
      (r) => {
        const found = r.flows.find((f) => f.id === made);
        if (live && found) setSavedPath(pathOf(found));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [made, savedPath, projectId]);
  const address: Address = {
    path,
    saved: Boolean(id && savedPath),
    flowId: id,
    async set(next) {
      if (!id || !savedPath) {
        setChosenPath(next);
        return true;
      }
      try {
        setSavedPath(pathOf(await client.call("flows.path_set", { flow: id, path: next })));
        notify(t("flow.addr.changed"), "info");
        return true;
      } catch (e) {
        const taken = e instanceof ApxError && (e.detail as { reason?: string } | undefined)?.reason === "path_taken";
        notify(t(taken ? "flow.addr.taken" : "flow.addr.failed"));
        return false;
      }
    },
  };
  return { path, address, savedPath, chosenPath, setSavedPath };
}
