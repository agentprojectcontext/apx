// An example folder path for a path field's placeholder, written the way the
// DAEMON's machine spells paths — not the browser's. The folder a project lives
// in is on the host the daemon runs on, and the panel is often opened from
// somewhere else (a phone, another computer), so `navigator.platform` would
// show a Mac path to someone whose daemon runs on Windows.
//
// The home comes from the existing directory listing (`~` resolves on the
// daemon), so the example is `/Users/<you>/…`, `/home/<you>/…` or
// `C:\Users\<you>\…` as it really is there. Until that answers, the generic
// i18n placeholder stands in.
import useSWR from "swr";
import { Filesystem } from "../lib/api/filesystem";
import { t } from "../i18n";

export function useExamplePath(): string {
  const { data } = useSWR("/api/admin/fs/dirs?path=~", () => Filesystem.dirs("~"), {
    revalidateOnFocus: false,
  });
  const home = data?.path;
  if (!home) return t("add_project.path_placeholder");
  const sep = /^[A-Za-z]:\\/.test(home) || home.includes("\\") ? "\\" : "/";
  return `${home.replace(/[\\/]+$/, "")}${sep}${t("add_project.path_placeholder_name")}`;
}
