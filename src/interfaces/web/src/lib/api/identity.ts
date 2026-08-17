import { http } from "../http";
import type { Identity } from "../../types/daemon";

export const IdentityApi = {
  get:   () => http.get<Identity>("/api/identity"),
  patch: (body: Partial<Identity>) => http.patch<Identity>("/api/identity", body),
};
