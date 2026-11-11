// What a project's overview counts and lists, apart from how it shows it, so it is tested on its own.
import type { Result, Task, Thread } from "@apx/protocol";
import { taskGroupOf } from "@apx/protocol/task-groups";

/** What waits for the owner here: tasks with a question or a review for them, and chats asking them something. */
export type Waiting = { tasks: Task[]; chats: Thread[]; open: number };

const NONE: ReadonlySet<string> = new Set();

/** `inBase`: the base project, whose tasks are the ones with no project. */
export function waitingOf(tasks: readonly Task[], chats: readonly Thread[], pid: string, inBase: boolean): Waiting {
  const here = (p: string | undefined) => (inBase ? !p : p === pid);
  const mine = tasks.filter((x) => x.state === "open" && here(x.project_id));
  return {
    tasks: mine
      // Waiting for the owner wins over a running turn, so which chats run does not change it.
      .filter((x) => taskGroupOf(x, NONE) === "blocked")
      .sort((a, b) => b.activity_at.localeCompare(a.activity_at)),
    chats: chats.filter((th) => th.state === "input-required"),
    open: mine.length,
  };
}

type Gaps = Pick<Result<"projects.helper_review">, "missing" | "agent_gaps">;
/** One line per thing the project or one of its agents lacks, as message keys and the agent's name. */
export type Gap =
  | { key: "helper.gap.goal" | "helper.gap.start" }
  | { key: "helper.gap.agentRole" | "helper.gap.agentInstructions" | "helper.gap.agentBoth"; name: string };

export function helperGaps(review: Gaps): Gap[] {
  return [
    ...(review.missing.includes("goal") ? [{ key: "helper.gap.goal" as const }] : []),
    ...(review.missing.includes("first_result") ? [{ key: "helper.gap.start" as const }] : []),
    ...review.agent_gaps.map((a) => ({
      key:
        a.missing.length > 1
          ? ("helper.gap.agentBoth" as const)
          : a.missing[0] === "role"
            ? ("helper.gap.agentRole" as const)
            : ("helper.gap.agentInstructions" as const),
      name: a.name,
    })),
  ];
}
