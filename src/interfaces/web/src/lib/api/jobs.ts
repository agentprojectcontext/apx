import { http } from "../http";
import type { BackgroundJob } from "../../types/daemon";

/** Work agents left running. Read-only: a job ends when its work ends, its
 *  deadline passes, or the daemon holding it dies — never because a client
 *  asked. To stop the work, abort the turn the job opened. */
export const JobsApi = {
  /** Everything, newest first. `open` narrows to what is running right now,
   *  which is the question a status chip actually asks. */
  list: (params: { open?: boolean; projectId?: string | number; from?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.open) q.set("open", "1");
    if (params.projectId != null) q.set("project_id", String(params.projectId));
    if (params.from) q.set("from", params.from);
    const qs = q.toString();
    return http.get<{ data: BackgroundJob[]; meta: { total: number; open: number } }>(
      `/api/jobs${qs ? `?${qs}` : ""}`,
    );
  },
  get: (id: string) => http.get<BackgroundJob>(`/api/jobs/${encodeURIComponent(id)}`),
};
