import { Section } from "../../components/Section";
import { ProjectTimeline } from "../../components/chat/ProjectTimeline";
import { t } from "../../i18n";

// The timeline as a place you GO, not only a panel you scroll past.
//
// It started life as one block on the Overview, next to the team brain. That is
// the right place to GLANCE at it — you are already there, and a stalled step
// beside the agent that owns it is worth seeing together. It is the wrong place
// to WORK in it: the question "what did we leave open this month" wants the
// whole width and a URL you can come back to, and on the Overview it was a
// third of a screen you had to scroll to and could not link to.
//
// So both, and they are the same component. This screen gives it the room and
// the address; the Overview keeps the glance.
export function TimelineTab({ pid }: { pid: string }) {
  return (
    <Section
      title={t("milestones.title")}
      description={t("milestones.description")}
      className="!p-4"
    >
      <ProjectTimeline pid={pid} />
    </Section>
  );
}
