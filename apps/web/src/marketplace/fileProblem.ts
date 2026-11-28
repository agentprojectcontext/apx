import { ApxError } from "@apx/protocol/client";

const messages = {
  missing: "mkt.fileMissing",
  unreadable: "mkt.fileUnreadable",
  invalid_sqlite: "mkt.fileInvalidSqlite",
  active_sqlite: "mkt.fileActiveSqlite",
} as const;

export function fileProblem(error: unknown) {
  if (!(error instanceof ApxError)) return undefined;
  const detail = error.detail;
  if (!detail || typeof detail !== "object" || !("kind" in detail) || detail.kind !== "setting_file") return undefined;
  if (!("setting" in detail) || typeof detail.setting !== "string" || !("reason" in detail)) return undefined;
  const reason = detail.reason;
  if (reason !== "missing" && reason !== "unreadable" && reason !== "invalid_sqlite" && reason !== "active_sqlite")
    return undefined;
  return { setting: detail.setting, key: messages[reason] };
}
