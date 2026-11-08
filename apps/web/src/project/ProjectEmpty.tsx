import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";

/** A project tab with nothing in it yet: one quiet line in the middle, or what the tab says instead. */
export function ProjectEmpty({ name, children }: { name: string; children?: ReactNode }) {
  const t = useT();
  return <p className="projempty">{children ?? t("project.emptyTab", { name })}</p>;
}
