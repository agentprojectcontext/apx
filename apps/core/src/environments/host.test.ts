import assert from "node:assert/strict";
import { test } from "node:test";
import { computerHost, linuxInstaller, missingPrerequisite, qemuCommand } from "./host.ts";

test("each host gets Lima's driver, build and guest agent for its own system and architecture", () => {
  const mac = computerHost("darwin", "arm64", "24.0.0");
  assert.equal(mac?.vmType, "vz");
  assert.equal(mac?.arch, "aarch64");
  assert.match(mac?.archive.name ?? "", /Darwin-arm64\.tar\.gz$/);
  assert.ok(mac?.members.includes("./share/lima/lima-guestagent.Linux-aarch64.gz"));

  const intelMac = computerHost("darwin", "x64", "23.1.0");
  assert.equal(intelMac?.arch, "x86_64");
  assert.match(intelMac?.archive.name ?? "", /Darwin-x86_64/);

  const linux = computerHost("linux", "x64");
  assert.equal(linux?.vmType, "qemu");
  assert.ok(linux?.members.includes("./share/lima/lima-guestagent.Linux-x86_64.gz"));

  const windows = computerHost("win32", "x64");
  assert.equal(windows?.vmType, "wsl2");
  assert.equal(windows?.limactl, "bin/limactl.exe");
  assert.match(windows?.archive.name ?? "", /Windows-AMD64\.zip$/);
  // The zip lists its members without the tarballs' "./".
  assert.ok(windows?.members.includes("bin/limactl.exe"));
});

test("a host Lima cannot drive has no computer", () => {
  assert.equal(computerHost("darwin", "arm64", "21.6.0"), undefined);
  assert.equal(computerHost("linux", "ia32"), undefined);
  assert.equal(computerHost("freebsd", "x64"), undefined);
});

test("a Linux host without QEMU is told what to install", () => {
  const linux = computerHost("linux", "x64");
  assert.ok(linux);
  const ubuntu = missingPrerequisite(linux, "/nonexistent", () => "ID=ubuntu\nID_LIKE=debian\n");
  assert.equal(ubuntu?.reason, "qemu");
  assert.equal(ubuntu?.command, "sudo apt install qemu-system-x86 qemu-utils");
  assert.match(ubuntu?.message ?? "", /QEMU.*qemu-system-x86/);
  // A distribution APX cannot tell gets the step without a command it might get wrong.
  const unknown = missingPrerequisite(linux, "/nonexistent", () => "ID=nixos\n");
  assert.equal(unknown?.reason, "qemu");
  assert.equal(unknown?.command, undefined);
  const mac = computerHost("darwin", "arm64", "24.0.0");
  assert.ok(mac);
  assert.equal(missingPrerequisite(mac, "/nonexistent"), undefined);
});

test("the QEMU command follows the distribution's package manager and the guest's architecture", () => {
  assert.equal(linuxInstaller("ID=fedora\nVERSION_ID=41\n"), "dnf");
  assert.equal(linuxInstaller('ID="rocky"\nID_LIKE="rhel centos fedora"\n'), "dnf");
  assert.equal(linuxInstaller('ID=linuxmint\nID_LIKE="ubuntu debian"\n'), "apt");
  assert.equal(linuxInstaller("ID=endeavouros\nID_LIKE=arch\n"), "pacman");
  assert.equal(linuxInstaller('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n'), "zypper");
  assert.equal(linuxInstaller("ID=nixos\n"), undefined);
  assert.equal(qemuCommand("dnf", "x86_64"), "sudo dnf install qemu-system-x86 qemu-img");
  assert.equal(qemuCommand("pacman", "x86_64"), "sudo pacman -S qemu-base");
  assert.equal(qemuCommand("apt", "aarch64"), "sudo apt install qemu-system-arm qemu-efi-aarch64 qemu-utils");
  assert.equal(qemuCommand(undefined, "x86_64"), undefined);
});
