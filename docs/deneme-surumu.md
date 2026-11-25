# BilgiAl — Deneme Sürümü ve Yerel Model Kademeleri

Bu doküman iki şeyi tanımlar: **(1)** makineye uygun yerel model setinin kademeli
indirilmesi, **(2)** deneme (trial) oturumlarını gerçek uygulamayla çalıştıran hazır
profil. İkisi de tek komutla kurulur; gizli adım, elle dosya kopyalama yoktur.

Ölçülen donanım (2026-11-13): **RTX 4070 Ti SUPER (16 GB VRAM)**, 32 GB RAM,
i7-14700KF (28 mantıksal), C: ~393 GB boş, Ollama v0.40.16.

---

## 1. Model kademeleri — `tools/models-pull.js`

200 GB'ı "gerekli" diye doldurmak yanlış olur: 70B sınıfı bu RAM'de diske takas eder ve
deneme oturumunu yavaşlatır. Bu yüzden set donanıma oturtulmuş **kademelere** bölündü.
Her kademe bir öncekinin üstüne eklenir.

```powershell
node tools/models-pull.js --dry-run            # plan + disk kontrolü (indirmez)
node tools/models-pull.js --yes                # core indir (varsayılan)
node tools/models-pull.js --tier=quality --yes # core + kalite
node tools/models-pull.js --only=qwen3:14b --yes   # tek model
node tools/models-pull.js --tier=core --check  # eksik var mı (çıkış kodu 1 = eksik)
```

| Kademe | Yaklaşık boyut | İçerik | Ne zaman |
|---|---|---|---|
| `core` | **21.5 GB** | `qwen3:8b`, `qwen3:14b`, `minicpm-v:8b`, `bge-m3`, `nomic-embed-text` | Her kurulum. Günlük çözüm + görsel + gömme. |
| `quality` | **~103 GB** | `qwen3:30b-a3b`, `qwen3:32b`, `gemma3:27b`, `qwen2.5vl:32b`, `qwen3-embedding:8b` | Deneme kalitesini yükseltmek isteyince. |
| `speech` | ~5 GB | `faster-whisper-large-v3`, `piper-tr_TR-dfki-medium` | Ses/transkript açılınca (pip ile). |
| `heavy` | ~42 GB | `llama3.3:70b` | **Deneysel**; 32 GB RAM'de yavaş, gerekli sayılmaz. |

Kurallar aracın içinde:

- Yalnız `ollama pull` çalışır; başka bir şey kurmaz, **hiçbir dosyayı silmez**.
- `ollama list` ile kurulu olanı **atlar**; yeniden çalıştırmak güvenlidir.
- Disk yetmezse (%15 pay ile) **hiç indirmeye başlamaz**, çıkış kodu 3.
- Her model 2 kez denenir; indirme Ollama tarafında yarıda kalmışsa kaldığı yerden sürer.
- Günlük: `work/models-pull.log` (her `INDIR`/`TAMAM`/`HATA` satırı).
- Ses klonlama (`xtts-v2`) **rıza kapısındadır**, araç onu indirmez.

Kullanıcı yalnız kendi gerekli gördüğünü indirmek isterse `--only=` ile tam denetim onda:
`node tools/models-pull.js --only=qwen3:30b-a3b,qwen3:14b --yes`.

Mevcut durum (2026-11-13): `core` **5/5** indi; ayrıca `qwen3:30b-a3b` (19 GB) indi.
`work/models-pull.log` son satırı `TAMAM qwen3:30b-a3b`.

---

## 2. Deneme profili — `work/trial-data`

Deneme oturumları **ana veriden ayrı** bir kümede çalışır; gerçek kullanıcı verisine
dokunulmaz. Her tohum çalıştırmasında küme bilinen duruma döner.

### Kurulum

```powershell
node work/trial-seed.js          # sıfırdan kur (varsa üzerine yazar)
node work/trial-seed.js --keep   # kullanıcıları koru, iş/kitaplık yenile
```

Tohumun ürettikleri (hepsi şema kapısından geçer):

| Öğe | Değer |
|---|---|
| Veri dizini | `work/trial-data` |
| Yönetici | `admin@bilgial.local` / `BilgiAl2026` |
| Öğretmen | `ogretmen@bilgial.local` / `BilgiAl2026` |
| Öğrenci | `ogrenci@bilgial.local` / `BilgiAl2026` |
| Öğretmen profili | `verified`, Fizik + Matematik, stil vektörü dolu |
| Öğrenci profili | otomatik oluşturulur, oturum öğrencide açık kalır |
| Kredi | 5000 credit (simüle `p30` satın alma, **gerçek ödeme yok**) |
| İş | `job_trial_1` → `done` |
| Kitaplık | `lib_trial_1`, medya `jobs/job_trial_1/lesson.mp4` |
| Ayarlar | `llm=qwen3:14b`, `vision=minicpm-v:8b`, `allowCloud:false`, ses modeli varsa `tts=piper` |

Parola `BILGIAL_TRIAL_PASSWORD` ile değiştirilebilir. Medya kaynağı
`work/c008-userdata/media/jobs/job_c008_test/lesson.mp4`; yoksa iş medyasız kurulur ve
`pendingModel` işaretlenir (tohum çökmez).

**Model korunur:** tohum yalnız `data/` ve `media/` altını sıfırlar; indirilen modeller
(`models/piper/*.onnx` gibi) korunur. Böylece yeniden tohumlamak 63 MB'lık ses modelini
silmek zorunda kalmaz.

**Ses (TTS):** `piper-tts` Python paketi kuruluysa ve `work/trial-data/models/piper`
altında bir `.onnx` varsa tohum `ai.tts='piper'` + `ai.models.tts=<ses>` yazar; tam ders
videosu üretilebilir. Ses yoksa `voice`/`compose` `pending-model` ile atlanır ve iş
`partial` olur — bu **hata değil**, belgelenmiş durumdur (slayt artefaktı yine üretilir).

### Başlatma

```powershell
powershell -ExecutionPolicy Bypass -File tools/trial.ps1           # paketli exe, port 9791
powershell -ExecutionPolicy Bypass -File tools/trial.ps1 -Seed     # önce veriyi kur
powershell -ExecutionPolicy Bypass -File tools/trial.ps1 -Dev      # electron src
powershell -ExecutionPolicy Bypass -File tools/trial.ps1 -Port 9790
```

Başlatıcı `dist\BilgiAl\BilgiAl.exe`'yi `work/trial-data` ile açar, PID'i
`work/trial.pid`'e yazar ve CDP hazır olana kadar bekler. Veri yoksa önce tohumu çalıştırır.

