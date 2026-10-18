import type { MarkdownLabels } from "@apx/ui";
import { useMemo } from "react";
import { useT } from "../i18n/index.ts";

/** MarkdownView's control names (a table's copy and maximize buttons) in the panel's language. */
export function useMarkdownLabels(): MarkdownLabels {
  const t = useT();
  return useMemo(
    () => ({
      table: t("md.table"),
      maximize: t("md.maximize"),
      copy: t("md.copyTable"),
      copied: t("msg.copied"),
      copyMarkdown: t("md.copyMarkdown"),
      copyTsv: t("md.copyTsv"),
      close: t("common.close"),
    }),
    [t],
  );
}
