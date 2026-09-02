/// <reference types="vite/client" />

interface Window {
  APXAndroid?: {
    openOptions(): void;
    notificationsEnabled(): boolean;
    openNotificationSettings(): void;
    // Which kinds of news the APK may ring for, as a JSON string of
    // `{ channel: boolean }` — a WebView bridge carries primitives only.
    // Optional because they are: an APK installed before this shipped has a
    // bridge without them, and the panel has to render against that phone too.
    notifyChannels?(): string;
    setNotifyChannel?(channel: string, on: boolean): void;
  };
}

// Vite's client types declare the ambient modules for asset imports
// (`*.webp`, `*.png`, `*.svg`, …) that resolve to a URL string at build time —
// e.g. AgentAvatar.tsx importing the coding-CLI brand logos. Without this
// reference `tsc --noEmit` (the pre-push web typecheck) fails with TS2307.