### Uçtan uca ölçüm

```powershell
$env:BILGIAL_CDP_PORT='9791'; $env:BILGIAL_DATA='trial-data'
node work/trial-probe.js
```

Prob gerçek akışı ölçer: açılış + oturum → `bi:ai:system` (Ollama + GPU) →
`bi:teacher:list` → `bi:job:quote` → `bi:student:upload` → `bi:job:create` → iş bitene kadar
`bi:job:get` → sonuç artefaktının diskte varlığı. `BILGIAL_SOLVE_TIMEOUT_MS`
(varsayılan 25 dk) gerçek model süresini bekler. Ses modeli kuruluysa `voice`+`compose`
de çalışır ve artefakt `audio-slides` (MP4) olur; değilse `partial` + slayt beklenir.

**Sayfa görseli gerçek olmalı.** 8×8 sabit PNG vision modelinde `Failed to load image`
→ `http-error` verir. Prob, ders videosundan çıkarılmış gerçek kareyi kullanır
(`work/trial-page.png`; `BILGIAL_PAGE_PNG` ile değiştirilebilir):

```powershell
ffmpeg -y -ss 5 -i work/trial-data/media/jobs/job_trial_1/lesson.mp4 -frames:v 1 -vf scale=900:-1 work/trial-page.png
```

**Ses modelini kurmak** (uygulamanın kendi kanalı; yeni bağımlılık yok):

```powershell
python -m pip install piper-tts
$env:BILGIAL_CDP_PORT='9791'; node work/d045-tts-install.js   # bi:ai:download ile 63 MB
node work/trial-seed.js                                       # tts=piper otomatik seçilir
```

### Telefondan oynatma ölçümü

Üretilen MP4'ün gerçekten telefonda oynadığını ölçer: köprüyü açar, headless Edge'de
öğrenci olarak girer, mobil istemcinin **kendi** `<video>` öğesini okur.

```powershell
$env:BILGIAL_CDP_PORT='9791'; node work/d045-mobile-media.js
```

Ölçülen (2026-11-14): `readyState 4`, `duration 115.4 sn`, `1280×720`, `error null`,
`src` → `/api/media?path=jobs%2Fjob_...%2Flesson.mp4`, Range `206`,
`bytes 0-1023/1862967`, `video/mp4`, taşma 0, 0 konsol hatası → `GECTI`
(dev **9791** ve paketli **9783** aynı sonuç). Ekran görüntüsü:
`work/d045-mobile-video-360.png`.

> Not: eşleştirme kodu **tek kullanımlıktır**. Prob, API'yi sayfadan önce çağırırsa kod
> tükenir ve sayfa eşleşemez; bu yüzden eşleşmeyi sayfanın kendisi yapar.

### Tek komut doğrulama — `tools/trial-check.ps1`

Deneme sürümünün sağlam olduğunu **tek komutla** kanıtlar; her adım ölçülür ve tek karar
yazılır. Adımlar mevcut araçları çağırır, yeni bağımlılık yoktur.

```powershell
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -Dev        # electron src
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -SkipBuild  # dist hazır
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -Quick      # yalnız kapılar
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -Port 9794
```

| Adım | Ölçüm |
|---|---|
| `testler` | `node --test tests/` → `# tests/# pass/# fail` |
| `lint` | `node tools/lint.js` → `SONUÇ: GEÇTİ` |
| `doctor` | `node tools/doctor.js` → `Hata: 0` |
| `paket` | `tools/build.ps1` → `dist\BilgiAl\BilgiAl.exe` (`-SkipBuild` ile atlanır) |
| `tohum` | `work/trial-seed.js` → seçilen modeller + `tts` satırı |
| `acilis` | `tools/trial.ps1` → CDP `200` |
| `uretim` | `work/trial-probe.js` → 6/6 aşama + artefakt yolu |
| `telefon` | `work/d045-mobile-media.js` → `<video>` `readyState`, Range `206` |
| `kurulum` | `work/d047-install.js` → SW kapsamı, kabuk önbelleği, `api/` dışlaması, ağ kapalıyken açılış |
| `rehber` | `work/d048-start.js` → 4 adım, gerçek durumla eşleşme, sıradaki adım geçişi |
| `sinif` | `work/d050-classes.js` → öğretmen sınıf açtı + ödev verdi, öğrenci katıldı + tamamladı (`done 1`, `%100`, seri 1 gün) |
| `rapor` | `work/d051-insights.js` → 7 gün çubuğu, haftalık `2`, zamanında `%100`, riskli `2`, CSV `<sınıf>.csv · N öğrenci`, öğrenci hedefi `0/1 · 1 kaldı` |
| `donut` | `work/d052-service-probe.js` → 20/20 kontrol, dönüt trim + kayıt, `updatedAt` sabit, plan/üye görünümü, yetki, hatırlatma metni/tarih → `GECTI` |
| `baglantilar` | `work/d049-ai-install.js` → 9 satır, gerçek ffmpeg durumu, rıza rozetleri, tek düğme |
| `indirme` | `work/d049-install-demo.js` → düğme → `%N` ilerleme → `Gerekli her şey kurulu ✓` |

Uygulama adımları sonunda süreç kapatılır (PID `work/trial.pid`). Çıkış kodu `0` = geçti,
`1` = en az bir adım kaldı; özet satırları `work/trial-check.out`'ta da görünür.

### İlk adımlar rehberi (D-048)
Telefonda ilk açılışta ne yapacağını bilmeyen kullanıcı için Ana ekranda **4 adımlı rehber**
vardır. Durum **uydurulmaz**, doğrudan gerçek state'ten okunur:

| Adım | Tamamlanma koşulu |
|---|---|
| Hesabına gir | `state.user` dolu |
| Öğretmen seç, fiyatı gör | en az bir fiyat alındı (`state.quoted`) ya da iş var |
| İlk çözümü üret | `state.jobs.length > 0` |
| Kitaplıkta izle | `state.library.length > 0` |

Sayaç `n / 4`, tamamlanan adım yeşil ve üstü çizili, sıradaki adım vurgulu; tek düğme
kullanıcıyı doğru sekmeye götürür (`Girişe dön`, `Öğretmen seç`, `İlk sorunu yükle`,
`Kitaplığı aç`). Hiçbir adım `localStorage`'a yazılmaz; tarayıcı kapansa da durum
veriden yeniden hesaplanır. Boş listeler artık eylemli: “Henüz iş yok…” + **İlk sorunu yükle**,
kitaplıkta “Henüz çözüm yok…” + **Çözüme git**.

