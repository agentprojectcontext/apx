import type { Part } from "@apx/protocol";
import { useT } from "../../i18n/index.ts";

export function BrowserReview({
  review,
  source,
}: {
  review: NonNullable<Extract<Part, { type: "input" }>["browser"]>;
  source: string;
}) {
  const t = useT();
  return (
    <div className="inputcard__browser">
      <p className="inputcard__prompt">
        <strong>{t("input.browserOrigin")}: </strong>
        {review.origin}
      </p>
      {(review.title || review.tab_number) && (
        <p className="resd__note">
          {review.title}
          {review.title && review.tab_number ? " · " : ""}
          {review.tab_number ? t("input.browserTabNumber", { n: review.tab_number }) : ""}
        </p>
      )}
      <textarea className="inputcard__detail" aria-label={t("input.browserSource")} rows={6} readOnly value={source} />
      <details className="resd__note">
        <summary>{t("input.browserTechnical")}</summary>
        <p>
          {t("input.browserDocument")}: <code>{review.document}</code>
        </p>
        {review.path && (
          <p>
            {t("input.browserFile")}: <code>{review.path}</code>
          </p>
        )}
        {review.sha256 && (
          <p>
            {t("input.browserHash")}: <code>{review.sha256}</code>
          </p>
        )}
      </details>
    </div>
  );
}

export function BrowserHelp({ id }: { id: string }) {
  const t = useT();
  return (
    <div className="resd__note">
      <div id={id}>
        <p>{t("input.browserScopeHelp")}</p>
        <ul>
          <li>{t("input.browserTabHelp")}</li>
          <li>{t("input.browserTurnHelp")}</li>
        </ul>
      </div>
      <details>
        <summary>{t("input.browserMore")}</summary>
        <p>{t("input.browserSafety")}</p>
        <p>{t("input.browserManage")}</p>
      </details>
    </div>
  );
}
