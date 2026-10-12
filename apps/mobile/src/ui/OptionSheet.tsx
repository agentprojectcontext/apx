import { Icon } from "./Icon";
import { BottomSheet, ListRow } from "./kit";
import { useTheme } from "./theme";

export type Option<T extends string> = { value: T; label: string; sub?: string; leading?: React.ReactNode };

/** Pick one from a short list in a bottom sheet; the current one is checked, a pick closes it. */
export function OptionSheet<T extends string>({
  title,
  options,
  value,
  onPick,
  onClose,
}: {
  title: string;
  options: Array<Option<T>>;
  value?: T;
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <BottomSheet title={title} onClose={onClose}>
      {options.map((option) => (
        <ListRow
          key={option.value}
          label={option.label}
          sub={option.sub}
          leading={option.leading}
          chevron={false}
          trailing={option.value === value ? <Icon name="Check" size={18} color={theme.brand} /> : undefined}
          onPress={() => {
            onClose();
            if (option.value !== value) onPick(option.value);
          }}
        />
      ))}
    </BottomSheet>
  );
}
