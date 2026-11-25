# BilgiAl — deneme surumu tek komut dogrulama
#
#   powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1
#   powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -Dev        # electron src
#   powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -SkipBuild  # dist hazir
#   powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -Quick      # yalniz kapilar
#
# Sirasiyla: kalite kapilari (test/lint/doctor) -> paket -> deneme uygulamasi ->
# gercek cozum uretimi -> telefondan oynatma -> kurulabilir PWA -> ilk adimlar
# rehberi -> AI baglantilari -> tek dugme indirme. Her adim olculur; tek karar yazilir.
# Yeni bagimlilik yok; adimlar mevcut araclari cagirir.
[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$SkipBuild,
    [switch]$Quick,
    [int]$Port = 9794
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$results = New-Object System.Collections.ArrayList
$failed = 0
$startedAt = Get-Date

function Clean([string]$Text) {
    if (-not $Text) { return '' }
    $one = ($Text -replace '\s+', ' ').Trim()
    if ($one.Length -gt 200) { $one = $one.Substring(0, 200) }
    return $one
}

function Add-Result([string]$Name, [bool]$Ok, [string]$Detail) {
    $detailText = Clean $Detail
    [void]$results.Add([pscustomobject]@{ Adim = $Name; Sonuc = $(if ($Ok) { 'GECTI' } else { 'KALDI' }); Ayrinti = $detailText })
    if (-not $Ok) { $script:failed++ }
    Write-Output ("[{0}] {1} {2}" -f $(if ($Ok) { 'OK ' } else { 'HATA' }), $Name, $detailText)
}

function Stop-Trial {
    $pidFile = Join-Path $Root 'work\trial.pid'
    if (Test-Path $pidFile) {
        $id = (Get-Content -LiteralPath $pidFile -TotalCount 1).Trim()
        if ($id) { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue }
    }
    Get-Process BilgiAl, electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1200
}

function Wait-Cdp([int]$CdpPort) {
    for ($i = 0; $i -lt 120; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return $true }
        } catch { }
    }
    return $false
}

Write-Output '== BilgiAl deneme dogrulamasi =='

# --- 1) Kalite kapilari
$testOut = & node --test --test-reporter=tap tests/ 2>&1 | Out-String
$testLine = (($testOut -split "`n" | Where-Object { $_ -match '^# (tests|pass|fail)' } | ForEach-Object { $_.Trim() }) -join ' | ')
Add-Result 'testler' ($LASTEXITCODE -eq 0) $testLine

$lintOut = & node tools/lint.js 2>&1 | Out-String
$lintLine = ($lintOut -split "`n" | Where-Object { $_ -match 'hata' } | Select-Object -Last 1)
Add-Result 'lint' ($LASTEXITCODE -eq 0) $lintLine

$doctorOut = & node tools/doctor.js 2>&1 | Out-String
Add-Result 'doctor' ($LASTEXITCODE -eq 0) (($doctorOut -split "`n" | Where-Object { $_ -match '^Hata:' }) -join '')

