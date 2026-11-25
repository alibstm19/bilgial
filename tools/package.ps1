# BilgiAl — deneme ZIP'ini yeniden üretir (bağımlılıksız).
#
#   powershell -ExecutionPolicy Bypass -File tools/package.ps1
#
# Girdi : dist/BilgiAl (build.ps1 çıktısı), work/pkg-staging/Baslat-Deneme.cmd,
#         work/pkg-staging/OKU-BENI.txt, docs/kurulum-ve-test.md
# Çıktı : BilgiAl-<sürüm>-deneme.zip (kök klasör BilgiAl\), bayt + SHA256 yazar.
[CmdletBinding()]
param(
    [string]$Version = '0.2.0'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Dist = Join-Path $Root 'dist\BilgiAl'
if (-not (Test-Path (Join-Path $Dist 'BilgiAl.exe'))) {
    throw "dist\BilgiAl\BilgiAl.exe yok. Önce tools\build.ps1 çalıştır."
}

$Stage = Join-Path $Root 'work\pkg-out\BilgiAl'
if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

Write-Host "== Kopyalanıyor =="
Copy-Item -Path (Join-Path $Dist '*') -Destination $Stage -Recurse -Force
Copy-Item -Path (Join-Path $Root 'work\pkg-staging\Baslat-Deneme.cmd') -Destination $Stage -Force
Copy-Item -Path (Join-Path $Root 'work\pkg-staging\OKU-BENI.txt') -Destination $Stage -Force
Copy-Item -Path (Join-Path $Root 'docs\kurulum-ve-test.md') -Destination (Join-Path $Stage 'KURULUM-VE-TEST.md') -Force

# Deneme profili: temiz tohum -> deneme\data + media + models (Baslat-Deneme.cmd bu klasoru acar).
Write-Host "== Deneme profili tohumlanıyor =="
& node (Join-Path $Root 'work\trial-seed.js') | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'trial-seed.js basarisiz' }
$Trial = Join-Path $Root 'work\trial-data'
$TrialStage = Join-Path $Stage 'deneme'
New-Item -ItemType Directory -Path $TrialStage -Force | Out-Null
foreach ($sub in @('data', 'media', 'models')) {
    $from = Join-Path $Trial $sub
    if (Test-Path $from) {
        Copy-Item -Path $from -Destination $TrialStage -Recurse -Force
    }
}

$Zip = Join-Path $Root "BilgiAl-$Version-deneme.zip"
if (Test-Path $Zip) { Remove-Item -LiteralPath $Zip -Force }
Write-Host "== Sıkıştırılıyor =="
Compress-Archive -Path $Stage -DestinationPath $Zip -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($Zip)
$entries = $archive.Entries.Count
$archive.Dispose()

$size = (Get-Item $Zip).Length
$hash = (Get-FileHash -Path $Zip -Algorithm SHA256).Hash
Write-Host ("ZIP    {0}" -f $Zip)
Write-Host ("ENTRY  {0}" -f $entries)
Write-Host ("BAYT   {0}" -f $size)
Write-Host ("SHA256 {0}" -f $hash)
