import { http } from "../http";

export type UpdateStatus = {
  current: string;
  latest: string | null;
  newer: boolean;
  checked_at: number | null;
  /** Running from a clone: `apx update` is the wrong advice there. */
  from_git: boolean;
};

export const Update = {
  get: () => http.get<UpdateStatus>("/api/update"),
};
