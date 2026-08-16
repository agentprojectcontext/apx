import { http } from "../http";
import type { Organization, OrgArea, OrgRole } from "../../types/daemon";

export const Org = {
  get: (pid: string) => http.get<Organization>(`/api/projects/${pid}/organization`),
  createArea: (pid: string, body: { name: string; slug?: string; goal?: string | null }) =>
    http.post<OrgArea>(`/api/projects/${pid}/organization/areas`, body),
  updateArea: (pid: string, slug: string, patch: { name?: string; goal?: string | null }) =>
    http.patch<OrgArea>(`/api/projects/${pid}/organization/areas/${encodeURIComponent(slug)}`, patch),
  removeArea: (pid: string, slug: string) =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/organization/areas/${encodeURIComponent(slug)}`),
  createRole: (pid: string, body: { name: string; slug?: string; area?: string | null; description?: string | null }) =>
    http.post<OrgRole>(`/api/projects/${pid}/organization/roles`, body),
  updateRole: (pid: string, slug: string, patch: { name?: string; area?: string | null; description?: string | null }) =>
    http.patch<OrgRole>(`/api/projects/${pid}/organization/roles/${encodeURIComponent(slug)}`, patch),
  removeRole: (pid: string, slug: string) =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/organization/roles/${encodeURIComponent(slug)}`),
};
