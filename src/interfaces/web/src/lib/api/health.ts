import { http } from "../http";
import type { HealthSummary } from "../../types/daemon";

export const Health = {
  get: () => http.get<HealthSummary>("/health"),
};
