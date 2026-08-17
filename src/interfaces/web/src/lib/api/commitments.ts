import { http, unwrapPage } from "../http";

export type CommitmentState = "open" | "kept" | "missed";

export type CommitmentEntry = {
  id: string;
  created_at: string;
  updated_at: string;
  state: CommitmentState;
  counterparty: string;
  body: string;
  promised_at: string;
  due: string | null;
  origin_channel: string | null;
  origin_message_ref: string | null;
  note?: string | null;
  renegotiated_count?: number;
  history: { due: string | null; moved_at: string; note: string | null }[];
};

export type GlobalCommitmentEntry = CommitmentEntry & {
  project_id: string | number;
  project_name: string;
};

type ListOpts = {
  state?: CommitmentState | "all";
  counterparty?: string;
  overdue?: boolean;
  limit: number;
  offset: number;
};

function qs(o: ListOpts): string {
  const p = new URLSearchParams();
  if (o.state) p.set("state", o.state);
  if (o.counterparty) p.set("counterparty", o.counterparty);
  if (o.overdue) p.set("overdue", "1");
  p.set("limit", String(o.limit));
  p.set("offset", String(o.offset));
  return p.toString();
}

export const Commitments = {
  globalPage: (o: ListOpts) =>
    http.get<unknown>(`/api/commitments?${qs(o)}`).then((b) => unwrapPage<GlobalCommitmentEntry>(b)),
  listPage: (pid: string, o: ListOpts) =>
    http.get<unknown>(`/api/projects/${pid}/commitments?${qs(o)}`).then((b) => unwrapPage<CommitmentEntry>(b)),
  add: (pid: string, body: { counterparty: string; body: string; due?: string | null }) =>
    http.post<CommitmentEntry>(`/api/projects/${pid}/commitments`, body),
  kept: (pid: string, id: string, note?: string) =>
    http.post<CommitmentEntry>(`/api/projects/${pid}/commitments/${id}/kept`, { note }),
  missed: (pid: string, id: string, note?: string) =>
    http.post<CommitmentEntry>(`/api/projects/${pid}/commitments/${id}/missed`, { note }),
  renegotiate: (pid: string, id: string, due: string, note?: string) =>
    http.post<CommitmentEntry>(`/api/projects/${pid}/commitments/${id}/renegotiate`, { due, note }),
};
