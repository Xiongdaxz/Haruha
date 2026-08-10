param(
  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Test-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd -and $Name -in @("cargo", "rustc", "rustup")) {
    $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    $candidate = Join-Path $userProfile ".cargo\bin\$Name.exe"
    if (Test-Path -LiteralPath $candidate) {
      $cmd = [pscustomobject]@{ Source = $candidate }
    }
  }
  if ($null -eq $cmd -and $Name -in @("cl", "link")) {
    $patterns = @(
      "C:\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\$Name.exe",
      "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\$Name.exe",
      "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\$Name.exe"
    )
    foreach ($pattern in $patterns) {
      $candidate = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
      if ($null -ne $candidate) {
        $cmd = [pscustomobject]@{ Source = $candidate.FullName }
        break
      }
    }
  }
  if ($null -eq $cmd) {
    return [pscustomobject]@{
      name = $Name
      found = $false
      path = $null
      version = $null
    }
  }

  $version = $null
  try {
    if ($Name -in @("cl", "link")) {
      $version = ((& $cmd.Source 2>&1) | ForEach-Object { $_.ToString() } | Select-Object -First 1)
    } else {
      $version = (& $cmd.Source --version 2>$null | Select-Object -First 1)
    }
  } catch {
    $version = $null
  }

  [pscustomobject]@{
    name = $Name
    found = $true
    path = $cmd.Source
    version = $version
  }
}

function Test-WindowsSdkLib {
  $patterns = @(
    "C:\Program Files (x86)\Windows Kits\10\Lib\*\um\x64\kernel32.lib",
    "C:\Program Files\Windows Kits\10\Lib\*\um\x64\kernel32.lib"
  )
  foreach ($pattern in $patterns) {
    $match = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($null -ne $match) {
      return [pscustomobject]@{
        name = "windows-sdk-lib"
        found = $true
        path = $match.FullName
        version = ($match.Directory.Parent.Parent.Name)
      }
    }
  }

  [pscustomobject]@{
    name = "windows-sdk-lib"
    found = $false
    path = $null
    version = $null
  }
}

$commands = @(
  Test-Command "bun"
  Test-Command "node"
  Test-Command "rustc"
  Test-Command "cargo"
  Test-Command "rustup"
  Test-Command "cl"
  Test-Command "link"
  Test-WindowsSdkLib
)

$required = @("bun", "node", "rustc", "cargo")
if ($IsWindows -or $env:OS -eq "Windows_NT") {
  $required += "cl"
  $required += "link"
  $required += "windows-sdk-lib"
}

$summary = [pscustomobject]@{
  ok = ($commands | Where-Object { -not $_.found -and $_.name -in $required }).Count -eq 0
  commands = $commands
  notes = @(
    "Tauri/Rust 构建需要 rustc 和 cargo。",
    "Windows 打包通常还需要 MSVC C++ Build Tools 和 Windows SDK。"
  )
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 5
} else {
  $summary.commands | Format-Table -AutoSize
  Write-Host ""
  if ($summary.ok) {
    Write-Host "环境检查通过" -ForegroundColor Green
  } else {
    Write-Host "环境检查未通过：请先安装缺失项" -ForegroundColor Yellow
  }
  $summary.notes | ForEach-Object { Write-Host "- $_" }
}
