import { http } from "../http";
import type { Identity } from "../../types/daemon";

export const IdentityApi = {
  get:   () => http.get<Identity>("/identity"),
  patch: (body: Partial<Identity>) => http.patch<Identity>("/identity", body),
};
