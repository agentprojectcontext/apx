import { ApxProvider, StepList } from "@apx/ui";

export function RunReport() {
  return (
    <StepList
      steps={[
        { label: "CRM", detail: "list pulled · 52 accounts" },
        { label: "Enrichment", detail: "3 lookalike segments pulled" },
        { label: "LinkedIn", detail: "4 profiles skipped · recently contacted" },
        { label: "Sequencer", detail: "36 drafts queued · 0 sent" },
      ]}
    />
  );
}

export function MixedStatus() {
  return (
    <StepList
      steps={[
        { label: "Calendar", detail: "venue booked for Oct 14" },
        { label: "Email", detail: "invite sent to 12 people" },
        { label: "Catering", detail: "waiting on quote", status: "running" },
        { label: "Slides", detail: "API rate-limited", status: "failed" },
        { label: "Follow-up", detail: "tomorrow 9:00", status: "pending" },
      ]}
    />
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12 }}>
      <StepList
        steps={[
          { label: "Render", detail: "reel-26 · 1080p" },
          { label: "Upload", detail: "subiendo", status: "running" },
        ]}
      />
    </ApxProvider>
  );
}
