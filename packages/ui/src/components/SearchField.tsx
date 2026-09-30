import { Search } from "lucide-react";
import { forwardRef } from "react";
import { Input, type InputProps } from "./Input";
import { Kbd } from "./Kbd";

export interface SearchFieldProps extends Omit<InputProps, "leadingIcon" | "trailing" | "type"> {
  /** Shortcut hint shown at the end, e.g. ["⌘", "K"]. */
  shortcut?: string[];
}

/** Search box for sidebars and lists: magnifier icon, optional ⌘K hint. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { shortcut, placeholder = "Search", ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="search"
      placeholder={placeholder}
      leadingIcon={<Search size={15} />}
      trailing={shortcut ? <Kbd keys={shortcut} /> : undefined}
      {...rest}
    />
  );
});
