import type { ModelAnnouncement } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { closeCard } from "../data/cornerCards.ts";
import type { Language, T } from "../i18n/index.ts";
import { go } from "./nav.ts";
import type { Notice } from "./notices.tsx";

export function modelNotices(launches: ModelAnnouncement[], closed: string[], language: Language, t: T): Notice[] {
  const words = language === "es" ? "es" : "en";
  return launches
    .filter((launch) => !closed.includes(launch.id))
    .map((launch) => ({
      id: `model:${launch.id}`,
      tone: "neutral",
      icon: (size) => <Icons.Sparkles size={size} />,
      title: launch.name,
      description: t("modelNotice.description", {
        date: new Intl.DateTimeFormat(language === "es" ? "es-AR" : "en-US", {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(`${launch.date}T00:00:00Z`)),
        summary: launch.summary[words],
        access: launch.access[words],
        integration: t(launch.integration === "verified" ? "modelNotice.verified" : "modelNotice.pending"),
      }),
      link: { label: t("modelNotice.source"), href: launch.source },
      action: t("modelNotice.review"),
      keep: true,
      onAction: () => go.config("engines"),
      onClose: () => closeCard({ modelAnnouncements: [...new Set([...closed, launch.id])] }),
    }));
}
