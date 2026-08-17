import { http } from "../http";

/**
 * The super-agent's own notebook (~/.apx/memory.md).
 *
 * Distinct from project memory (.apc/memory.md) and from each agent's memory.
 * This is the one that ships in EVERY prompt on every channel, which is why it
 * reports its own token cost.
 */
export interface NotebookInfo {
  body: string;
  path: string;
  chars: number;
  approx_tokens: number;
  entries: number;
  /** How many entries were written by memory consolidation rather than by hand. */
  consolidated: number;
}

export const Notebook = {
  get: () => http.get<NotebookInfo>("/api/notebook"),
  put: (body: string) => http.put<{ ok: true } & Omit<NotebookInfo, "body">>("/api/notebook", { body }),
};
