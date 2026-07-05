import { http } from "../http";
import type { Organization, OrgArea, OrgRole } from "../../types/daemon";

export const Org = {
  get: (pid: string) => http.get<Organization>(`/projects/${pid}/organization`),
  createArea: (pid: string, body: { name: string; slug?: string; goal?: string | null }) =>
    http.post<OrgArea>(`/projects/${pid}/organization/areas`, body),
  updateArea: (pid: string, slug: string, patch: { name?: string; goal?: string | null }) =>
    http.patch<OrgArea>(`/projects/${pid}/organization/areas/${encodeURIComponent(slug)}`, patch),
  removeArea: (pid: string, slug: string) =>
    http.del<{ ok: boolean }>(`/projects/${pid}/organization/areas/${encodeURIComponent(slug)}`),
  createRole: (pid: string, body: { name: string; slug?: string; area?: string | null; description?: string | null }) =>
    http.post<OrgRole>(`/projects/${pid}/organization/roles`, body),
  updateRole: (pid: string, slug: string, patch: { name?: string; area?: string | null; description?: string | null }) =>
    http.patch<OrgRole>(`/projects/${pid}/organization/roles/${encodeURIComponent(slug)}`, patch),
  removeRole: (pid: string, slug: string) =>
    http.del<{ ok: boolean }>(`/projects/${pid}/organization/roles/${encodeURIComponent(slug)}`),
};
