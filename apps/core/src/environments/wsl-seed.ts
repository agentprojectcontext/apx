import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ComputerHost } from "./host.ts";
import type { ComputerProgress } from "./lifecycle.ts";
import type { LimaRun } from "./lima-process.ts";

/** Debian's own WSL image as Microsoft's distribution list pins it. */
const DEBIAN_WSL = {
  version: "1.26.0.0",
  x86_64: {
    url: "https://salsa.debian.org/debian/WSL/-/jobs/9606244/artifacts/raw/Debian_WSL_AMD64_v1.26.0.0.wsl",
    sha256: "5ec7dc68216e75d1d4d4761474e99d8461a98d316537110314b137122a879e0f",
  },
  aarch64: {
    url: "https://salsa.debian.org/debian/WSL/-/jobs/9606244/artifacts/raw/Debian_WSL_ARM64_v1.26.0.0.wsl",
    sha256: "09120df4fadc36fb2a0f7298e197785e6f599f12aaf95d43cba07a8ac7fb316b",
  },
};

const SEED_DISTRO = "apx-computer-seed";

/**
 * What Lima needs in a WSL root filesystem (an SSH server, sudo, systemd) and what keeps the guest apart from Windows:
 * no Windows programs from inside (interop) and no Windows PATH. Drives stay mounted for Lima's own boot files, behind
 * /mnt, which security.sh closes to every user but root.
 */
const SEED_SCRIPT = `set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends systemd systemd-sysv dbus openssh-server sudo iptables sshfs ca-certificates curl python3 nftables iproute2 procps
grep -qx user_allow_other /etc/fuse.conf 2>/dev/null || echo user_allow_other >> /etc/fuse.conf
printf '[boot]\\nsystemd=true\\n[interop]\\nenabled=false\\nappendWindowsPath=false\\n[user]\\ndefault=root\\n' > /etc/wsl.conf
apt-get clean
rm -rf /var/lib/apt/lists/*
`;

/** WSL's mirrored networking shares Windows' own localhost with the guest, where the core listens: refused. */
export function mirroredNetworking(config = path.join(os.homedir(), ".wslconfig")): boolean {
  try {
    return /^\s*networkingMode\s*=\s*mirrored\s*$/im.test(fs.readFileSync(config, "utf8"));
  } catch {
    return false;
  }
}

async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * The root filesystem Lima imports on Windows, built once on this host: Debian's WSL image with the packages above,
 * exported as a tar. Returns its path; a seed already built is reused.
 */
export async function wslSeed(
  host: ComputerHost,
  root: string,
  wsl: LimaRun,
  signal: AbortSignal,
  progress: (value: ComputerProgress) => void,
  download: typeof fetch = fetch,
): Promise<string> {
  // Named after its recipe too, so a change to SEED_SCRIPT builds it again.
  const recipe = createHash("sha256").update(SEED_SCRIPT).digest("hex").slice(0, 8);
  const seed = path.join(root, `debian-wsl-${DEBIAN_WSL.version}-${recipe}.tar`);
  if (fs.existsSync(seed)) return seed;
  await wsl(["--status"], { signal, timeout: 30_000 }).catch(() => {
    throw new Error(
      'Computer needs WSL 2: run "wsl --install --no-distribution" in an administrator PowerShell, restart Windows and try again',
    );
  });
  const source = DEBIAN_WSL[host.arch];
  const image = path.join(root, `debian-wsl-${DEBIAN_WSL.version}.tar.gz`);
  const staging = fs.mkdtempSync(path.join(root, ".wsl-seed-"));
  try {
    if (!fs.existsSync(image) || (await fileSha256(image)) !== source.sha256) {
      const partial = path.join(staging, "debian.tar.gz");
      const response = await download(source.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]) });
      if (!response.ok || !response.body) throw new Error(`Debian download failed: HTTP ${response.status}`);
      const file = await fs.promises.open(partial, "wx", 0o600);
      const hash = createHash("sha256");
      let downloaded = 0;
      try {
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          downloaded += chunk.length;
          if (downloaded > 1024 * 1024 * 1024) throw new Error("Debian image exceeds download limit");
          hash.update(chunk);
          await file.writeFile(chunk);
          progress({ step: "guest", downloaded, total: Number(response.headers.get("content-length")) || undefined });
        }
      } finally {
        await file.close();
      }
      if (hash.digest("hex") !== source.sha256)
        throw new Error("Debian image checksum does not match the pinned release");
      fs.renameSync(partial, image);
    }
    progress({ step: "guest" });
    // A seed left by an interrupted build is dropped first.
    await wsl(["--unregister", SEED_DISTRO], { signal, timeout: 60_000 }).catch(() => {});
    await wsl(["--import", SEED_DISTRO, path.join(staging, "distro"), image, "--version", "2"], {
      signal,
      timeout: 10 * 60_000,
    });
    try {
      await wsl(["-d", SEED_DISTRO, "-u", "root", "--", "sh", "-s"], {
        input: SEED_SCRIPT,
        signal,
        timeout: 15 * 60_000,
      });
      await wsl(["--terminate", SEED_DISTRO], { signal, timeout: 60_000 });
      const exported = path.join(staging, "seed.tar");
      await wsl(["--export", SEED_DISTRO, exported], { signal, timeout: 10 * 60_000 });
      fs.renameSync(exported, seed);
    } finally {
      await wsl(["--unregister", SEED_DISTRO], { timeout: 60_000 }).catch(() => {});
    }
    return seed;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Lima's user, its SSH key and the path its readiness check reads, as cloud-init sets them up elsewhere: plain mode
 * skips the WSL boot script that would, and provisioning still runs there, with Lima's variables.
 */
const WSL_USER_STEP = `  - mode: system
    script: |
      #!/bin/sh
      set -eu
      id "$LIMA_CIDATA_USER" >/dev/null 2>&1 || useradd -u "$LIMA_CIDATA_UID" -c "$LIMA_CIDATA_COMMENT" -d "$LIMA_CIDATA_HOME" -m -s /bin/bash "$LIMA_CIDATA_USER"
      install -d -m 700 -o "$LIMA_CIDATA_USER" -g "$LIMA_CIDATA_USER" "$LIMA_CIDATA_HOME/.ssh"
      install -m 600 -o "$LIMA_CIDATA_USER" -g "$LIMA_CIDATA_USER" "$LIMA_CIDATA_MNT/ssh_authorized_keys" "$LIMA_CIDATA_HOME/.ssh/authorized_keys"
      echo "$LIMA_CIDATA_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/99_lima_sudoers
      chmod 440 /etc/sudoers.d/99_lima_sudoers
      [ "$LIMA_CIDATA_MNT" = /mnt/lima-cidata ] || ln -sfn "$LIMA_CIDATA_MNT" /mnt/lima-cidata
`;

/** The instance template for WSL: the guest template's settings over the local seed instead of a VM disk image. */
export function wslTemplate(template: string, seed: string): string {
  const body = template
    .replace(/^images:\n(?:\s+.*\n)+/m, "")
    .replace(/^provision:\n/m, `provision:\n${WSL_USER_STEP}`);
  return `vmType: wsl2\nmountType: wsl2\nimages:\n  - location: ${JSON.stringify(seed.replaceAll("\\", "/"))}\n${body}`;
}
