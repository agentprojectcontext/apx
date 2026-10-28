import { useState } from "react";
import { Text, View } from "react-native";
import type { Part } from "../../../../packages/protocol/src/domain.ts";
import { t } from "../i18n";
import { Button } from "./kit";
import { makeStyles } from "./theme";

export function BrowserReview({
  review,
  source,
}: {
  review: NonNullable<Extract<Part, { type: "input" }>["browser"]>;
  source: string;
}) {
  const s = useStyles();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={s.wrap}>
      <Text selectable style={s.label}>
        {t("browserOrigin")}: {review.origin}
      </Text>
      {review.title || review.tab_number ? (
        <Text style={s.help}>
          {review.title}
          {review.title && review.tab_number ? " · " : ""}
          {review.tab_number ? t("browserTabNumber", { n: review.tab_number }) : ""}
        </Text>
      ) : null}
      <Text style={s.label}>{t("browserSource")}</Text>
      <Text selectable style={s.code}>
        {source}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        accessibilityExpanded={expanded}
        label={t("browserTechnical")}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <View style={s.wrap}>
          <Text selectable style={s.help}>
            {t("browserDocument")}: {review.document}
          </Text>
          {review.path ? (
            <Text selectable style={s.help}>
              {t("browserFile")}: {review.path}
            </Text>
          ) : null}
          {review.sha256 ? (
            <Text selectable style={s.help}>
              {t("browserHash")}: {review.sha256}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function BrowserHelp() {
  const s = useStyles();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={s.wrap}>
      <Text style={s.help}>{t("browserScopeHelp")}</Text>
      <Text style={s.help}>• {t("browserTabHelp")}</Text>
      <Text style={s.help}>• {t("browserTurnHelp")}</Text>
      <Button
        size="sm"
        variant="secondary"
        accessibilityExpanded={expanded}
        label={t("browserMore")}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <>
          <Text style={s.help}>{t("browserSafety")}</Text>
          <Text style={s.help}>{t("browserManage")}</Text>
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  wrap: { gap: 8 },
  label: { color: theme.fg, fontSize: 13, fontWeight: "600" },
  help: { color: theme.fgMuted, fontSize: 13 },
  code: { color: theme.fg, fontSize: 12, fontFamily: "monospace" },
}));
