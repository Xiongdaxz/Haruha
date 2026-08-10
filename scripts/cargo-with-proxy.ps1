param(
  [Parameter(ValueFromRemainingArguments = $true, Position = 0)]
  [string[]]$CargoArgs,
  [string]$Proxy = "",
  [switch]$NoProxy
)

$ErrorActionPreference = "Stop"

if ($null -eq $CargoArgs -or $CargoArgs.Count -eq 0) {
  $CargoArgs = @("test")
}

function Find-VsDevCmd {
  $candidates = @(
    "C:\BuildTools\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $null
}

function Import-VsDevEnvironment {
  $vsDevCmd = Find-VsDevCmd
  if ($null -eq $vsDevCmd) {
    return
  }

  $envLines = & cmd.exe /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to initialize Visual Studio build environment from $vsDevCmd"
  }

  foreach ($line in $envLines) {
    $index = $line.IndexOf("=")
    if ($index -le 0) {
      continue
    }

    $name = $line.Substring(0, $index)
    $value = $line.Substring($index + 1)
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if ($IsWindows -or $env:OS -eq "Windows_NT") {
  Import-VsDevEnvironment
}

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($null -eq $cargo) {
  $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  $candidate = Join-Path $userProfile ".cargo\bin\cargo.exe"
  if (Test-Path -LiteralPath $candidate) {
    $cargo = [pscustomobject]@{ Source = $candidate }
  }
}

if ($null -eq $cargo) {
  throw "cargo not found. Install Rust first."
}

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$tauriDir = Join-Path $projectRoot "src-tauri"
if (-not (Test-Path -LiteralPath (Join-Path (Get-Location) "Cargo.toml")) -and
    (Test-Path -LiteralPath (Join-Path $tauriDir "Cargo.toml"))) {
  Set-Location -LiteralPath $tauriDir
}

if ($NoProxy) {
  Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:ALL_PROXY -ErrorAction SilentlyContinue
}
elseif ($Proxy) {
  $env:HTTP_PROXY = $Proxy
  $env:HTTPS_PROXY = $Proxy
  $env:ALL_PROXY = $Proxy

  $env:GIT_CONFIG_COUNT = "2"
  $env:GIT_CONFIG_KEY_0 = "http.sslBackend"
  $env:GIT_CONFIG_VALUE_0 = "openssl"
  $env:GIT_CONFIG_KEY_1 = "http.proxy"
  $env:GIT_CONFIG_VALUE_1 = $Proxy
}

& $cargo.Source @CargoArgs
exit $LASTEXITCODE
