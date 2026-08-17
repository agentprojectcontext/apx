import { http } from "../http";
import type { FileTreeResponse, FileContent } from "../../types/daemon";

export type FileScope = "project" | "docs";

// Project file browser + docs editor. `scope` picks the sandbox: the whole
// repo ("project") or the docs subfolder ("docs"). Same store, different root.
export const ProjectFiles = {
  tree: (pid: string, scope: FileScope = "project") =>
    http.get<FileTreeResponse>(`/api/projects/${pid}/fs/tree?scope=${scope}`),
  read: (pid: string, path: string, scope: FileScope = "project") =>
    http.get<FileContent>(`/api/projects/${pid}/fs/file?scope=${scope}&path=${encodeURIComponent(path)}`),
  write: (pid: string, path: string, content: string, scope: FileScope = "project") =>
    http.put<{ ok: boolean; path: string; bytes: number }>(`/api/projects/${pid}/fs/file`, { scope, path, content }),
  mkdir: (pid: string, path: string, scope: FileScope = "project") =>
    http.post<{ ok: boolean; path: string }>(`/api/projects/${pid}/fs/dir`, { scope, path }),
  remove: (pid: string, path: string, scope: FileScope = "project") =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/fs/entry?scope=${scope}&path=${encodeURIComponent(path)}`),
};