Ölçüm: `work/d048-start.js` (headless Edge 360 px, gerçek öğrenci oturumu) →
giriş öncesi `0 / 4` + düğme `Girişe dön`, giriş sonrası `4 / 4` + düğme `Çözüm üret`,
düğme `solve` sekmesine geçiyor, taşma 0, 0 konsol hatası → `GECTI`.

### AI bağlantıları: tek indirme düğmesi (D-049)

Ayarlar → **AI bağlantıları** kartı artık üç yanılgıyı düzeltir:

| Önce | Şimdi |
|---|---|
| Her satırda “kurulum ipucu yok” | `installHint` metadata'sı IPC'den geçer; satırda kısa, eyleme dönük ipucu |
| ffmpeg sabit “model gerekli” | `compose.ffmpegAvailable()` ile **gerçek** arama (PATH, winget, `Program Files`, `userData/tools`); kuruluysa `hazır` + gecikme |
| XTTS “hazır” (Piper'a bağlıydı) | Ayrı konektör, durum `consent-required` → **rıza gerekli** |
| Wav2Lip/SadTalker “model gerekli” | `consent-required` → yazılı rıza olmadan indirilmez |
| OpenAI uyumlu “yanıt yok” | Sağlayıcı `isteğe bağlı`; probe kodu `endpoint yok` / `çalışmıyor` / `bulut kapalı` olarak ayrı yazılır |

Kartın başlığında **tek düğme** vardır: **Gerekli olanları indir**. Davranışı:

1. `bi:ai:setupState` planı okunur; **eksik ve indirilebilir** adımlar seçilir.
2. Rıza kapısındaki konektörler (`xtts`, `wav2lip`, `sadtalker`) listeye **hiç girmez**.
3. Düğme etiketi eksik adet/boyut yazar (`· 3,1 GB · 3 adım`); eksik yoksa
   **Gerekli her şey kurulu ✓** olur ve kilitlenir.
4. Basılınca `bi:ai:setupStart` çağrılır; 1,5 sn'de bir `bi:ai:setupState` yoklanır,
   etiket `İndiriliyor… %N` olur; bitince sessiz sağlık testi + plan tazelenir.
5. Yönetici olmayan hesapta düğme kilitlidir (sunucu da AI yazmasını yöneticiye kapalı tutar).

Ölçüm:

- `work/d049-ai-install.js` — gerçek uygulama, yönetici: 9 satır, `ffmpeg` `ready` (35 ms),
  XTTS/Wav2Lip/SadTalker `rıza gerekli`, OpenAI `isteğe bağlı`/`endpoint yok`, tüm
  satırlarda ipucu var, düğme `Gerekli her şey kurulu ✓` + kilitli, taşma 0, 0 hata → `GECTI`.
- `work/d049-install-demo.js` — demo köprüsünde 3 eksik adım: düğme
  `Gerekli olanları indir · 3,1 GB · 3 adım` → `İndiriliyor… %0 → %40` →
  `Gerekli her şey kurulu ✓`, `progress 100`, taşma 0, 0 hata → `GECTI`.
  Ekran: `work/d049-install-demo.png`.

### Sınıflar, ödevler ve teslim (D-050)

Öğretmen ile öğrenci arasındaki döngü artık uygulamanın içinde:

- **Öğretmen → Sınıflar** (`#screen-classes`): sınıf açar (`bi:class:create`), 6 karakterli
  katılım kodu üretilir (karışmayan alfabe: `0/O/1/I/L` yok), kodu tek düğmeyle kopyalar,
  ödev verir (`bi:class:assign`, teslim tarihi isteğe bağlı), ödev bazında tamamlanmayı
  görür, sınıf detayında öğrenci × ödev ilerlemesini açar (`bi:class:stats`).
- **Öğrenci → Ödevlerim** (`#screen-tasks`): kodla sınıfa katılır (`bi:class:join`),
  yaklaşan ödev, haftalık yük, seri ve tamamlanma halkası gerçek veriden gelir
  (`bi:class:plan`), ödevi açar (`modal`) ve tamamlar (`bi:class:complete`).
- **Tek doğruluk kaynağı** `src/shared/classes-model.js`: tamamlama = tamamlanan
  (öğrenci × ödev) hücresi / tüm hücreler; ödev durumu `done > watching > overdue > assigned`.
  Servis `src/main/services/classes.js` yalnız yetki/depo/görünüm katmanıdır.
- `classes.json` store belgesidir; her yazım öncesi `validateClassesFile` çapraz bağları
  denetler (bilinmeyen sınıf, sınıfta olmayan öğrenci, yinelenen kod/teslim).
- Öğrenciye **katılım kodu asla dönmez**; üye adları `students.json → users.json` zinciriyle
  çözülür, e-posta gösterilmez.

Ölçüm:

- `tests/classes.test.js` — 11/11 (saf model, analitik, uçtan uca akış, yetki, arşiv, admin,
  kanal bağlantısı, gerçek `classes.json`).
- `work/d050-classes.js` — gerçek uygulama, headless CDP: öğretmen sınıf açar (kod `LCJAN5`),
  ödev verir; öğrenci kodla katılır ve ödevi tamamlar; öğretmen KPI `0 → 1`, öğrenci
  `pending 0`, `done 1`, `progress %100`, `streak 1 gün`, taşma 0, 0 konsol hatası → `GECTI`.
  Ekran: `work/d050-classes.png`.

### Sınıf içgörüleri, CSV dışa aktarma ve günlük hedef (D-051)

Sınıf döngüsü ölçümden eyleme döndü:

- **Öğretmen → Sınıflar → Sınıf içgörüleri:** haftalık tamamlanma (son 7 gün, çubuk grafik),
  zamanında teslim oranı, riskli öğrenci sayısı. Üye satırında `gecikmiş` / `eksik` /
  `güncel` rozeti; sayılar `bi:class:stats` yanıtındaki `insights` alanından gelir.
- **CSV indir:** `bi:class:export` sınıfın öğrenci bazında ilerlemesini (`Öğrenci,
  Tamamlanan, Toplam ödev, Eksik, Gecikmiş, Tamamlama %`) üretir; renderer UTF-8 BOM'lu
  dosyayı indirir, bildirim dosya adı ve satır sayısını yazar. Kanala yalnız öğretmen/admin
  erişir; öğrenciye `forbidden`.
- **Öğrenci → Ödevlerim → Bugünün hedefi:** hedef, bugün teslimi olan + gecikmiş + bugün
  tamamlanan ödevlerden otomatik hesaplanır (en çok 3); boş günde hedef 0'dır ve sahte
  baskı üretilmez. Kart ilerleme çubuğu ve yüzde rozetiyle gelir.
- **Tek doğruluk kaynağı korunur:** `weeklyActivity`, `studentRisk`, `dailyGoal`, `toCsv`
  `src/shared/classes-model.js` içinde; servis yalnız yetki/depo/görünüm katmanıdır.
  CSV'de formül enjeksiyonu (`=`, `+`, `-`, `@`) etkisizleştirilir, alanlar CRLF ile ayrılır.

Ölçüm:

- `tests/classes.test.js` — D-051 için 6 yeni test (haftalık ritim, risk sıralaması,
  içgörü oranı, günlük hedef sınırı, CSV kaçırma, servis + yetki) → toplam **252/252**.
- `work/d051-insights.js` — demo köprüsü, headless: öğretmen `#cls-week` 7 gün,
  haftalık `2`, zamanında `%100`, riskli `2`, CSV bildirimi `11-a-fizik.csv · 2 öğrenci`;
  öğrenci hedefi `0/1 ödev · 1 kaldı`, `%0`; taşma 0, 0 konsol hatası → `GECTI`.
  Ekran: `work/d051-insights.png`.

### Ödev dönütü ve hatırlatma (D-052)

Öğretmen → öğrenci döngüsüne **dönüt** ve **gecikme hatırlatma** katmanı eklendi; tek doğruluk
kaynağı yine `src/shared/classes-model.js` (`overdueCells`, `reminderMessage`) kaldı.

- **Öğretmen → Sınıflar → üye satırı → Dönüt:** öğretmene bir öğrencinin ödevine metin
  dönütü yazılır (`bi:class:feedback`, yazma + `confirm`); dönüt `submissions[].feedback
  = {text, at, by}` içinde **teslim kaydının** içinde durur ve `updatedAt` **değişmez** —
  öğretmen notu öğrenci etkinliği sayılmaz, haftalık ritim ve seri bozulmaz. Öğretmen
  seçili ödevde kayıtlı dönütü yazar/okur; öğrenci `bi:class:plan` yanıtında kendi dönütü
  olarak görür, başka öğrencinin dönütü görünmez.
- **Öğretmen → Sınıflar → “Hatırlat”:** seçili sınıfın gecikmiş hücrelerini
  (`bi:class:remind`) öğrenci adı + sınıf + ödev + teslim tarihiyle kopyalanabilir metne
  çevirir; her satıra **Kopyala**, üst teker **Tümünü kopyala**. Metin tek kaynaktan
  (`model.reminderMessage`), Türkçe kullanıcıya `gg.aa.yyyy` biçiminde tarih içerir.
- **Öğrenci → Ödevlerim:** dönüt varsa ödev satırında `Dönüt: …` işaretli pill ve
  “Öğretmen dönütü” kartı (`task-feedback`) gösterir.
- **Telefon → Ödevlerim sekmesi:** yalnız `student` rolünde görünen yeni sekme
  (`GET /api/tasks`, `POST /api/tasks/complete`) günlük hedefi, bekleyen/tamamlanan/seri
  sayılarını ve ödev listesini gösterir; ödev satırında dönüt ve **Tamamla** düğmesi vardır.
  Tamamlama masaüstüyle aynı servisi (`classes.complete`) kullanır, katılım kodu ve başka
  öğrencinin kaydı dönmez. Telefonda sınıfa katılma **yoktur**; form bunu açıkça söyler
  (“Sınıfa katılma masaüstünden yapılır”). Öğretmen/admin `GET /api/tasks` → `forbidden`.

Ölçüm:

- `tests/classes.test.js` — D-052 servis testleri (dönüt yazma/görünüm/yetki/`updatedAt`
  sabit/hatırlatma) + `tests/ui.test.js` D-052 (kanallar, ekran, CSS) +
  `tests/mobile-tasks.test.js` 5 test (statik kabuk + gerçek HTTP canlı akış) → toplam
  **260/260**.
- `work/d052-service-probe.js` — gerçek servis katmanı (geçici veri): **20/20** kontrol
  `GECTI` (dönüt trim + kayıt, `updatedAt` bozulmadı, `done` korundu, öğrenci planında
  göründü, başka öğrenci görünmedi, yetkiler + admin, hatırlatma listesi/metni/tarih
  `gg.aa.yyyy`, e-posta sızıntısı yok, şema doğrulaması).
- `work/d052-field.js` — **saha**: gerçek uygulama (dev CDP 9791) + gerçek telefon köprüsü +
  headless Edge 360×800. Öğretmen gecikmiş ödev verir → **Hatırlat** penceresinde 4 satır
  (“Merhaba … Teslim tarihi: 15.11.2026…”), “Tümünü kopyala” → `Metin` bildirimi → **Dönüt**
  kaydı ve üye satırında dönüt görünür → telefonda sekme açık, hedef `2/3 · 1 kaldı`, dönüt
  satırı, **Tamamla** → durum `done`, taşma 0, 0 konsol hatası → `GECTI`.
  Ekranlar: `work/d052-desktop.png`, `work/d052-mobile.png`.
- `tools/trial-check.ps1` — 17 adım (yeni `donut` + `saha` + `digest`), uçtan uca `GECTI`.

### Haftalık özet metni (D-053)

Öğretmen sınıfın haftalık özetini kopyalanabilir metin olarak alır; öğrenci yalnız kendi
özetini görür. Tek doğruluk kaynağı `src/shared/classes-model.js` (`classSummary`) kaldı.

- **Öğretmen → Sınıflar → “Özet”:** seçili sınıfın son 7 günlük özetini
  (`bi:class:digest`) kopyalanabilir metin olarak gösterir (dönem, zamanında teslim oranı,
  bu hafta tamamlanan, riskli öğrenci, öne çıkan 3 öğrenci). **Kopyala** düğmesi panoya
  yazar. `#screen-classes` üye satırının yanında **Özet** düğmesi (`#btn-class-digest`).
- **Öğrenci → Ödevlerim:** kendi haftalık özetini alır (`bi:class:digest`, tek çağrı,
  kendi satırı). `#screen-tasks` özet alanı (`#tasks-digest`) + **Kopyala** düğmesi
  (`#btn-tasks-digest`). Özet metni `digest__text` stiliyle gösterilir.
- **Yetki:** öğretmen/admin sınıfın tamamını alır (studentId null); öğrenci yalnız kendi
  özetini alır; yabancı öğretmen ve üye olmayan öğrenci `forbidden`. Metinde e-posta ve
  katılım kodu yoktur.

Ölçüm:

- `tests/classes.test.js` — D-053 model (`classSummary` biçimi, e-posta/kod sızdırılmazlık)
  + servis yetki testleri (öğrenci kendi özeti, yabancı öğrenci `forbidden`,
  öğretmen/admin tam sınıf, `studentId` üye değilse `forbidden`) → toplam **264/264**.
- `tests/ui.test.js` — D-053 UI kimlik/kural testleri (özet düğmesi, modal, kanal,
  CSS sınıfları).
- `work/d053-digest.js` — demo köprüsü: öğretmen özet modalı, kopyala, öğrenci kendi
  özeti, taşma 0, 0 konsol hatası → `GECTI`.
- `tools/trial-check.ps1` — 17 adım, uçtan uca `GECTI`.

### Kurulabilir uygulama (PWA) ve çevrimdışı kabuk

Mobil istemci telefonun ana ekranına **uygulama** olarak kurulabilir; Wi-Fi kopsa da arayüz
açılır, PC dönünce canlı veri gelir.

- `src/web/manifest.webmanifest`: `display:standalone`, `start_url:/`, `scope:/`,
  `icon-192.png` + `icon-512.png` (+ maskable). Uzak varlık yok.
- `src/web/sw.js`: yalnız kabuk önbelleği (`index.html`, `app.js`, `style.css`, `tokens.css`,
  manifest, ikonlar). **`/api/*` ve `/api/media` asla** — canlı durum ve Range/206 bozulmaz.
  `index.html` network-first, diğer kabuk dosyaları stale-while-revalidate.
- `mobile-server.js`: `sw.js` ve `.html` `cache-control: no-store`,
  `Service-Worker-Allowed: /`; ikonlar `image/png` MIME'ıyla.
- Arayüzde **“Ana ekrana ekle”** kartı: durum `kurulabilir → kurulu`, iOS'ta elle yol
  (Paylaş → Ana Ekrana Ekle), diğer tarayıcılarda menü yolu.

Ölçüm (`work/d047-install.js`, headless Edge 360 px):

```powershell
$env:BILGIAL_CDP_PORT='9791'; node work/d047-install.js
```

Ölçülen (2026-11-14): SW `ready` **true**, kapsam `http://127.0.0.1:4780/`, önbellek
`bilgial-shell-v1` 9 kabuk anahtarı, `apiKeys []`; kurulum kartı `kurulabilir` + düğme
görünür; **ağ kapalıyken** yeniden açılışta `title BilgiAl · Ana`, kabuk metni var,
`controller true`, 0 konsol hatası, taşma 0 → `GECTI` (dev 9791 + paketli 9783).
Ekran: `work/d047-install-360.png`.

### Haftalık özet metni (D-053)

Öğretmen sınıfın son 7 gününü, öğrenci yalnız kendi haftasını **kopyalanabilir metne** çevirir.
Tek doğruluk kaynağı `src/shared/classes-model.js` → `classSummary`; sayılar yine
`classInsights` (zamanında teslim, haftalık tamamlanan, riskli öğrenci) üzerinden gelir.

- Kanal `bi:class:digest` (okuma). Öğretmen/admin sınıfın tamamı ya da sınıf üyesi tek öğrenci
  için özet alır; **öğrenci yalnız kendi** özetini alır (verdiği `studentId` yok sayılır).
  Yabancı öğretmen ve üye olmayan öğrenci `forbidden`; üye olmayan `studentId` de `forbidden`.
- Metin: `Sınıf · haftalık özet (gg.aa.yyyy – gg.aa.yyyy)`, `Zamanında teslim: %N · a/b`,
  `Bu hafta tamamlanan: N ödev`, sınıf özetinde `Riskli öğrenci: n/m` + öne çıkan 3 öğrenci,
  öğrenci özetinde `Öğrenci: …`, `Tamamlama: a/b ödev · %N`, `Gecikmiş/eksik`, `Yazılan dönüt`,
  `Son etkinlik`. **E-posta ve katılım kodu metne girmez.**
- Öğrenci `classId` vermezse en son katıldığı sınıfı özetler; hiç sınıfı yoksa **boş metin**
  döner ve ekran “özet yok” der (hata üretilmez).
- Arayüzler: Sınıflar → **Özet metni** (`#btn-class-digest`, `#digest-text`, Kopyala),
  Ödevlerim → **Haftalık özetim** kartı (`#tasks-digest`, `#btn-tasks-digest`),
  telefon → Ödevlerim → özet kartı (`#tasks-digest`, `#btn-copy-digest`; pano API'si yoksa
  `execCommand` yedeği). Telefon yanıtı `GET /api/tasks` içinde `digest: {text, className}`.

Ölçüm:

- `tests/classes.test.js` — D-053 model + servis testleri (biçim, e-posta/kod sızdırmama,
  tek öğrenci, sınıfsız öğrenci, yetkiler) → toplam **264/264**; `lint 0 hata`.
- `work/d053-service-probe.js` — gerçek servis katmanı (geçici veri): **23/23** kontrol
  `GECTI` (öğretmen/öğrenci/admin, tek öğrenci, dönüt sayısı, `classId` verilmeyen öğrenci,
  sınıfsız öğrenci boş metin, yabancı öğretmen/öğrenci ve bilinmeyen `studentId` → `forbidden`,
  tarih `gg.aa.yyyy`, şema doğrulaması).
- `work/d053-field.js` — **saha**: gerçek uygulama (dev CDP 9791) + gerçek köprü + headless
  Edge 360×800. Masaüstünde “Özet metni” penceresi (239 karakter, 4 satır başlık) ve
  “Kopyala” → `Metin` bildirimi; telefonda öğrenci kendi özetini gördü (216 karakter),
  **Kopyala** → “Özet metni kopyalandı.”, taşma 0, 0 konsol hatası → `GECTI`.
  Ekranlar: `work/d053-desktop.png`, `work/d053-mobile.png`.
- `tools/trial-check.ps1` — 17 adım (yeni `ozet`); uçtan uca `GECTI` (206 sn).

Ölçüm:

- `tests/ui.test.js` — “üye araması ve tek öğrenci özeti (D-054)” (arama alanı, `searchKey`,
  süzme, dürüst boş durum, dinleyici, `openDigest(member.studentId)`, istek gövdesi, stils)
  → toplam **265/265**; `lint 0 hata`.
- `work/d054-search.js` — **saha**: gerçek uygulama (dev CDP 9791), öğretmen arayüzü.
  `baseline 1` → `zzzqqq` **0 satır** + “ile eşleşen öğrenci yok.” → `Den` **1 satır** →
  temizleme `1`; üye satırından **Özet** → 217 karakter, `Öğrenci:` satırı var, e-posta yok,
  başlık dönemi `2026-11-11 – 2026-11-17`, **Kopyala** → `Metin`, pencere kapandı, 0 konsol
  hatası → `GECTI`. Ekran: `work/d054-desktop.png`.
- `tools/trial-check.ps1` — 19 adım (`arama` eklendi); uçtan uca `GECTI` (223 sn).

### Yaklaşan teslimler + yerel bildirim (D-055)

Öğrenci, teslim tarihi 48 saat içinde olan ödevleri tek kartta ve satır rozetinde görür;
uygulama açıkken en fazla 6 saatte bir tek yerel bildirim çıkar. **Yeni kanal yoktur** (92 kalır);
`plan` ve `stats` yanıtları zenginleşti.

- `src/shared/classes-model.js` → `dueInfo(dueAt, now)` tek kaynak: `Süresi geçti`,
  `Son 1 saat`, `Bugün HH:MM`, `Yarın HH:MM`, `N gün kaldı`, 8 günden uzakta `gg.aa.yyyy`;
  `soon` = 0 < kalan ≤ 48 saat, `overdue` = kalan ≤ 0, `hoursLeft` geçmişte 0'a kırpılır.
- `classes.assignmentView`/`studentAssignmentView` → `due`; `classes.stats` → `upcoming`
  (sınıf bazında, tamamlanmamış, en çok 5); `classes.plan` → `plan.upcoming`.
- `src/main/services/notify.js` → `buildMessage` (tek ödev: `Başlık (sınıf) — etiket`,
  çok ödevde en fazla 3 ad), `shouldNotify` (`MIN_GAP_MS` **6 saat**), `maybeNotify`
  (enjekte edilebilir `setNotifier`, `force`, `reason: shown|quiet|empty|unsupported`);
  bildirim durumu yalnız bellekte, **yeni şema/ayar yok**.
- `main.js` → `bi:class:stats` ve `bi:class:plan` yanıtından sonra `notify.maybeNotify(...)`.
- Masaüstü: `#tasks-upcoming-card` (Ödevlerim; başlık, alt başlık, sayaç, satırlar),
  `screens/tasks.js` `renderUpcoming()` + `due.label`; sınıf ödev tablosunda `.due-pill`
  (yalnız tamamlanmamış ve 48 saat içinde).
- Telefon: `#tasks-upcoming-card` (boşken gizli) + `plan.upcoming` satırları;
  `makeTaskRow` `.task-row__due` rozeti; `dueLabel` sunucu etiketini kullanır.
- Demo köprüsü: `demoDueInfo`/`demoUpcoming`, `plan.upcoming`, ödev görünümlerinde `due`.

Ölçüm:

- `tests/classes.test.js` — D-055 dört test: etiket sınırları (`Son 1 saat`, `Bugün`,
  `Yarın`, 49 saat → `soon:false`, uzak tarih `gg.aa.yyyy`), `plan.upcoming` 48 saat filtresi
  (yakın/uzak/tarihsiz; tamamlanınca listeden çıkma; öğretmen `forbidden`), `stats.upcoming`,
  `notify` (metin, 6 saat sessizlik, `force`, boş liste, hata yutma).
- `tests/ui.test.js` — “yaklaşan teslimler arayüzü (D-055)” (kimlikler `\sid=` ile, render,
  rozet, demo köprü, stiller); `tests/mobile-tasks.test.js` — “mobil … kart ve satır rozeti”
  (kart gizli başlar, `plan.upcoming`, `assignment.due.soon`, token denetimi) → toplam
  **271/271**; `lint 0 hata`.
- `work/d055-due.js` — **saha**: gerçek uygulama (dev CDP 9791) + gerçek köprü + headless
  Edge 360×800. Öğretmen tablosunda **2** `.due-pill` (`Bugün 02:59`, ton `warning`);
  öğrenci masaüstünde kart görünür, **2 satır**, sayaç `2`, alt başlık “2 ödev 48 saat içinde”;
  telefonda aynı **2 satır** + **2** `.task-row__due` rozeti; taşma 0, 0 konsol hatası;
  `notify` ilk çağrı `shown` + 6 saat içinde `quiet` → `GECTI`.
  Ekranlar: `work/d055-desktop.png`, `work/d055-mobile.png`.
- `tools/trial-check.ps1` — **20 adım** (`yaklasan` eklendi).

> Not: kart atlama çubuğu kimliksiz kartlara `jump-…` kimliği üretir; bu yüzden yaklaşan kartı
> gerçek `id="tasks-upcoming-card"` taşır. İlk sürümde yalnız `data-testid` yazılmıştı ve saha
> probu kartı bulamadı; düzeltildi ve test `\sid=` ile sıkılaştırıldı.

### Ödev arşivi + geri alma (D-056)

Öğretmen eski ödevleri listeden kaldırabilir ve yanlış arşivlediğini tek tıkla geri alabilir.
Servis (`bi:class:archive`) zaten vardı ama **arayüzde hiç giriş yoktu**; D-056 bunu kapatır.
**Yeni kanal yoktur** (92 kalır).

- `classes.archiveAssignment` artık `archivedAt` yazar (arşivde ISO tarih, geri alınca `null`) ve
  yanıtı daraltılmış `{assignment: {id, archived, archivedAt}}` olur.
- `classes.stats` yanıtı `archived` listesini taşır (yalnız o sınıfın arşivli ödevleri, en yeni
  arşiv önce; `title`, `done`, `total`, `dueAt`, `createdAt`, `archivedAt`).
- Model doğrulayıcı `archivedAt` alanını kabul eder: `null` ya da ISO tarih; bozuk tarih hata verir.
- Masaüstü ödev tablosuna **İşlem** sütunu ve `.archive-btn` **Arşivle** düğmesi; altında
  `#class-archive-card` (**Arşiv**) kartı: satır başına başlık, `Arşiv: gg Ay yyyy · n/m tamamlandı`
  ve **Geri al**. Kart boşken gizlidir, sayaç `#class-archive-pill` satır sayısıyla aynıdır.
- Arşivli ödev `list`, `plan`, `stats.assignments`, `upcoming`, içgörü, CSV ve özetlerden düşer;
  öğrenci ne ödev listesinde ne yaklaşanlarda görür. Geri alınca her şey eski hâline döner.
- Demo köprüsü aynı davranışı taklit eder (`archivedAt`, `stats.archived`).

Ölçüm:

- `tests/classes.test.js` — “ödev arşivlenir, geri alınır ve hesaplardan düşer (D-056)”:
  daraltılmış yanıt, ISO `archivedAt`, `stats.assignments` 2 → 1, `stats.archived` 1, `upcoming` 0,
  öğrenci `list`/`plan` dışlaması, CSV'de ödev yok, geri alınca tarih `null` ve liste 2,
  yabancı öğretmen `forbidden`, bilinmeyen ödev `assignment-not-found`, şema doğrulaması.
- `tests/ui.test.js` — “ödev arşivi arayüzü (D-056)” (kimlikler, render, iki düğme, istek gövdesi,
  demo köprü, stiller) → toplam **273/273**; `lint 0 hata`.
- `work/d056-archive.js` — **saha**: gerçek uygulama (dev CDP 9791). Önce 7 satır, arşiv kartı gizli;
  **Arşivle** → kart görünür, **1** satır, meta `Arşiv: 17 Kas 2026 · 0/1 tamamlandı`, sayaç `1`,
  tablo 6 satır, hedef listede yok, diğer ödev duruyor; öğrencide hedef ödev listede ve
  yaklaşanlarda yok; **Geri al** → tablo 7 satır, kart gizli, arşiv 0; taşma 0, 0 konsol hatası
  → `GECTI`. Ekran: `work/d056-desktop.png`.
- `tools/trial-check.ps1` — **21 adım** (`arsiv` eklendi).

### Ödev tablosu: arama + durum süzgeci + sıralama (D-057)

Kalabalık ödev listesinde öğretmen aradığını bulur ve listeyi istediği gibi sıralar. Tamamı
arayüz katmanıdır; istek yok, **yeni kanal yoktur** (92 kalır).

- `.assignment-tools` içinde üç denetim: `#assignment-search` (`type="search"`, `.input--sm`),
  `#assignment-state` (`Tüm durumlar` + `Atanmış / İzleniyor / Gecikmiş / Tamamlandı`),
  `#assignment-sort` (`Teslim tarihi (yakın önce)` varsayılan, `Yayın tarihi (yeni önce)`,
  `Başlık (A–Z)`, `Tamamlama (düşük önce)`).
- `visibleAssignments()` tek kaynak: arama D-054 `searchKey` ile Türkçe harf duyarsızdır ve
  başlık + sınıf + not üzerinde çalışır; durum süzgeci `assignment.state` ile birebir eşleşir;
  sıralamada teslim tarihi olmayanlar **sonda** (`Number.MAX_SAFE_INTEGER`), eşitlikte başlık.
- `renderAssignmentTools(total, shown)` yalnız süzgeç etkinken görünür: `n / m ödev gösteriliyor`
  (+ `· durum: <etiket>`). Eşleşme yoksa **sahte satır yok**: `Eşleşen ödev yok` boş durumu.
- Dinleyiciler: arama `input`, süzgeç/sıralama `change` → yalnız tablo yeniden çizilir.

Ölçüm:

- `tests/ui.test.js` — “ödev tablosu arama, durum süzgeci ve sıralama (D-057)” (kimlikler,
  dört durum ve dört sıralama seçeneği, `visibleAssignments`, `renderAssignmentTools`, dürüst
  boş durum, üç dinleyici, `searchKey`, tarihsizler sonda, `rows.map`, token denetimi)
  → toplam **274/274**; `lint 0 hata`.
- `work/d057-filter.js` — **saha**: gerçek uygulama (dev CDP 9791), öğretmen arayüzü.
  Taban **13+ satır**; `vektor` → yalnız `Vektörler` satırları (`2 / 13 ödev gösteriliyor`);
  `zzzqqq` → **0 satır** + `Eşleşen ödev yok` + `0 / 13`; temizleme → taban; `gecikmiş` süzgeci →
  tek durum `gecikmiş`; `tamamlandı` → `2 / 13 · durum: tamamlandı`; sıralamalar: teslim
  tarihi (tarihsizler **sonda**), başlık (Türkçe `Intl.Collator('tr')` ile aynı), tamamlama
  (artan); taşma 0, 0 konsol hatası → `GECTI`. Ekran: `work/d057-desktop.png`.
- `tools/trial-check.ps1` — **22 adım** (`filtre` eklendi).

### Mobil "Ödevlerim": arama + durum süzgeci (D-058)

Telefonda onlarca ödev arasında kaybolmak yok: arama ve durum süzgeci masaüstü D-057 ile aynı
davranışı verir. Tamamen arayüz katmanıdır; **yeni kanal yoktur** (92 kalır).

- `#tasks-search` (`type="search"`, `Ödev ara`) + `#tasks-state` (`Tüm durumlar`, `Atanmış`,
  `İzleniyor`, `Gecikmiş`, `Tamamlandı`) + `#tasks-tools-note` özet satırı.
- `taskSearchKey()` D-054/D-057 ile aynı Türkçe harf duyarsız katlama; `visibleTasks()` başlık +
  sınıf + dönüt üzerinde arar, durum süzgeci `assignment.state` ile birebir eşleşir, **sunucu
  sırası korunur**.
- `renderTaskTools(total, shown)` yalnız süzgeç etkinken görünür: `n / m ödev gösteriliyor`
  (+ `· durum: <etiket>`). Sonuç yoksa dürüst boş durum: sorgu varsa `"<sorgu>" ile eşleşen ödev
  yok.`, yalnız durum seçiliyse `Bu durumda ödev yok.`
- Dinleyiciler: arama `input`, durum `change` → yalnız liste yeniden çizilir.

Ölçüm:

- `tests/mobile-tasks.test.js` — D-058 için 7 test (kimlikler, dört durum seçeneği,
  `taskSearchKey`/`visibleTasks`, süzgeç özeti, dürüst boş durum, iki dinleyici, token denetimi).
- `work/d058-mobile-filter.js` — **saha**: gerçek uygulama (dev CDP 9791) + gerçek telefon köprüsü
  (`bi:mobile:start`/`rotate`) + headless Edge (360×800). Üç ödev kuruldu (gecikmiş, atanmış,
  tamamlanmış). Taban `3` satır ve not gizli; `gecikmis` → **1** satır (`Gecikmiş Vektörler`);
  `suzgec sinifi` → **3**; `zzzz` → **0** satır + `“zzzz” ile eşleşen ödev yok.`;
  durum `tamamlandı` → yalnız `done` (`· durum: tamamlandı`); durum `gecikmiş` → yalnız `overdue`;
  `gecikmiş` + `olasilik` → **0** satır (dürüst); sıfırlama → `3`; taşma 0, 0 konsol hatası →
  `GECTI`. Ekran: `work/d058-mobile-filter.png`.
- `tools/trial-check.ps1` — **23 adım** (`mobilfiltre` eklendi).

### Video stüdyosu: tema, çoklu oran, altyazı, kapak (D-059)

Üretim artık yalnız "ders videosu" değil, **stüdyo ayarlı** video: tema, üç oran, giriş/kapanış
kartı, altyazı dosyası, kapak görseli ve soru görseli küçük penceresi. Motor saf fonksiyonlara
ayrıldı; ffmpeg çağrısı yine `ai/compose.js` içinde kalır (motor dosya yazmaz, süreç başlatmaz).

- `ai/video.js`: 6 tema (`gece/gunes/orman/kagit/mor/okyanus`), 3 format (`16x9/9x16/1x1`) tam
  geometri, `normalizeOptions`, `buildTimeline` (giriş/kapanış kartları), `buildCaptions/Srt/Vtt`,
  `buildChapters/chapterText`, `chunkSpeech`, `wrapText`, `estimateTextWidth`, `alphaExpr`,
  `buildFilters` (gradyan arka plan, PiP kaynak görsel, sahne rozetleri, geçişli `drawtext`,
  ilerleme çubuğu, filigran), `silenceWav`, `describe`, `timecode`, `knownFormats`.
- `ai/compose.js`: sessiz kart WAV'ları, `scenes.json` schemaVersion **2** (theme/options/captions/
  chapters/videos/cover), çoklu format render, `cover.jpg`, `captions.srt/vtt`, `chapters.txt`,
  `filter.txt` + `render-error.txt` hata ayıklama, `renderErrors`.
