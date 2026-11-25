<#
  BilgiAl test koşucusu (bağımlılıksız).
  node --test tests/ çalıştırır ve TAP/spec özetini Türkçe yazar.
#>

$ErrorActionPreference = 'Continue'

try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$Root  = Split-Path -Parent $PSScriptRoot
$Tests = Join-Path $Root 'tests'

Write-Host '== BilgiAl Testleri ==' -ForegroundColor Cyan

if (-not (Test-Path $Tests)) {
    Write-Host "[UYARI] tests/ dizini yok; henüz test yazılmamış olabilir." -ForegroundColor Yellow
    exit 0
}

$testFiles = Get-ChildItem -LiteralPath $Tests -Filter '*.test.js' -File -ErrorAction SilentlyContinue
if (-not $testFiles -or $testFiles.Count -eq 0) {
    Write-Host "[UYARI] tests/ içinde *.test.js yok; koşulacak test bulunamadı." -ForegroundColor Yellow
    exit 0
}

Write-Host "Test dosyası: $($testFiles.Count)" -ForegroundColor Cyan

Push-Location $Root
try {
    $output = & node --test $Tests 2>&1
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

$output | ForEach-Object { Write-Host $_ }

# Node sürümüne göre spec ("ℹ pass 3") veya TAP ("# pass 3") özeti
$text = ($output | Out-String)
function Get-Count([string]$pattern) {
    $m = [regex]::Match($text, $pattern, 'IgnoreCase')
    if ($m.Success) { return [int]$m.Groups[1].Value }
    return $null
}

$pass = Get-Count '(?:#|ℹ)\s*pass\s+(\d+)'
$fail = Get-Count '(?:#|ℹ)\s*fail\s+(\d+)'
$canceled = Get-Count '(?:#|ℹ)\s*cancelled\s+(\d+)'
$skipped = Get-Count '(?:#|ℹ)\s*skipped\s+(\d+)'

Write-Host ''
Write-Host '== Özet ==' -ForegroundColor Cyan
if ($null -ne $pass) { Write-Host ("  Geçen : {0}" -f $pass) }
if ($null -ne $fail) { Write-Host ("  Kalan : {0}" -f $fail) }
if ($null -ne $skipped -and $skipped -gt 0) { Write-Host ("  Atlanan: {0}" -f $skipped) }
if ($null -ne $canceled -and $canceled -gt 0) { Write-Host ("  İptal : {0}" -f $canceled) }

if ($code -eq 0) {
    Write-Host 'SONUÇ: GEÇTİ' -ForegroundColor Green
} else {
    Write-Host "SONUÇ: BAŞARISIZ (node --test çıkış kodu $code)" -ForegroundColor Red
}

exit $code
