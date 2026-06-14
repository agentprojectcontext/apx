import { Construction } from "lucide-react";
import { Section } from "../../components/Section";
import { t } from "../../i18n";

export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <Section title={title} description={t("settings_ui.base_menu_view")}>
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 py-16 text-center">
        <Construction className="size-8 text-muted-fg" />
        <div>
          <p className="text-sm font-medium">{t("settings_ui.coming_soon")}</p>
          {note && <p className="mt-1 max-w-md text-xs text-muted-fg">{note}</p>}
        </div>
      </div>
    </Section>
  );
}
