import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { ErrandPlace } from "../../../../packages/protocol/src/car.ts";
import {
  CATEGORIES,
  CATEGORY_KEY,
  type PlaceForm,
  placeForm,
  placeFromForm,
  samePlace,
  toggleCategory,
} from "../car/model";
import { t } from "../i18n";
import { Card, Chip, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

/** Where an errand can be done: the kinds of shop (best first) as chips, and a brand or chain. */
export function ErrandPlaceFields({
  value,
  onChange,
  onBrandDone,
}: {
  value: PlaceForm;
  onChange: (form: PlaceForm) => void;
  /** The brand field lost focus or was sent: the task's page saves then. */
  onBrandDone?: () => void;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  return (
    <Card style={s.card}>
      <Text style={type.meta}>{t("carPlaceTitle")}</Text>
      <Text style={[type.small, s.help]}>{t("carPlaceHelp")}</Text>
      <View style={s.chips}>
        {CATEGORIES.map((category) => (
          <Chip
            key={category}
            label={t(CATEGORY_KEY[category])}
            selected={value.categories.includes(category)}
            onPress={() => onChange({ ...value, categories: toggleCategory(value.categories, category) })}
          />
        ))}
      </View>
      <TextInput
        value={value.brand}
        onChangeText={(brand) => onChange({ ...value, brand })}
        onEndEditing={onBrandDone}
        placeholder={t("carPlaceBrand")}
        placeholderTextColor={theme.fgSubtle}
        accessibilityLabel={t("carPlaceBrand")}
        maxLength={60}
        submitBehavior="blurAndSubmit"
        style={s.input}
      />
    </Card>
  );
}

/** The task page's place: a pick saves at once, the brand when its field is left. */
export function ErrandPlaceEditor({
  place,
  save,
}: {
  place: ErrandPlace | undefined;
  save: (place: ErrandPlace | null) => void;
}) {
  const [form, setForm] = useState(() => placeForm(place));
  const commit = (next: PlaceForm) => {
    const saved = placeFromForm(next, place);
    if (!samePlace(saved, place)) save(saved);
  };
  return (
    <ErrandPlaceFields
      value={form}
      onChange={(next) => {
        setForm(next);
        if (next.categories !== form.categories) commit(next);
      }}
      onBrandDone={() => commit(form)}
    />
  );
}

const useStyles = makeStyles((theme) => ({
  card: { gap: 8 },
  help: { marginTop: -4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  input: {
    color: theme.fg,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: theme.fill,
  },
}));
