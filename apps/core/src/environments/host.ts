import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProgram } from "../programs.ts";
import { mirroredNetworking } from "./wsl-seed.ts";

export type VmType = "vz" | "qemu" | "wsl2";
export type GuestArch = "aarch64" | "x86_64";

/** How this host runs the computer: Lima's own driver for its OS, the pinned Lima build for it and the tools around it. */
export type ComputerHost = {
  os: NodeJS.Platform;
  vmType: VmType;
  arch: GuestArch;
  /** The pinned Lima release asset for this host, with its published SHA-256. */
  archive: { name: string; sha256: string };
  /** limactl inside the unpacked archive. */
  limactl: string;
  /** Archive members extracted: the CLI, the guest agent for this arch, license and version. */
  members: string[];
  /** The OpenSSH client Lima and the egress tunnel run (Git's on Windows); empty when Windows has none. */
  ssh: string;
  /** The tar that unpacks the archive (bsdtar on Windows also reads the zip). */
  tar: string;
};

export const LIMA_VERSION = "2.2.1";

const ARCHIVES: Record<string, { name: string; sha256: string }> = {
  "darwin-arm64": {
    name: "Darwin-arm64.tar.gz",
    sha256: "9e9eacce88f37e185c346bad73aa6136f738d8cdf8c3bb23cd42b071824bc66e",
  },
  "darwin-x64": {
    name: "Darwin-x86_64.tar.gz",
    sha256: "6b776e4bc41f358e6ee01fefcc78e2eb26f11635a0fcff632234af77a566c6c4",
  },
  "linux-arm64": {
    name: "Linux-aarch64.tar.gz",
    sha256: "fbcf4d127936666aa2cf6013b663c250431f2a59394757b404070f8d6a160e10",
  },
  "linux-x64": {
    name: "Linux-x86_64.tar.gz",
    sha256: "b391ac7fcac2b2a5a1628107756463188ded4d18d3104a40a66a8bb6fec01bcb",
  },
  "win32-arm64": {
    name: "Windows-ARM64.zip",
    sha256: "b7468a6886c768e1bca5569eee1486f1326ea1478b8e6902aebb8f64133cf8bc",
  },
  "win32-x64": {
    name: "Windows-AMD64.zip",
    sha256: "34061dd322daa014c03f1cc8bc253be40596835990a3017426bc2189a3fdd75d",
  },
};

const systemRoot = () => process.env.SystemRoot ?? "C:\\Windows";

/**
 * Git for Windows' ssh. Lima feeds its guest scripts through ssh's stdin, which Windows' own OpenSSH never passes
 * on, so its readiness check hangs; Lima's own docs name Git's ssh for Windows.
 */
export function gitSsh(envPath = process.env.PATH ?? ""): string | undefined {
  const git = findProgram("git", envPath);
  const candidates = [
    // …\Git\cmd\git.exe and …\Git\bin\git.exe sit beside …\Git\usr\bin\ssh.exe.
    ...(git ? [path.join(path.dirname(path.dirname(git)), "usr", "bin", "ssh.exe")] : []),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "ssh.exe"),
    path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "Programs",
      "Git",
      "usr",
      "bin",
      "ssh.exe",
    ),
  ];
  return candidates.find((file) => fs.existsSync(file));
}

/** The host's profile, or undefined where Lima has no driver for it (macOS before 13, 32-bit, other systems). */
export function computerHost(
  platform: NodeJS.Platform = process.platform,
  cpu: string = process.arch,
  release: string = os.release(),
): ComputerHost | undefined {
  const archive = ARCHIVES[`${platform}-${cpu}`];
  if (!archive) return undefined;
  if (platform === "darwin" && Number(release.split(".")[0]) < 22) return undefined;
  const arch: GuestArch = cpu === "arm64" ? "aarch64" : "x86_64";
  const win = platform === "win32";
  // The tarballs list members as ./bin/…, the zip as bin/….
  const prefix = win ? "" : "./";
  const limactl = win ? "bin/limactl.exe" : "bin/limactl";
  return {
    os: platform,
    vmType: platform === "darwin" ? "vz" : win ? "wsl2" : "qemu",
    arch,
    archive: { name: `lima-${LIMA_VERSION}-${archive.name}`, sha256: archive.sha256 },
    limactl,
    members: [
      limactl,
      `share/lima/lima-guestagent.Linux-${arch}.gz`,
      "share/doc/lima/LICENSE",
      "share/doc/lima/VERSION",
    ].map((m) => `${prefix}${m}`),
    ssh: win ? (gitSsh() ?? "") : platform === "darwin" ? "/usr/bin/ssh" : (findProgram("ssh") ?? "/usr/bin/ssh"),
    tar: win
      ? path.join(systemRoot(), "System32", "tar.exe")
      : platform === "darwin"
        ? "/usr/bin/tar"
        : (findProgram("tar") ?? "/usr/bin/tar"),
  };
}

