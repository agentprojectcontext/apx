# Opens desktop setup on a graphical computer; -Server installs the daemon, CLI and Node without administrator access.
#
#   irm https://agentprojectcontext.github.io/apx/install.ps1 | iex
#   .\install.ps1 -File apx-core-2.2.0-win-x64.tar.gz      # a bundle you already have (no download)
#
# Parameters: -File <bundle>  -Version <x.y.z>  -Feed <owner/repo | http(s) URL>  -NoService  -Uninstall
# A feed URL is a GitHub-shaped test feed (scripts/install/feed.ts): <url>/releases and <url>/download/v<x.y.z>/<file>.
# It lands in %USERPROFILE%\.apx\v2\app (APX_APP to change it); your data stays in %USERPROFILE%\.apx\v2, and APX v1's
# files in %USERPROFILE%\.apx are never touched. If APX v1 is installed, its daemon is stopped and its `apx` removed.
param(
  [string]$File = "",
  [string]$Version = "",
  [string]$Feed = $(if ($env:APX_RELEASES) { $env:APX_RELEASES } else { "agentprojectcontext/apx" }),
  [switch]$NoService,
  [switch]$Server,
  [switch]$Desktop,
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "warning: $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

$App = if ($env:APX_APP) { $env:APX_APP } else { Join-Path $env:USERPROFILE ".apx\v2\app" }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$Bin = Join-Path $App "bin"

# -Uninstall: the login entry and the program go; the data in .apx\v2 stays (delete it yourself to start over).
if ($Uninstall) {
  $cmd = Join-Path $Bin "apx.cmd"
  if (Test-Path $cmd) {
    Say "Stopping the APX daemon"
    $env:APX_APP = $App
    & $cmd service uninstall
  }
  if (Test-Path (Join-Path $App "current")) { (Get-Item (Join-Path $App "current")).Delete() }
  Remove-Item -Recurse -Force $App -ErrorAction SilentlyContinue
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  [Environment]::SetEnvironmentVariable("Path", (($userPath -split ";") | Where-Object { $_ -and $_ -ne $Bin }) -join ";", "User")
  Say "APX is uninstalled. Your data is still in $(Join-Path $env:USERPROFILE '.apx\v2')"
  exit 0
}

$mode = "server"
$previous = Join-Path $App "install-mode"
$existingServer = (Test-Path (Join-Path $App "current")) -and (-not (Test-Path $previous) -or (Get-Content $previous -Raw).Trim() -eq "server")
if ($Server -and $Desktop) { Die "choose -Server or -Desktop" }
if ($Desktop -and ($File -or $NoService)) { Die "-File and -NoService require server mode" }
$graphical = [Environment]::UserInteractive -and -not $env:SSH_CONNECTION -and -not $env:SSH_TTY
if ($Desktop -or (-not $Server -and -not $File -and -not $NoService -and -not $existingServer -and $graphical)) { $mode = "desktop" }
if ($mode -eq "desktop" -and -not $graphical) { Die "desktop setup needs a local graphical session; use -Server" }
Say "Install mode: $mode"

$Tar = Join-Path $env:SystemRoot "System32\tar.exe"
if (-not (Test-Path $Tar)) { Die "tar.exe is missing (Windows 10 1803 or newer has it)" }

$Work = Join-Path ([System.IO.Path]::GetTempPath()) ("apx-install-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $Work | Out-Null
try {
  # 1. The bundle: the file given, or this platform's from the newest release (or the one asked for).
  if ($File) {
    if (-not (Test-Path $File)) { Die "no such file: $File" }
    $Name = Split-Path $File -Leaf
    if ($Name -notmatch "^apx-core-(\d+\.\d+\.\d+)-win-$Arch\.tar\.gz$") { Die "$Name is not a bundle for win-$Arch" }
    $Version = $Matches[1]
    Copy-Item $File (Join-Path $Work $Name)
    if (Test-Path "$File.sha256") { Copy-Item "$File.sha256" (Join-Path $Work "$Name.sha256") }
  } else {
    $UrlFeed = $Feed -match '^https?://'
    $Api = if ($UrlFeed) { $Feed.TrimEnd("/") } else { "https://api.github.com/repos/$Feed" }
    if (-not $Version) {
      Say "Looking for the newest APX in $Feed"
      try {
        $releases = Invoke-RestMethod -Headers @{ "accept" = "application/vnd.github+json"; "user-agent" = "apx-install" } `
          -Uri "$Api/releases?per_page=100"
      } catch { Die "could not read the releases of $Feed" }
      # The highest plain vX.Y.Z from 2 up, not the newest by date: a fix to an older line can come after a newer one.
      $tag = $releases | Where-Object { -not $_.draft -and -not $_.prerelease -and $_.tag_name -match '^v([2-9]\d*\.\d+\.\d+)$' } |
        Sort-Object { [version]$_.tag_name.Substring(1) } -Descending | Select-Object -First 1
      if (-not $tag) { Die "no APX release found in $Feed" }
      $Version = $tag.tag_name.Substring(1)
    }
    $Version = $Version.TrimStart("v")
    $Name = "apx-core-$Version-win-$Arch.tar.gz"
    $Base = if ($UrlFeed) { "$Api/download/v$Version" } else { "https://github.com/$Feed/releases/download/v$Version" }
    Say "Downloading APX $Version (win-$Arch)"
    try { Invoke-WebRequest -Uri "$Base/$Name" -OutFile (Join-Path $Work $Name) } catch { Die "could not download $Base/$Name" }
    try { Invoke-WebRequest -Uri "$Base/$Name.sha256" -OutFile (Join-Path $Work "$Name.sha256") } catch { Die "could not download $Name.sha256" }
  }

  # 2. Checked against its .sha256 when there is one (always, for a download).
  $Bundle = Join-Path $Work $Name
  if (Test-Path "$Bundle.sha256") {
    $want = ((Get-Content "$Bundle.sha256" -Raw).Trim() -split "\s+")[0].ToLower()
    $got = (Get-FileHash $Bundle -Algorithm SHA256).Hash.ToLower()
    if ($want -ne $got) { Die "$Name does not match its .sha256 (expected $want, got $got)" }
  } else {
    Warn "no $Name.sha256 beside the file: not checked"
  }

  # 3. APX v1 first: its daemon stops (two daemons would answer the same Telegram bots) and its `apx` goes.
  if ($mode -eq "server") {
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  if (Get-ItemProperty -Path $runKey -Name "APXDaemon" -ErrorAction SilentlyContinue) {
    Say "Stopping APX v1's daemon"
    Remove-ItemProperty -Path $runKey -Name "APXDaemon"
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
      Where-Object { $_.CommandLine -match "agentprojectcontext[\\/]apx[\\/]src[\\/]host[\\/]daemon" } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  if ((Get-Command npm -ErrorAction SilentlyContinue) -and (npm ls -g --depth=0 @agentprojectcontext/apx 2>$null | Select-String "@agentprojectcontext/apx")) {
    Say "Removing APX v1's apx command (its files in .apx stay, to import them)"
    npm uninstall -g @agentprojectcontext/apx 2>$null | Out-Null
  }
  }

  # 4. A running APX daemon from an earlier install stops before its files are replaced.
  $current = Join-Path $App "current"
  if ($mode -eq "server" -and (Test-Path (Join-Path $current "node\node.exe"))) {
    & (Join-Path $current "node\node.exe") --disable-warning=ExperimentalWarning (Join-Path $current "apps\terminal\src\main.ts") service uninstall 2>$null | Out-Null
  }

  # 5. Unpacked beside any version already there, then made current (a junction).
  Say "Installing APX $Version in $App"
  $unpacked = Join-Path $Work "unpacked"
  New-Item -ItemType Directory -Path $unpacked | Out-Null
  & $Tar -xzf $Bundle -C $unpacked
  if ($LASTEXITCODE -ne 0) { Die "could not unpack $Name" }
  if (-not (Test-Path (Join-Path $unpacked "apx\node\node.exe"))) { Die "$Name has no Node inside" }
  if ($mode -eq "desktop" -and (Test-Path $current)) {
    Say "Installing desktop without replacing the existing server"
    $env:APX_RELEASES = $Feed
    $env:APX_INSTALL_VERSION = $Version
    try {
      & (Join-Path $unpacked "apx\node\node.exe") --disable-warning=ExperimentalWarning (Join-Path $unpacked "apx\apps\terminal\src\main.ts") desktop
    } finally { Remove-Item Env:APX_INSTALL_VERSION -ErrorAction SilentlyContinue }
    if ($LASTEXITCODE -ne 0) { Die "desktop setup failed; retry: apx desktop" }
    return
  }
  $versions = Join-Path $App "versions"
  New-Item -ItemType Directory -Force -Path $versions | Out-Null
  $target = Join-Path $versions $Version
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Move-Item (Join-Path $unpacked "apx") $target
  # Removing a junction never touches what it points at.
  if (Test-Path $current) { (Get-Item $current).Delete() }
  New-Item -ItemType Junction -Path $current -Target $target | Out-Null

  # 6. The `apx` command, always through `current`, on the user's PATH.
  $bin = $Bin
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  @"
@echo off
rem The APX command, written by install.ps1.
if not defined APX_APP set "APX_APP=$App"
"%APX_APP%\current\node\node.exe" --disable-warning=ExperimentalWarning "%APX_APP%\current\apps\terminal\src\main.ts" %*
"@ | Set-Content -Encoding ASCII (Join-Path $bin "apx.cmd")
  # The same command as apx2: it reaches this APX even where another apx (v1's) comes first on the PATH.
  Copy-Item -Force (Join-Path $bin "apx.cmd") (Join-Path $bin "apx2.cmd")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($userPath -split ";") -notcontains $bin) {
    [Environment]::SetEnvironmentVariable("Path", (($userPath, $bin) | Where-Object { $_ }) -join ";", "User")
    Warn "added $bin to your PATH: open a new terminal to use apx"
  }
  $env:Path = "$bin;$env:Path"
  $env:APX_APP = $App
  Set-Content -Path $previous -Value $mode -Encoding ASCII
  if ($Feed -ne "agentprojectcontext/apx") { $env:APX_RELEASES = $Feed }
  if ($mode -eq "desktop") {
    Say "Installing and opening APX desktop. Choose server or client in the app."
    $env:APX_INSTALL_VERSION = $Version
    try { & (Join-Path $bin "apx.cmd") desktop } finally { Remove-Item Env:APX_INSTALL_VERSION -ErrorAction SilentlyContinue }
    if ($LASTEXITCODE -ne 0) { Die "desktop setup failed; retry: apx desktop" }
    return
  }

  # 7. The daemon at login, started again if it stops.
  if (-not $NoService) {
    # A feed other than the public one (a test feed, a mirror) is where this install keeps updating from.
    if ($Feed -ne "agentprojectcontext/apx") { $env:APX_RELEASES = $Feed }
    Say "Starting the APX daemon"
    & (Join-Path $bin "apx.cmd") service install
    if ($LASTEXITCODE -ne 0) { Warn "the service did not install; run: apx service install" }
  }

  Say "APX $Version is installed. Try: apx status"
  Write-Host "    To use it from another computer: apx expose tailscale (or lan), then apx pair"
} finally {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}