- `pipeline.js`: `videoOptions`, ilk sayfayı `jobs/<id>/source/page-01.<ext>` kopyalar
  (`ingest.sourceImage`), aşama notu tema/video/altyazı sayısını yazar.
- `jobs.js`: `input.video = studio.normalizeOptions(input.video)`; yeniden denemede seçenekler
  taşınır. `library.js`: `videos/coverPath/captionsPath/captionsVttPath/chaptersPath/theme`
  saklanır, silmede temizlenir. `mobile-server.js`: `.srt`/`.vtt` MIME, `libraryView` içinde
  `cover`/`captions`/`videos` URL'leri.
- Arayüz: `#workspace-video` kartı (tema, oranlar, giriş/kapanış, altyazı/kapak/PiP anahtarları,
  `#video-note`, `#video-estimate`); oynatıcıda `poster`, `track kind="captions"` ve
  `player-formats` oran düğmeleri (konum ve hız korunur).

Ölçüm:

- `tests/video.test.js` — **25/25**: motor, zaman çizelgesi, altyazı/bölüm, filtre sözdizimi,
  gerçek metrik yerleşim sığması, arayüz sözleşmesi, şema ve bağımlılık denetimi.
- `work/d059-render-probe.js` — motoru gerçek ffmpeg ile doğrular: 3 format
  (1280×720 312 KB, 720×1280 267 KB, 1080×1080 637 KB), 19,1 sn, 14 altyazı bloğu, kapak +
  SRT/VTT + chapters, `GECTI`.
