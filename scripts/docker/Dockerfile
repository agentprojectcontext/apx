# The APX daemon in a container, from a release's daemon bundle (the same one install.sh installs).
#
#   docker build -f scripts/docker/Dockerfile --build-arg BUNDLE=out/apx-core-2.2.0-linux-x64.tar.gz -t apx .
#   docker run -d --name apx -p 7440:7440 -v apx-data:/data -e APX_TOKEN=<a long random string> apx
#   docker exec -it apx apx pair            # pair the desktop app or the phone with it
#
# It listens on every interface of the container, so it refuses to start without APX_TOKEN. Updates come with a
# new image (APX_UPDATES=off): the bundle never rewrites itself inside a container.
FROM debian:bookworm-slim
ARG BUNDLE
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 apx \
 && mkdir -p /data && chown apx:apx /data
# ADD unpacks a local .tar.gz: the bundle's apx/ folder lands in /opt/apx.
ADD ${BUNDLE} /opt/
RUN printf '#!/bin/sh\nexec /opt/apx/node/bin/node --disable-warning=ExperimentalWarning /opt/apx/apps/terminal/src/main.ts "$@"\n' \
      > /usr/local/bin/apx \
 && chmod 755 /usr/local/bin/apx
USER apx
WORKDIR /opt/apx
ENV APX_HOME=/data APX_HOST=0.0.0.0 APX_PORT=7440 APX_SECRETS=file APX_UPDATES=off APX_RUNTIME_SKILLS=off
VOLUME /data
EXPOSE 7440
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:7440/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "/opt/apx/node/bin/node", "--disable-warning=ExperimentalWarning", "/opt/apx/apps/core/src/main.ts"]
