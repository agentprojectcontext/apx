/// <reference types="vite/client" />

interface Window {
  APXAndroid?: {
    openOptions(): void;
    notificationsEnabled(): boolean;
    openNotificationSettings(): void;
  };
}

// Vite's client types declare the ambient modules for asset imports
// (`*.webp`, `*.png`, `*.svg`, …) that resolve to a URL string at build time —
// e.g. AgentAvatar.tsx importing the coding-CLI brand logos. Without this
// reference `tsc --noEmit` (the pre-push web typecheck) fails with TS2307.
