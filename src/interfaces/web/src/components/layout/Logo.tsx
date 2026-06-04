import { LOGO, type LogoVariant } from "../../constants";
import { useTheme } from "../../hooks/useTheme";

const FULL_ASPECT = 1367 / 458;
const VERTICAL_ASPECT = 735 / 1016;

export function Logo({
  size = 32,
  title = "APX",
  variant = "icon",
}: {
  size?: number;
  title?: string;
  variant?: LogoVariant;
}) {
  const { theme } = useTheme();
  const src = LOGO[variant][theme];

  if (variant === "full") {
    const height = size;
    const width = Math.round(size * FULL_ASPECT);
    return (
      <img
        src={src}
        alt={title}
        width={width}
        height={height}
        className="block object-contain"
        draggable={false}
      />
    );
  }

  if (variant === "vertical") {
    const width = size;
    const height = Math.round(size / VERTICAL_ASPECT);
    return (
      <img
        src={src}
        alt={title}
        width={width}
        height={height}
        className="block object-contain"
        draggable={false}
      />
    );
  }

  return (
    <img
      src={src}
      alt={title}
      width={size}
      height={size}
      className="block object-contain"
      draggable={false}
    />
  );
}