/** A step the owner takes once on this host before the computer can start: what is missing and the command for it. */
export type ComputerNeed = { reason: ComputerNeedReason; command?: string; message: string };
export type ComputerNeedReason = "qemu" | "kvm_group" | "kvm_missing" | "wsl" | "git" | "wsl_mirrored";

type Installer = "apt" | "dnf" | "pacman" | "zypper";

/** The package manager of this Linux distribution, from os-release's ID and ID_LIKE. */
export function linuxInstaller(osRelease: string): Installer | undefined {
  const field = (key: string) => new RegExp(`^${key}="?([^"\\n]*)"?$`, "m").exec(osRelease)?.[1] ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((id) => id === "debian" || id === "ubuntu")) return "apt";
  if (ids.some((id) => ["fedora", "rhel", "centos"].includes(id))) return "dnf";
  if (ids.some((id) => id === "arch")) return "pacman";
  if (ids.some((id) => id.startsWith("suse") || id.startsWith("opensuse"))) return "zypper";
  return undefined;
}

/** The command that installs QEMU (with qemu-img and the guest's firmware) for this installer and guest arch. */
export function qemuCommand(installer: Installer | undefined, arch: GuestArch): string | undefined {
  const arm = arch === "aarch64";
  switch (installer) {
    case "apt":
      return `sudo apt install ${arm ? "qemu-system-arm qemu-efi-aarch64" : "qemu-system-x86"} qemu-utils`;
    case "dnf":
      return `sudo dnf install ${arm ? "qemu-system-aarch64 edk2-aarch64" : "qemu-system-x86"} qemu-img`;
    case "pacman":
      return arm ? "sudo pacman -S qemu-system-aarch64 qemu-img edk2-aarch64" : "sudo pacman -S qemu-base";
    case "zypper":
      return `sudo zypper install ${arm ? "qemu-arm qemu-uefi-aarch64" : "qemu-x86"} qemu-tools`;
    default:
      return undefined;
  }
}

const readOsRelease = () => {
  try {
    return fs.readFileSync("/etc/os-release", "utf8");
  } catch {
    return "";
  }
};

/**
 * What this host still lacks before Lima can start a VM, or undefined. macOS needs nothing; Linux needs QEMU and
 * KVM; Windows needs WSL 2 (without mirrored networking) and Git for Windows (for its ssh). `message` is for agents
 * and logs; the panel words it from `reason` in the owner's language.
 */
export function missingPrerequisite(
  host: ComputerHost,
  envPath = process.env.PATH ?? "",
  osRelease: () => string = readOsRelease,
): ComputerNeed | undefined {
  if (host.os === "linux") {
    const qemu = host.arch === "aarch64" ? "qemu-system-aarch64" : "qemu-system-x86_64";
    if (!findProgram(qemu, envPath) || !findProgram("qemu-img", envPath)) {
      const command = qemuCommand(linuxInstaller(osRelease()), host.arch);
      return {
        reason: "qemu",
        ...(command ? { command } : {}),
        message: `Computer needs QEMU on this Linux host: install it${command ? ` ("${command}")` : " with the distribution's package manager"} and try again`,
      };
    }
    try {
      fs.accessSync("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      return fs.existsSync("/dev/kvm")
        ? {
            reason: "kvm_group",
            command: "sudo usermod -aG kvm $USER",
            message:
              'Computer needs access to /dev/kvm: add this user to the kvm group ("sudo usermod -aG kvm $USER"), sign in again and try again',
          }
        : {
            reason: "kvm_missing",
            message:
              "Computer needs hardware virtualization (KVM) on this Linux host: turn it on in the firmware settings, or use a server that offers it",
          };
    }
  }
  if (host.os === "win32") {
    if (!fs.existsSync(path.join(systemRoot(), "System32", "wsl.exe")))
      return {
        reason: "wsl",
        command: "wsl --install --no-distribution",
        message:
          'Computer needs WSL 2: run "wsl --install --no-distribution" in an administrator PowerShell, restart Windows and try again',
      };
    if (!host.ssh || !fs.existsSync(host.ssh))
      return {
        reason: "git",
        command: "winget install --id Git.Git -e",
        message:
          'Computer needs Git for Windows, for the ssh it brings: install it ("winget install --id Git.Git -e"), then try again',
      };
    if (mirroredNetworking())
      return {
        reason: "wsl_mirrored",
        command: "wsl --shutdown",
        message:
          "Computer cannot run with WSL's mirrored networking, which shares this computer's localhost with it: remove networkingMode=mirrored from .wslconfig, run \"wsl --shutdown\" and try again",
      };
  }
  return undefined;
}
