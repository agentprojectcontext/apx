import { projectTone } from "../data/identity.ts";

/** A project's name as a small tag in its own colour (the same tone as its tile), in a chat or routine row. */
export function ProjectBadge({ id, name }: { id: string; name: string }) {
  return <span className={`projbadge is-${projectTone(id)}`}>{name}</span>;
}
