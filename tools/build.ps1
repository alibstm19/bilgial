<#
  BilgiAl derleme betiği (bağımlılıksız, internet yok).

  Girdi : src/  +  src/node_modules/electron/dist
  Çıktı : dist/BilgiAl/BilgiAl.exe  ve  tools/BilgiAl.cmd
#>

$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$Root      = Split-Path -Parent $PSScriptRoot
$Src       = Join-Path $Root 'src'
$Electron  = Join-Path $Src 'node_modules\electron\dist'
$Dist      = Join-Path $Root 'dist\BilgiAl'
$AppDir    = Join-Path $Dist 'resources\app'
$Launcher  = Join-Path $PSScriptRoot 'BilgiAl.cmd'

function Write-Step([string]$Text) { Write-Host "== $Text ==" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "[OK]    $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[UYARI] $Text" -ForegroundColor Yellow }

# --- Ön koşullar -----------------------------------------------------------
if (-not (Test-Path (Join-Path $Src 'package.json'))) {
    Write-Host "[HATA]  src\package.json yok. Önce src/ iskeleti hazır olmalı." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $Src 'main\main.js'))) {
    Write-Host "[HATA]  src\main\main.js yok; derlenecek uygulama girişi bulunamadı." -ForegroundColor Red
    Write-Host "        Yazılımcı main.js'i teslim ettikten sonra tekrar çalıştırın." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $Electron 'electron.exe'))) {
    Write-Host "[HATA]  Electron bulunamadı: src\node_modules\electron\dist\electron.exe" -ForegroundColor Red
    Write-Host "        node_modules kopyalanmamış olabilir (internetten indirme yapılmaz)." -ForegroundColor Red
    exit 1
}

# --- Temizlik --------------------------------------------------------------
Write-Step 'Hazırlık'
if (Test-Path $Dist) {
    Remove-Item -LiteralPath $Dist -Recurse -Force
    Write-Ok "Eski dist\BilgiAl temizlendi"
}
New-Item -ItemType Directory -Force -Path $Dist, $AppDir | Out-Null

# --- Electron dağıtımı -----------------------------------------------------
Write-Step 'Electron kopyalanıyor'
$robo = Start-Process -FilePath 'robocopy.exe' `
    -ArgumentList @("`"$Electron`"", "`"$Dist`"", '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') `
    -Wait -NoNewWindow -PassThru
if ($robo.ExitCode -ge 8) {
    Write-Host "[HATA]  Electron kopyalanamadı (robocopy çıkış $($robo.ExitCode))." -ForegroundColor Red
    exit 1
}
Write-Ok "electron dist -> dist\BilgiAl"

# --- Uygulama içeriği (node_modules hariç) ---------------------------------
Write-Step 'Uygulama dosyaları kopyalanıyor'
$roboApp = Start-Process -FilePath 'robocopy.exe' `
    -ArgumentList @("`"$Src`"", "`"$AppDir`"", '/E', '/XD', 'node_modules', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') `
    -Wait -NoNewWindow -PassThru
if ($roboApp.ExitCode -ge 8) {
    Write-Host "[HATA]  Uygulama dosyaları kopyalanamadı (robocopy çıkış $($roboApp.ExitCode))." -ForegroundColor Red
    exit 1
}
Write-Ok "src -> dist\BilgiAl\resources\app (node_modules hariç)"

# --- Yeniden adlandırma ----------------------------------------------------
Write-Step 'Çalıştırılabilir adı'
$exe = Join-Path $Dist 'electron.exe'
$appExe = Join-Path $Dist 'BilgiAl.exe'
if (-not (Test-Path $exe)) {
    Write-Host "[HATA]  electron.exe kopyalanmamış; yeniden adlandırma yapılamadı." -ForegroundColor Red
    exit 1
}
if (Test-Path $appExe) { Remove-Item -LiteralPath $appExe -Force }
Rename-Item -LiteralPath $exe -NewName 'BilgiAl.exe'
Write-Ok "electron.exe -> BilgiAl.exe"

# --- Başlatıcı -------------------------------------------------------------
Write-Step 'Başlatıcı'
$cmd = @(
    '@echo off',
    'rem BilgiAl baslatici - build.ps1 tarafindan uretildi',
    'start "" "%~dp0..\dist\BilgiAl\BilgiAl.exe" %*'
) -join "`r`n"
Set-Content -LiteralPath $Launcher -Value $cmd -Encoding ASCII
Write-Ok "tools\BilgiAl.cmd yazıldı (%~dp0 tabanlı)"

# --- Doğrulama -------------------------------------------------------------
Write-Step 'Doğrulama'
$required = @(
    (Join-Path $Dist 'BilgiAl.exe'),
    (Join-Path $AppDir 'package.json'),
    (Join-Path $AppDir 'main\main.js'),
    (Join-Path $AppDir 'preload\preload.js'),
    (Join-Path $AppDir 'renderer\index.html')
)
$missing = @()
foreach ($f in $required) {
    if (Test-Path $f) {
        Write-Ok ($f.Substring($Root.Length + 1))
    } else {
        $missing += $f
        Write-Warn "eksik: $($f.Substring($Root.Length + 1))"
    }
}

Write-Host ''
Write-Host "resources\app içeriği:" -ForegroundColor Cyan
Get-ChildItem -LiteralPath $AppDir | Sort-Object Name | ForEach-Object {
    $kind = if ($_.PSIsContainer) { '<DIR>' } else { '{0,8} bayt' -f $_.Length }
    Write-Host ("  {0,-8} {1}" -f $kind, $_.Name)
}

if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host "[HATA]  Derleme tamamlanmadı; $($missing.Count) zorunlu dosya eksik." -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host "[OK]    Build tamam: dist\BilgiAl\BilgiAl.exe" -ForegroundColor Green
Write-Host "        Başlat: tools\BilgiAl.cmd ya da dist\BilgiAl\BilgiAl.exe" -ForegroundColor Green
exit 0
