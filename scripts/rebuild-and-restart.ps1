param(
  [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BuildTargetDir = Join-Path $ProjectRoot ".restart-build"
$BuiltExe = Join-Path $BuildTargetDir "release\Haruha.exe"
$RuntimeDir = Join-Path $ProjectRoot ".restart-runtime"
$RuntimeExe = Join-Path $RuntimeDir "Haruha.exe"
$BuildScript = Join-Path $PSScriptRoot "build-windows-release.ps1"
$OriginalCargoTargetDir = $env:CARGO_TARGET_DIR

Push-Location $ProjectRoot
try {
  Write-Host "[1/4] 正在打包 Haruha 新版 EXE..." -ForegroundColor Cyan
  $env:CARGO_TARGET_DIR = $BuildTargetDir

  & $BuildScript -Proxy $Proxy -NoBundle
  if (-not (Test-Path -LiteralPath $BuiltExe)) {
    throw "打包结束，但没有找到 EXE：$BuiltExe"
  }

  Write-Host "[2/4] 打包成功，正在关闭已启动的新版程序..." -ForegroundColor Cyan
  $runningProcesses = @(
    Get-Process -Name "proxy-manager-next", "Haruha" -ErrorAction SilentlyContinue
  )

  if ($runningProcesses.Count -gt 0) {
    $processIds = @($runningProcesses | Select-Object -ExpandProperty Id)
    $runningProcesses | Stop-Process -Force
    Wait-Process -Id $processIds -Timeout 10 -ErrorAction SilentlyContinue
    Write-Host "已关闭进程：$($processIds -join ', ')"
  }
  else {
    Write-Host "没有检测到正在运行的新版程序。"
  }

  Write-Host "[3/4] 正在更新测试用 EXE..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
  Copy-Item -LiteralPath $BuiltExe -Destination $RuntimeExe -Force

  Write-Host "[4/4] 正在启动新版程序..." -ForegroundColor Cyan
  Start-Process -FilePath $RuntimeExe -WorkingDirectory $RuntimeDir

  Write-Host ""
  Write-Host "完成：已重新打包并启动 Haruha。" -ForegroundColor Green
  Write-Host "运行文件：$RuntimeExe"
}
finally {
  if ($null -eq $OriginalCargoTargetDir) {
    Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
  }
  else {
    $env:CARGO_TARGET_DIR = $OriginalCargoTargetDir
  }
  Pop-Location
}
