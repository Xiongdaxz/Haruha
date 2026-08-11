param(
  [string]$Proxy = "",
  [switch]$NoBundle,
  [ValidateSet("x64", "arm64", "all")]
  [string]$Architecture = "x64",
  [ValidateSet("msi", "nsis", "all")]
  [string]$Bundles = "msi"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Find-VsDevCmd {
  $candidates = @(
    "C:\BuildTools\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vswhere) {
    $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($installationPath) {
      $candidate = Join-Path $installationPath "Common7\Tools\VsDevCmd.bat"
      if (Test-Path -LiteralPath $candidate) {
        return $candidate
      }
    }
  }

  return $null
}

Push-Location $ProjectRoot
try {
  bun run build
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend build failed with exit code $LASTEXITCODE."
  }

  if ($Proxy) {
    $env:HTTP_PROXY = $Proxy
    $env:HTTPS_PROXY = $Proxy
    $env:ALL_PROXY = $Proxy
  }

  $VsDevCmd = Find-VsDevCmd
  if ($null -eq $VsDevCmd) {
    throw "Visual Studio C++ Build Tools were not found. Install the Desktop development with C++ workload and Windows SDK."
  }

  $Architectures = if ($Architecture -eq "all") {
    @("x64", "arm64")
  }
  else {
    @($Architecture)
  }
  $BundleList = if ($Bundles -eq "all") { "msi,nsis" } else { $Bundles }

  foreach ($CurrentArchitecture in $Architectures) {
    $TargetTriple = if ($CurrentArchitecture -eq "arm64") {
      "aarch64-pc-windows-msvc"
    }
    else {
      $null
    }

    if ($TargetTriple) {
      $InstalledTargets = & rustup target list --installed
      if ($LASTEXITCODE -ne 0) {
        throw "Unable to read installed Rust targets."
      }
      if ($InstalledTargets -notcontains $TargetTriple) {
        & rustup target add $TargetTriple
        if ($LASTEXITCODE -ne 0) {
          throw "Unable to install Rust target $TargetTriple."
        }
      }
    }

    $vsEnv = cmd /s /c "`"$VsDevCmd`" -arch=$CurrentArchitecture -host_arch=x64 >nul && set"
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to initialize Visual Studio tools for $CurrentArchitecture. Install the matching MSVC C++ build tools and Windows SDK."
    }
    foreach ($line in $vsEnv) {
      $idx = $line.IndexOf("=")
      if ($idx -gt 0) {
        [Environment]::SetEnvironmentVariable($line.Substring(0, $idx), $line.Substring($idx + 1), "Process")
      }
    }

    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    $TauriArgs = @("x", "tauri", "build")
    if ($NoBundle) {
      $TauriArgs += "--no-bundle"
    }
    else {
      $TauriArgs += @("--bundles", $BundleList)
    }
    if ($TargetTriple) {
      $TauriArgs += @("--target", $TargetTriple)
    }

    Write-Host "Building Haruha for Windows $CurrentArchitecture..."
    & bun @TauriArgs
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri build for Windows $CurrentArchitecture failed with exit code $LASTEXITCODE."
    }
  }
}
finally {
  Pop-Location
}