- `work/d059-measure.js` — gerçek Segoe UI metrikleriyle (headless Edge canvas) en kötü senaryo
  yerleşimi: **9/9 sığdı**.
- `work/d059-studio-ui.js` — kart görünür, tema/oran/anahtar özeti, zorunlu ilk oran, giriş 0 /
  kapanış 12 sınırı, taşma 0, 0 konsol hatası → `GECTI`. Ekran: `work/d059-video-studio.png`.
- `work/d059-e2e.js` — **uçtan uca**: öğretmen profili (ses + transkript + rıza + LLM eğitimi),
  yönetici onayı, öğrenci yüklemesi, iş oluşturma (orman teması, 16:9 + 9:16, altyazı, kapak,
  PiP, giriş 2 / kapanış 3 sn), üretim **30 sn** içinde `done`: 3 sahne, `lesson.mp4` 1 511 485
  bayt + `lesson-9x16.mp4` 1 397 882 bayt, `cover.jpg` 35 709 bayt, 15 altyazı bloğu,
  `chapters.txt`, `scenes.json` (2 format); oynatıcıda poster + altyazı izi + oran düğmeleri,
  9:16'ya geçişte kaynak dosya değişti → `GECTI`. Ekran: `work/d059-library-player.png`.
- `tools/trial-check.ps1` — **24 adım** (`video` eklendi).

