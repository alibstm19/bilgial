# BilgiAl deneme surumu baslatici
#
#   powershell -ExecutionPolicy Bypass -File tools/trial.ps1
#   powershell -ExecutionPolicy Bypass -File tools/trial.ps1 -Seed      # veriyi yeniden kur
#   powershell -ExecutionPolicy Bypass -File tools/trial.ps1 -Port 9790 # farkli CDP portu
#
# Kurulu paketli uygulamayi (dist\BilgiAl\BilgiAl.exe) work\trial-data ile acar.
# Veri yoksa once tohumu calistirir. Uygulama kapaninca veri kalir.
[CmdletBinding()]
param(
    [switch]$Seed,
    [int]$Port = 9791,
    [switch]$Dev
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$dataDir = Join-Path $Root 'work\trial-data'
$seedScript = Join-Path $Root 'demo\trial-seed.js'
if (-not (Test-Path $seedScript)) { $seedScript = Join-Path $Root 'work\trial-seed.js' }

if ($Seed -or -not (Test-Path (Join-Path $dataDir 'data\users.json'))) {
    Write-Output 'Deneme verisi kuruluyor...'
    & node $seedScript
    if ($LASTEXITCODE -ne 0) { throw 'Deneme tohumu basarisiz' }
}

if ($Dev) {
    $exe = Join-Path $Root 'src\node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $exe)) { throw 'electron yok; npm install gerekli' }
    $args = @('src', "--user-data-dir=$dataDir", "--remote-debugging-port=$Port")
} else {
    $exe = Join-Path $Root 'dist\BilgiAl\BilgiAl.exe'
    if (-not (Test-Path $exe)) { throw 'dist yok; once tools\build.ps1 calistirin' }
    $args = @("--user-data-dir=$dataDir", "--remote-debugging-port=$Port")
}

Write-Output "Baslatiliyor: $exe"
Write-Output "Veri        : $dataDir"
Write-Output "Deneme girisi: ogrenci@bilgial.local / BilgiAl2026"

$process = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $Root -PassThru
Set-Content -LiteralPath (Join-Path $Root 'work\trial.pid') -Value $process.Id -Encoding ASCII

# Uygulama hazir olana kadar kisa bekleme (CDP). Kritik degil; yalniz bilgi.
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    if ($process.HasExited) { break }
}
if ($ready) { Write-Output "CDP_HAZIR port=$Port" } else { Write-Output 'CDP_BEKLEMEDE (uygulama yine calisiyor olabilir)' }
Write-Output "PID=$($process.Id)"
