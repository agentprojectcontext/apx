import type { Result } from "@apx/protocol";
import { EngineIcon } from "@apx/ui";
import { quickWindows } from "./engineUsageModel.ts";

type Report = Result<"engines.usage">;

export default function EngineUsageQuick({ report }: { report: Report | undefined }) {
  return (
    <span className="engine-usage-quick" aria-hidden="true">
      {quickWindows(report).map(({ engine, remaining }) => (
        <span className="engine-usage-quick__item" key={engine.id} data-testid="engine-usage-quick">
          <EngineIcon engine={engine.id} tile size={16} />
          <span>{remaining}%</span>
        </span>
      ))}
    </span>
  );
}
