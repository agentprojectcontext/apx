/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // shadcn-new tokens. We use CSS vars so theme switching is one root
        // class flip; no Tailwind config edits to add a theme.
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card:       "hsl(var(--card) / <alpha-value>)",
        muted:      "hsl(var(--muted) / <alpha-value>)",
        "muted-fg": "hsl(var(--muted-foreground) / <alpha-value>)",
        accent:     "hsl(var(--accent) / <alpha-value>)",
        "accent-fg":"hsl(var(--accent-foreground) / <alpha-value>)",
        border:     "hsl(var(--border) / <alpha-value>)",
        ring:       "hsl(var(--ring) / <alpha-value>)",
        primary:    "hsl(var(--primary) / <alpha-value>)",
        "primary-fg":"hsl(var(--primary-foreground) / <alpha-value>)",
        destructive:"hsl(var(--destructive) / <alpha-value>)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto"],
        mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