if ($Quick) {
    Write-Output 'Quick modu: uygulama adimlari atlandi.'
} else {
    # --- 2) Paket
    if ($SkipBuild) {
        $exe = Join-Path $Root 'dist\BilgiAl\BilgiAl.exe'
        Add-Result 'paket' (Test-Path $exe) $(if (Test-Path $exe) { 'var (build atlandi)' } else { 'dist yok' })
    } else {
        $buildOut = & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\build.ps1') 2>&1 | Out-String
        $exe = Join-Path $Root 'dist\BilgiAl\BilgiAl.exe'
        Add-Result 'paket' (($LASTEXITCODE -eq 0) -and (Test-Path $exe)) $(if (Test-Path $exe) { 'BilgiAl.exe yazildi' } else { 'build basarisiz' })
    }

    if (-not ($results | Where-Object { $_.Adim -eq 'paket' -and $_.Sonuc -eq 'KALDI' })) {
        # --- 3) Deneme uygulamasi (temiz tohum + acilis)
        Stop-Trial
        $seedOut = & node (Join-Path $Root 'work\trial-seed.js') 2>&1 | Out-String
        Add-Result 'tohum' ($LASTEXITCODE -eq 0) (($seedOut -split "`n" | Where-Object { $_ -match '^ayarlar:' }) -join '')

        $trialArgs = @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'tools\trial.ps1'), '-Port', "$Port")
        if ($Dev) { $trialArgs += '-Dev' }
        $launchOut = & powershell @trialArgs 2>&1 | Out-String
        $cdp = Wait-Cdp $Port
        Add-Result 'acilis' $cdp "CDP port=$Port"

        if ($cdp) {
            $env:BILGIAL_CDP_PORT = "$Port"
            $env:BILGIAL_DATA = 'trial-data'

            # --- 4) Gercek cozum uretimi (uçtan uca, model cagrisi dahil)
            $probeOut = & node (Join-Path $Root 'work\trial-probe.js') 2>&1 | Out-String
            $probeOk = $LASTEXITCODE -eq 0
            $media = ($probeOut -split "`n" | Where-Object { $_ -match '^MEDYA ' }) -join ''
            $stage = ($probeOut -split "`n" | Where-Object { $_ -match '^DURUM done' }) -join ''
            Add-Result 'uretim' $probeOk ($stage + ' ' + $media).Substring(0, [Math]::Min(220, ($stage + ' ' + $media).Length))

            # --- 5) Telefondan oynatma (headless Edge, mobil <video>)
            $mobileOut = & node (Join-Path $Root 'work\d045-mobile-media.js') 2>&1 | Out-String
            $mobileOk = $LASTEXITCODE -eq 0
            $video = ($mobileOut -split "`n" | Where-Object { $_ -match '^VIDEO ' }) -join ''
            Add-Result 'telefon' $mobileOk $video.Substring(0, [Math]::Min(240, $video.Length))

            # --- 6) Kurulabilir PWA + cevrimdisi kabuk (headless Edge)
            $pwaOut = & node (Join-Path $Root 'work\d047-install.js') 2>&1 | Out-String
            $pwaOk = $LASTEXITCODE -eq 0
            $pwaCard = ($pwaOut -split "`n" | Where-Object { $_ -match '^KURULUM_KARTI ' }) -join ''
            $pwaOffline = ($pwaOut -split "`n" | Where-Object { $_ -match '^CEVRIMDISI ' }) -join ''
            Add-Result 'kurulum' $pwaOk (($pwaCard + ' ' + $pwaOffline).Trim())

            # --- 7) Ilk adimlar rehberi (headless Edge, gercek state ile)
            $startOut = & node (Join-Path $Root 'work\d048-start.js') 2>&1 | Out-String
            $startOk = $LASTEXITCODE -eq 0
            $startLine = ($startOut -split "`n" | Where-Object { $_ -match '^GIRIS_SONRASI ' }) -join ''
            Add-Result 'rehber' $startOk $startLine

            # --- 8) Sinif / odev / teslim dongusu (D-050)
            $classOut = & node (Join-Path $Root 'work\d050-classes.js') 2>&1 | Out-String
            $classOk = $LASTEXITCODE -eq 0
            $classLine = (($classOut -split "`n" | Where-Object { $_ -match '^(OGRETMEN_SONRA|OGRENCI_SONRA) ' }) -join ' ')
            Add-Result 'sinif' $classOk $classLine

            # --- 9) Sinif icgoruleri + CSV disa aktarma + ogrenci hedefi (D-051)
            $insightOut = & node (Join-Path $Root 'work\d051-insights.js') 2>&1 | Out-String
            $insightOk = $LASTEXITCODE -eq 0
            $insightLine = (($insightOut -split "`n" | Where-Object { $_ -match '^(OGRETMEN|OGRENCI|CSV) ' }) -join ' ')
            Add-Result 'rapor' $insightOk $insightLine

            # --- 10) Sinif donut + hatirlatma akisi (D-052)
            $donutOut = & node (Join-Path $Root 'work\d052-service-probe.js') 2>&1 | Out-String
            $donutOk = $LASTEXITCODE -eq 0
            $donutLine = (($donutOut -split "`n" | Where-Object { $_ -match '^  SONUC: ' }) -join ' ')
            Add-Result 'donut' $donutOk $donutLine

            # --- 10b) Haftalik ozet (D-053)
            $digestOut = & node (Join-Path $Root 'work\d053-service-probe.js') 2>&1 | Out-String
            $digestOk = $LASTEXITCODE -eq 0
            $digestLine = (($digestOut -split "`n" | Where-Object { $_ -match '^SONUC ' }) -join ' ')
            Add-Result 'digest' $digestOk $digestLine

            # --- 11) AI baglantilari: durust durum + tek indirme dugmesi (D-049)
            $connOut = & node (Join-Path $Root 'work\d049-ai-install.js') 2>&1 | Out-String
            $connOk = $LASTEXITCODE -eq 0
            $connLine = (($connOut -split "`n" | Where-Object { $_ -match '^(DUGME|ALT_BASLIK) ' }) -join ' ')
            Add-Result 'baglantilar' $connOk $connLine

            # --- 12) Tek dugmenin indirme akisi (demo koprusu, headless; D-049)
            $instOut = & node (Join-Path $Root 'work\d049-install-demo.js') 2>&1 | Out-String
            $instOk = $LASTEXITCODE -eq 0
            $instLine = (($instOut -split "`n" | Where-Object { $_ -match '^(ONCE|ETIKETLER) ' }) -join ' ')
            Add-Result 'indirme' $instOk $instLine

            # --- 13) Donut + hatirlatma saha akisi: masaustu gercek arayuz + telefon (D-052)
            $fieldOut = & node (Join-Path $Root 'work\d052-field.js') 2>&1 | Out-String
            $fieldOk = $LASTEXITCODE -eq 0
            $fieldLine = (($fieldOut -split "`n" | Where-Object { $_ -match '^(HATIRLAT|MOBIL) ' }) -join ' ')
            Add-Result 'saha' $fieldOk $fieldLine

            # --- 14) Haftalik ozet saha akisi: masaustu ozet penceresi + telefonda ozet (D-053)
            $ozetOut = & node (Join-Path $Root 'work\d053-field.js') 2>&1 | Out-String
            $ozetOk = $LASTEXITCODE -eq 0
            $ozetLine = (($ozetOut -split "`n" | Where-Object { $_ -match '^(OZET|MOBIL) ' }) -join ' ')
            Add-Result 'ozet' $ozetOk $ozetLine

            # --- 15) Uye aramasi + tek ogrenci ozeti (D-054)
            $aramaOut = & node (Join-Path $Root 'work\d054-search.js') 2>&1 | Out-String
            $aramaOk = $LASTEXITCODE -eq 0
            $aramaLine = (($aramaOut -split "`n" | Where-Object { $_ -match '^(ARAMA|OZET) ' }) -join ' ')
            Add-Result 'arama' $aramaOk $aramaLine

            # --- 16) Yaklasan teslimler + yerel bildirim (D-055)
            $yaklasanOut = & node (Join-Path $Root 'work\d055-due.js') 2>&1 | Out-String
            $yaklasanOk = $LASTEXITCODE -eq 0
            $yaklasanLine = (($yaklasanOut -split "`n" | Where-Object { $_ -match '^(OGRETMEN|MASAUSTU|MOBIL|BILDIRIM) ' }) -join ' ')
            Add-Result 'yaklasan' $yaklasanOk $yaklasanLine

            # --- 17) Odev arsivi + geri alma (D-056)
            $arsivOut = & node (Join-Path $Root 'work\d056-archive.js') 2>&1 | Out-String
            $arsivOk = $LASTEXITCODE -eq 0
            $arsivLine = (($arsivOut -split "`n" | Where-Object { $_ -match '^(ARSIV|OGRENCI|GERI) ' }) -join ' ')
            Add-Result 'arsiv' $arsivOk $arsivLine

            # --- 18) Odev tablosu arama + durum suzgeci + siralama (D-057)
            $filtreOut = & node (Join-Path $Root 'work\d057-filter.js') 2>&1 | Out-String
            $filtreOk = $LASTEXITCODE -eq 0
            $filtreLine = (($filtreOut -split "`n" | Where-Object { $_ -match '^(ARAMA_ESLESEN|ARAMA_YOK|DURUM_GECIKMIS|SIRALAMA|KONTROL) ' }) -join ' ')
            Add-Result 'filtre' $filtreOk $filtreLine

            # --- 19) Mobil Odevlerim aramasi + durum suzgeci (D-058, gercek telefon)
            $mobilFiltreOut = & node (Join-Path $Root 'work\d058-mobile-filter.js') 2>&1 | Out-String
            $mobilFiltreOk = $LASTEXITCODE -eq 0
            $mobilFiltreLine = (($mobilFiltreOut -split "`n" | Where-Object { $_ -match '^(ARAMA|BOS|TAMAMLANDI|CELISKI|KONTROL) ' }) -join ' ')
            Add-Result 'mobilfiltre' $mobilFiltreOk $mobilFiltreLine

            # --- 20) Video studyosu: tema, coklu oran, altyazi, kapak (D-059)
            $videoOut = & node (Join-Path $Root 'work\d059-e2e.js') 2>&1 | Out-String
            $videoOk = $LASTEXITCODE -eq 0
            $videoLine = (($videoOut -split "`n" | Where-Object { $_ -match '^(IS_SON|ARTEFAKT|ALTYAZI|KONTROL) ' }) -join ' ')
            Add-Result 'video' $videoOk $videoLine
        }

        Stop-Trial
    }
}

$elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
Write-Output ''
Write-Output '== Ozet =='
foreach ($row in $results) { Write-Output ("  {0,-10} {1}" -f $row.Adim, $row.Sonuc) }
Write-Output ("Sure: {0} sn" -f $elapsed)
if ($failed -gt 0) {
    Write-Output ("SONUC: KALDI ({0} adim)" -f $failed)
    exit 1
}
Write-Output 'SONUC: GECTI - deneme surumu dogrulandi.'
