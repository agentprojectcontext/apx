# The box `pnpm remote` runs preflight and verify in, on a Linux machine of the owner's (rules/TESTING.md#remote-runner):
# Playwright's Chromium and its system packages, Node and pnpm at the repo's versions, Electron's GTK runtime, and a
# virtual screen anyone can watch through the browser (Xvfb + openbox + noVNC). The code is mounted, not copied.
ARG PLAYWRIGHT=1.63.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT}-noble

ARG NODE=24.11.0
ARG PNPM=11.11.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils git xvfb openbox x11vnc novnc websockify \
      libgtk-3-0t64 libnss3 libxss1 libasound2t64 libsecret-1-0 fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/* \
 && arch=$(dpkg --print-architecture | sed 's/amd64/x64/') \
 && curl -fsSL "https://nodejs.org/dist/v${NODE}/node-v${NODE}-linux-${arch}.tar.xz" | tar -xJ -C /usr/local --strip-components=1 \
 && npm install -g "pnpm@${PNPM}" \
 && node --version && pnpm --version

COPY entry.sh /usr/local/bin/apx-remote-entry
RUN chmod +x /usr/local/bin/apx-remote-entry
# No core started in the box reports to APX's telemetry: test installs are not people (DECISIONS.md#d-092).
ENV DISPLAY=:99 APX_SECRETS=file APX_TELEMETRY=off DO_NOT_TRACK=1 PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright
WORKDIR /work
ENTRYPOINT ["apx-remote-entry"]