### Deneme ZIP'i (D-057 turu)

`tools/package.ps1` tek komutla paket üretir: `dist\BilgiAl` + `Baslat-Deneme.cmd` +
`OKU-BENI.txt` + `KURULUM-VE-TEST.md` + **temiz tohumlanmış `deneme\` profili**
(`data`, `media`, `models/piper`), kök klasör `BilgiAl\`.

```powershell
powershell -ExecutionPolicy Bypass -File tools/package.ps1
```

Ölçülen: `BilgiAl-0.2.0-deneme.zip` **177 girdi**, **217 440 695 bayt**, SHA256
`CA8DEA94CC16252B0D60F76C930B5774B077F42060C6F862EF6404779A2B423E`; paket dumanı
(`work/pkg-smoke.js`, paketli exe + `deneme` profili): giriş `student`, kitaplık 1 kayıt,
medya 491 050 bayt, Piper ses modeli 63 201 294 bayt, `tts piper / cloud false` → `GECTI`.

---

## 3. Deneme sürümü kuralları

- Deneme kümesi ana veriden ayrıdır; `--user-data-dir=work/trial-data` ile açılır.
- Gerçek ödeme yok: kredi satın alma simülasyondur ve yanıt `paymentMode:'simulated'`
  ile bunu söyler.
- Bulut kapalı (`allowCloud:false`); deneme tamamen yerelde çalışır.
- Ses klonlama (XTTS) ve avatar/lip-sync, yazılı rıza (`consent.json`) olmadan açılmaz.
- Deneme verisi `work/` altındadır; `dist/` paketi veri taşımaz.
