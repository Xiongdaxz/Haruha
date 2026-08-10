param(
  [string]$Proxy = "",
  [switch]$NoBundle
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

  $vsEnv = cmd /s /c "`"$VsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
  foreach ($line in $vsEnv) {
    $idx = $line.IndexOf("=")
    if ($idx -gt 0) {
      [Environment]::SetEnvironmentVariable($line.Substring(0, $idx), $line.Substring($idx + 1), "Process")
    }
  }

  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  if ($NoBundle) {
    bun x tauri build --no-bundle
  }
  else {
    bun x tauri build --bundles msi
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}
