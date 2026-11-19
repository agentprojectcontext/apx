# APX in a container: a release's server bundle (core, panel, `apx` and its own Node, the one install.sh installs),
# checked against its .sha256. Run it with compose.yaml; docs: Install › Docker.
#   docker build -t apx .                                  the newest APX 2 release
#   docker build --build-arg APX_VERSION=2.16.0 -t apx .   a given one
#   docker run -d -p 127.0.0.1:7440:7440 -v apx-data:/data -e APX_TOKEN=<long random string> apx
FROM debian:bookworm-slim

ARG APX_VERSION=""
ARG APX_REPO=agentprojectcontext/apx
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client tini \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    arch=$(case "${TARGETARCH:-$(dpkg --print-architecture)}" in amd64) echo x64 ;; arm64) echo arm64 ;; *) echo unsupported ;; esac); \
    [ "$arch" != unsupported ] || { echo "APX runs on amd64 and arm64" >&2; exit 1; }; \
    version="$APX_VERSION"; \
    if [ -z "$version" ]; then \
      version=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$APX_REPO/releases/latest" \
        | grep -oE '/v2\.[0-9]+\.[0-9]+$' | cut -c3-); \
      [ -n "$version" ] || { echo "no APX 2 release is marked latest; pass --build-arg APX_VERSION=2.x.y" >&2; exit 1; }; \
    fi; \
    name="apx-core-$version-linux-$arch.tar.gz"; \
    base="https://github.com/$APX_REPO/releases/download/v$version"; \
    cd /tmp; \
    curl -fsSLO "$base/$name"; \
    curl -fsSL "$base/$name.sha256" | awk '{print $1"  '"$name"'"}' | sha256sum -c -; \
    tar -xzf "$name" -C /opt; rm "$name"; \
    printf '#!/bin/sh\nexec /opt/apx/node/bin/node --disable-warning=ExperimentalWarning /opt/apx/apps/terminal/src/main.ts "$@"\n' >/usr/local/bin/apx; \
    chmod 755 /usr/local/bin/apx; \
    ln -s /opt/apx/node/bin/node /usr/local/bin/node; \
    useradd --create-home --uid 1000 apx; \
    mkdir -p /data /projects; chown apx:apx /data /projects

# Listening beyond the container needs APX_TOKEN: the core refuses an open port without it. Updates come as a new
# image, never from inside. The home is a folder in the volume because the core keeps its start lock beside it.
ENV APX_HOME=/data/apx APX_HOST=0.0.0.0 APX_PORT=7440 APX_SECRETS=file APX_UPDATES=off APX_RUNTIME_SKILLS=off
USER apx
WORKDIR /projects
VOLUME ["/data"]
EXPOSE 7440
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD curl -fsS "http://127.0.0.1:${APX_PORT}/health" >/dev/null || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "/opt/apx/apps/core/src/main.ts"]
