// An errand's place with its categories filled: the agent's choice wins, the keyword fallback covers the rest, so no
// errand is invisible to the search (rules/ERRANDS_ON_THE_WAY.md#errands-and-their-place).
import type { ErrandPlace, Task } from "@apx/protocol";
import { classifyErrand } from "./categories.ts";

export function errandPlace(
  place: ErrandPlace | undefined,
  title: string,
  description?: string,
): ErrandPlace | undefined {
  if (place?.at || place?.categories.length) return place;
  const categories = classifyErrand(title, description).slice(0, 4);
  if (!categories.length) return place;
  return { ...place, categories };
}

/** What the search uses for a task: its stored place, classified now when it has none. */
export const placeOfTask = (t: Pick<Task, "place" | "title" | "description">): ErrandPlace | undefined =>
  errandPlace(t.place, t.title, t.description);
