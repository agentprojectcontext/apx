#!/usr/bin/env bash
# Throwaway servers for install tests, on any Docker host (rules/RELEASE.md#testing). Everything carries apx-test=1.
#   e2e/install/servers.sh build <public-key-file>   build apx-test-server and apx-test-server-v1
#   e2e/install/servers.sh feed <folder…>            a release feed (scripts/install/feed.ts) at http://apx-feed:7480
#   e2e/install/servers.sh up <name> <ssh-port> [v1] a fresh server; ssh -p <ssh-port> tester@<docker host>
#   e2e/install/servers.sh clean                     remove all of it
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
case "${1:-}" in
  build)
    cp "${2:?public key file}" "$here/authorized_keys"
    docker build -q --label apx-test=1 -t apx-test-server -f "$here/Dockerfile.server" "$here"
    docker build -q --label apx-test=1 -t apx-test-server-v1 -f "$here/Dockerfile.v1" "$here"
    rm -f "$here/authorized_keys"
    ;;
  feed)
    shift
    docker network create --label apx-test=1 apx-test >/dev/null 2>&1 || true
    docker rm -f apx-feed >/dev/null 2>&1 || true
    mounts=() dirs=()
    for d in "$@"; do mounts+=(-v "$(cd "$d" && pwd):/feed/$(basename "$d"):ro"); dirs+=("/feed/$(basename "$d")"); done
    docker run -d --name apx-feed --label apx-test=1 --network apx-test -p 7480:7480 -v "$repo:/w:ro" -w /w "${mounts[@]}" \
      node:24-bookworm node scripts/install/feed.ts "${dirs[@]}" >/dev/null
    echo "feed: http://apx-feed:7480 for the servers, http://<docker host>:7480 for others"
    ;;
  up)
    name="${2:?name}" port="${3:?ssh port}" image=apx-test-server
    [ "${4:-}" = v1 ] && image=apx-test-server-v1
    docker network create --label apx-test=1 apx-test >/dev/null 2>&1 || true
    docker rm -f "$name" >/dev/null 2>&1 || true
    # systemd as PID 1 without --privileged: its own cgroup namespace, remounted writable inside the container.
    docker run -d -t --name "$name" --hostname "$name" --label apx-test=1 --network apx-test --cgroupns=private \
      --tmpfs /run --tmpfs /run/lock --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
      --cap-add SYS_ADMIN -p "$port:22" "$image" sh -c "mount -o remount,rw /sys/fs/cgroup && exec /sbin/init" >/dev/null
    for _ in $(seq 30); do docker exec "$name" systemctl is-system-running 2>/dev/null | grep -qE "running|degraded" && break; sleep 1; done
    echo "$name: ssh -p $port tester@<docker host> ($(docker exec "$name" systemctl is-system-running))"
    ;;
  clean)
    docker ps -aq --filter label=apx-test=1 | xargs -r docker rm -f >/dev/null
    docker network rm apx-test >/dev/null 2>&1 || true
    docker images -q --filter label=apx-test=1 | xargs -r docker rmi -f >/dev/null 2>&1 || true
    docker rmi apx-test-server-v1 apx-test-server >/dev/null 2>&1 || true
    ;;
  *) sed -n 2,6p "$0"; exit 1 ;;
esac
