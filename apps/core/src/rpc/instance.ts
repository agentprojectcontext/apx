// Moving this setup to another computer or keeping a copy of it: the file, its preview and its import (owner only).
import { ErrorCode } from "@apx/protocol";
import { badRequest, CallError } from "../errors.ts";
import { exportInstance, InstanceTooBig } from "../instance/export.ts";
import { applyImport, type ImportDeps, ImportOutOfTime, InstanceRefused, previewImport } from "../instance/plan.ts";
import type { Handlers } from "./router.ts";

/** A file that is not read says why, for the panel to tell the owner. */
function refusal(err: unknown): unknown {
  if (err instanceof InstanceRefused) return badRequest(err.message, { reason: err.reason });
  if (err instanceof InstanceTooBig) return badRequest(err.message, { reason: "too_big" });
  if (err instanceof ImportOutOfTime) return new CallError({ code: ErrorCode.Timeout, message: err.message });
  return err;
}

export function instanceHandlers(deps: ImportDeps) {
  return {
    "instance.export": ({ chats, rows }) => {
      try {
        return exportInstance(deps, { chats, rows });
      } catch (err) {
        throw refusal(err);
      }
    },
    "instance.preview_import": ({ file }) => {
      try {
        return previewImport(deps, file);
      } catch (err) {
        throw refusal(err);
      }
    },
    "instance.import": async ({ file }) => {
      try {
        return await applyImport(deps, file);
      } catch (err) {
        throw refusal(err);
      }
    },
  } satisfies Partial<Handlers>;
}
