import { Construction } from "lucide-react";
import { Section } from "../../components/Section";

export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <Section title={title} description="Vista del menú Base (espacio general).">
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 py-16 text-center">
        <Construction className="size-8 text-muted-fg" />
        <div>
          <p className="text-sm font-medium">Próximamente</p>
          {note && <p className="mt-1 max-w-md text-xs text-muted-fg">{note}</p>}
        </div>
      </div>
    </Section>
  );
}
