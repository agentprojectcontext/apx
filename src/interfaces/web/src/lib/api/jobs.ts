import { http } from "../http";
import type { BackgroundJob } from "../../types/daemon";

/** Work agents left running: what is open, and the one way to end it early. */
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
  /** Stop it: the work is aborted, the record closes as `cancelled`, and the
   *  agent that asked to be woken IS woken — told it was cancelled, not that it
   *  failed, and told not to start it again. That third step is what makes this
   *  safe to offer: an agent waiting on a job is, by construction, in no turn at
   *  all, so cancelling silently would leave it waiting forever. */
  cancel: (id: string, reason?: string) =>
    http.post<{ ok: boolean; stopped: boolean; woken: boolean; job: BackgroundJob }>(
      `/api/jobs/${encodeURIComponent(id)}/cancel`,
      reason ? { reason } : {},
    ),
};
