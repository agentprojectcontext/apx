// The core's log (<home>/logs/core.log), read through the core: the panel never touches the file.
import type { Params, Result } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";

export type CoreLog = Result<"system.logs">;

export async function readCoreLog(params: Params<"system.logs">): Promise<CoreLog | undefined> {
  try {
    return await client.call("system.logs", params);
  } catch (e) {
    notify(t("error.load", { error: e instanceof Error ? e.message : String(e) }));
    return undefined;
  }
}
