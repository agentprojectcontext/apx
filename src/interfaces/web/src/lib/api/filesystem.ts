import { http } from "../http";

export interface DirectoryList {
  path: string;
  parent: string | null;
  entries: string[];
}

export const Filesystem = {
  dirs: (path: string) =>
    http.get<DirectoryList>(`/admin/fs/dirs?path=${encodeURIComponent(path)}`),
};
