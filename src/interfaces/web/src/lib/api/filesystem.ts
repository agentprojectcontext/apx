import { http } from "../http";

export interface DirectoryList {
  path: string;
  parent: string | null;
  entries: string[];
}

export type PickDirResult = { path: string } | { cancelled: true };

export const Filesystem = {
  dirs: (path: string) =>
    http.get<DirectoryList>(`/admin/fs/dirs?path=${encodeURIComponent(path)}`),
  pickDir: (prompt?: string) =>
    http.get<PickDirResult>(
      `/admin/fs/pick-dir${prompt ? `?prompt=${encodeURIComponent(prompt)}` : ""}`,
    ),
};
