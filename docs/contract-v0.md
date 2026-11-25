# BilgiAl — Teknik Sözleşme v0 (LDR direktifi)

Bağlayıcı. Değişiklik yalnız LDR onayıyla. Kaynak: `docs/urun-brief.md`, `docs/ekonomi.md`, `docs/ai-mimari.md`.

## 1. Yığın

- Electron **45.2.1** (`C:\Users\alibs\Keyvotion\src\node_modules` kopyalanır), `src/` altında düz HTML/CSS/ESM.
- **Yeni çalışma zamanı bağımlılığı yok.** Node yerleşikleri + `electron`.
- `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`; tüm IO main proses.
- Veri: `userData/data/*.json`; medya: `userData/media/`; atomik yazma; `safeStorage` sırlar.
- AI: yalnız main proses HTTP ile (`127.0.0.1:11434` vb.). Renderer'da `fetch` yok. CSP `default-src 'self'`.

## 2. Dosya haritası ve sahiplik

```
src/package.json                    OPS
src/main/main.js                    DEV-1   pencere, menü, IPC kaydı, kuyruk başlatma
src/main/services/store.js          DEV-1   JSON atomik yazma, doğrulama, kilit
src/main/services/settings.js       DEV-1   ayarlar + safeStorage
src/main/services/accounts.js       DEV-1   kayıt/giriş (yerel), rol, parola hash (scrypt)
src/main/services/teachers.js       DEV-1   öğretmen, video, profil eğitimi, doğrulama
src/main/services/students.js       DEV-1   öğrenci, sayfa yükleme
src/main/services/jobs.js           DEV-1   iş kuyruğu, aşama durumları, iptal, retry
src/main/services/credits.js        DEV-1   defter, rezerve/settle/refund, öğretmen payı
src/main/services/ai/registry.js    DEV-1   konektör kayıt defteri + probe
src/main/services/ai/ollama.js      DEV-1
src/main/services/ai/openai-compat.js DEV-1
src/main/services/ai/stt.js         DEV-1   iskelet, pending-model
src/main/services/ai/tts.js         DEV-1   iskelet + slides fallback
src/main/services/ai/avatar.js      DEV-1   iskelet, pending-model
src/main/services/ai/slides.js      DEV-1   slayt+SES yerine metin/slayt üretimi (bağımlılıksız)
src/main/services/pipeline.js       DEV-1   ingest→analyze→plan→voice→compose→deliver
src/main/services/library.js        DEV-1   üretim arşivi
src/preload/preload.js              DEV-1   köprü (kanallar birebir)
src/shared/ipc-channels.js          ARC     tek kaynak
src/shared/schema.js                ARC     veri şeması + doğrulayıcı
src/shared/credits-model.js         ARC     SAF ekonomi fonksiyonları
src/shared/ai-registry.js           ARC     konektör metadata (kind/etiket/durum)
src/renderer/index.html             DSN
src/renderer/styles/*.css           DSN     --bi-* tokenları
src/renderer/app.js                 DEV-2   kabuk, yönlendirme, köprü, komut paleti
src/renderer/lib/{dom,format,chart,ui}.js  DEV-2
src/renderer/screens/*.js           DEV-2   (aşağıdaki 10 ekran)
tests/*.test.js                     QA
tools/*.js, tools/*.ps1, tools/*.cmd OPS
```

Bir dosyayı yalnız sahibi yazar. Çakışmada ARC böler, LDR emre geçirir.

## 3. Veri şeması (`schemaVersion: 1`)

`users.json` → `[{id, role:"student"|"teacher"|"admin", name, email, passHash, passSalt, createdAt, consent?:{at, text}, welcomeBonusAt}]`

`teachers.json` → `[{id, userId, headline, subjects[], bio, videos:[{id, path, durSec, kind:"lesson"|"sample", addedAt, transcript?}], styleVector?, voiceProfile?:{voiceId, refPath}, trainingProgress:0-100, state:"draft"|"training"|"ready"|"review"|"verified"|"rejected", earningsCents, onboardingBonusAt}]`

`students.json` → `[{id, userId, grade, goal}]`

`jobs.json` → `[{id, studentId, teacherId, status:"queued"|"running"|"partial"|"done"|"failed"|"canceled", creditsReserved, creditsSpent, stages:{ingest,analyze,plan,voice,compose,deliver}, input:{images[], note}, analysis?, plan?, output?:{artifactId}, error?, createdAt, endedAt}]`

`credits.json` → `{packages:[...], ledger:[{id, userId, type:"purchase"|"spend"|"refund"|"teacher_share"|"welcome_bonus", amountCredits, amountCents, jobId?, teacherId?, at, note}], balances:{[userId]:credits}, teacherCents:{[teacherId]:cents}}`

`library.json` → `[{id, jobId, studentId, teacherId, title, subject, scenes[], createdAt, watchSec}]`

`settings.json` → `{schemaVersion:1, theme:"dark", ai:{llm:"ollama", vision:"ollama", stt:null, tts:null, avatar:null, endpoints:{ollama:"http://127.0.0.1:11434"}, models:{llm:"qwen2.5:7b-instruct", vision:"qwen3-vl:8b-instruct-q4_K_M"}, allowCloud:false, cloudBudgetMonthlyCents:0}, media:{maxPages:10, maxUploadMb:50}}`

Paketler (sabit): `[{id:"p10", priceCents:1000, credits:1000}, {id:"p30", priceCents:3000, credits:5000}, {id:"p100", priceCents:10000, credits:17000}]`

## 4. Ekonomi fonksiyonları (`shared/credits-model.js`, saf, test edilir)

```
creditPriceCents(pkg)        // 1000 credits / 1000 cents -> 1
creditsForJob({pages,questions,minutes,complexity})  // ekonomi.md §3
teacherShareCents(credits, creditCents)              // %30, tam sayı, kuruş
platformCents(credits, creditCents)
canAfford(balance, needed)
grantWelcomeBonus(user) -> entry | null   // idempotent
```

## 5. IPC kanalları (`bi:<domain>:<action>`)

```
bi:app:info            bi:auth:register      bi:auth:login        bi:auth:logout
bi:app:openData        bi:app:export         bi:app:storage
bi:auth:session        bi:teacher:get        bi:teacher:save      bi:teacher:addVideo
bi:teacher:removeVideo bi:teacher:train      bi:teacher:submit    bi:teacher:status
bi:teacher:list        bi:teacher:consent    bi:teacher:deleteVoice bi:teacher:transcribe
bi:student:get         bi:student:save       bi:student:upload
bi:job:quote           bi:job:create         bi:job:get           bi:job:cancel
bi:job:list            bi:job:flag           bi:job:retry
bi:credits:state       bi:credits:purchase   bi:credits:history
bi:admin:queue         bi:admin:decide       bi:admin:economy     bi:admin:jobs
bi:library:list        bi:library:get        bi:library:delete    bi:library:update
bi:class:list          bi:class:create       bi:class:update      bi:class:join
bi:class:addMember     bi:class:assign       bi:class:archive     bi:class:complete
bi:class:stats         bi:class:plan         bi:class:export
bi:class:feedback      bi:class:remind       bi:class:digest
bi:ai:registry         bi:ai:probe           bi:ai:save
bi:mobile:status       bi:mobile:start       bi:mobile:stop       bi:mobile:rotate
bi:mobile:revoke
bi:settings:get        bi:settings:set
bi:event:job           bi:event:toast        bi:event:session
```
Yazma kanalları `{confirm:true}` ister. Push: `bi:event:*`.

## 6. Arayüz sözleşmesi — 10 ekran

| # | Ekran | Dosya | Zorunlu kimlikler |
|---|---|---|---|
| 1 | Giriş / Rol | `screens/auth.js` | `#auth-form`, `#auth-email`, `#auth-pass`, `#auth-role`, `#btn-login`, `#btn-register` |
| 2 | Öğrenci: Çalışma Alanı | `screens/workspace.js` | `#upload-zone`, `#file-input`, `#page-list`, `#teacher-picker`, `#job-quote`, `#btn-quote`, `#btn-generate`, `#job-progress` |
| 3 | Kütüphane | `screens/library.js` | `#library-list`, `#library-filter`, `#player`, `#btn-delete-artifact` |
| 4 | Öğrenci: Credits | `screens/credits.js` | `#credit-balance`, `#package-list`, `#btn-buy`, `#credit-history` |
| 5 | Öğretmen: Stüdyo | `screens/studio.js` | `#teacher-videos`, `#btn-video-add`, `#video-input`, `#training-bar`, `#btn-submit-review`, `#consent-check`, `#style-vector` |
| 6 | Öğretmen: Kazanç | `screens/earnings.js` | `#earn-total`, `#earn-chart`, `#earn-table`, `#btn-withdraw` |
| 7 | Admin: Onay Kuyruğu | `screens/approval.js` | `#approval-list`, `#btn-approve`, `#btn-reject`, `#review-detail` |
| 8 | Admin: Ekonomi | `screens/economy.js` | `#econ-sold`, `#econ-share`, `#econ-net`, `#econ-chart`, `#econ-table` |
| 9 | Ayarlar / AI Bağlantıları | `screens/settings.js` | `#ai-registry-list`, `#btn-ai-probe`, `#ai-endpoint`, `#ai-model-llm`, `#ai-model-vision`, `#theme-toggle`, `#app-version` |
| 10 | Komut paleti (katman) | `app.js` | `#palette`, `#palette-input`, `#palette-list` |

Kurallar: tüm metin Türkçe; 4px ızgara; ham renk yalnız `tokens.css`; inline `style` ve `!important`
yasak; her kartta `data-testid`; boş durum metni zorunlu; para `₺`/`$` biçimli; credits `1.240 cr`.
Klavye: `Ctrl+K` palet, `Escape` modal kapatır. Erişilebilirlik: focus ring, kontrast ≥ 4.5.

## 7. Yerel AI Merkezi (v0.2) — bağlayıcı ek

Hedef donanım: **RTX 4070 Ti SUPER, 16 GB VRAM, 256-bit**. Katalog bu sınıfa göre küratörlüdür.

### 7.1 Katalog (`src/shared/local-catalog.js`)

Her kayıt:
```js
{
  id: 'qwen2.5:14b-instruct-q4_K_M',   // sağlayıcı kimliği (ollama etiketi ya da pip paketi)
  kind: 'llm',                          // llm|vision|stt|tts|avatar|video
  label: 'Qwen2.5 14B (Q4)',
  runtimes: ['ollama'],                 // ollama | pip | binary
  sizeGb: 9.0,
  vramGb: 10.5,                         // tepe VRAM tahmini
  quality: 4,                           // 1-5
  speed: 3,                             // 1-5
  turkish: 'best'|'good'|'weak',
  license: 'Apache-2.0',
  note: 'Dengeli; Türkçede çok iyi, 14B kalitesi.',
  tags: ['onerilen', 'dengeli'],
}
```
Zorunlu katalog içeriği (en az): LLM 7 (qwen2.5:3b/7b/14b, llama3.1:8b, gemma2:9b,
mistral-nemo:12b, deepseek-r1:8b), vision 4 (qwen3-vl:8b, qwen2.5vl:7b, llava:13b,
llama3.2-vision:11b), stt 3 (faster-whisper large-v3/medium/small), tts 3 (piper tr, xtts-v2,
piper en), video 2 (ffmpeg, slides), avatar 2 (wav2lip, sadtalker).

`PRESETS`: `hizli` (en hızlı çalışan set), `dengeli` (varsayılan), `kalite` (16 GB sınırında).
`recommendFor(vramGb)` → `{preset, picks:{llm,vision,stt,tts}, warnings[]}`; toplam `vramGb`
**12,5 GB'ı aşarsa** uyarı ver.

### 7.2 IPC (ek kanallar)

```
bi:ai:catalog          bi:ai:system        bi:ai:installed     bi:ai:download
bi:ai:cancelDownload   bi:ai:downloads     bi:ai:remove        bi:ai:preset
bi:ai:setDefault       bi:ai:plan          bi:ai:setupStart    bi:ai:setupState
bi:ai:setupCancel      bi:ai:runtime       bi:ai:warmup        bi:ai:ollamaStart
bi:ai:selftest         bi:event:download
bi:ai:advisor          bi:ai:compare       bi:ai:testModel
bi:ai:storage          bi:ai:storageSet    bi:ai:pickDir       bi:ai:storageOpen
```
Yazma: `aiDownload`, `aiCancelDownload`, `aiRemove`, `aiPreset`, `aiSetDefault`,
`aiSetupStart`, `aiSetupCancel`, `aiWarmup`, `aiOllamaStart`, `aiTestModel`, `aiStorageSet`
(`{confirm:true}`).

`bi:ai:download` girdi: `{id}` veya `{preset}`. Çıktı: `{jobId, queued:true}`.
Olay `bi:event:download`: `{jobId, id, kind, state:'queued'|'running'|'done'|'failed'|'canceled',
progress:0-100, bytesDone, bytesTotal, speedBps, etaSec, message}`.
`bi:ai:system` → `{gpu:{name,vramGb,driver}, cpu, ramGb, diskFreeGb, ollama:{running,version}, python}`.

**Tek tıkla kurulum (D-020).** `bi:ai:plan` ve `bi:ai:setupState` aynı plan biçimini döner:
`{profile:{id,label,displayLabel,gpuName,vramGb,knownCard,note,reason}, picks, steps:[{kind,
kindLabel,modelId,label,sizeGb,vramGb,fit,required,state:'installed'|'missing',jobId,jobState,
progress,message}], totals:{downloadGb,installedGb,etaMinutes,stepCount,missingCount,
installedCount}, residency:{pairGb,peakGb,budgetGb,fitsTogether,headroomGb}, prerequisites:[{id,
label,state:'ready'|'missing',note}], warnings, ready,
readyScore, alternative}`. `setupState` ayrıca `{active, failed, installing, progress, session}` verir.
`bi:ai:setupStart` girdi: `{ids?}`; yalnız **eksik** adımları kuyruğa koyar, çıktı
`{started, modelIds, jobIds, message}`. `bi:ai:setupCancel` → `{canceled, count}`. Kaynak:
`src/shared/hardware.js` (saf plan) + `src/main/services/ai/setup.js` (kuyruk).

**Yerel motor (D-021).** `bi:ai:runtime` → `{ollama:{running,version,endpoint,binary,canStart,
lastAttempt}, loaded:[{model,sizeGb,vramGb,expiresAt}], tuning:{numCtx,numBatch,keepAlive,
gpuLayers,note}, warm:{at,models}, profile}`. `bi:ai:ollamaStart` Ollama'yı arka planda başlatır
→ `{ok,started,already?,waitedMs?,version?,message}`; ikili yoksa `code:'no-binary'`.
`bi:ai:warmup` girdi: `{ids?}`; kurulu LLM + görüntü modelini `/api/generate` + `keep_alive`
ile VRAM'e alır → `{ok,warmed:[{id,label,kind,ok,ms,message}],totalMs,loaded,message}`.
Karttan türetilen `num_ctx`/`num_batch` `settings.ai.tuning` içine yazılır ve her üretimde
uygulanır; kaynak `src/main/services/ai/runtime.js`.

**Öz test (D-022).** `bi:ai:selftest` hiçbir şey indirmez; kurulu yetenekleri gerçek çağrıyla
dener: `{ok, score, results:[{key,label,state:'ok'|'warn'|'fail',ms,note}], speed:{model,
tokensPerSec,loadMs,totalMs}|null, model, message}`. `llm` 7+5 sorusunu doğrular ve token/sn
ölçer, `vision` küçük bir PNG ile gerçek çağrı yapar, `stt`/`tts`/`video` yalnız kurulum durumu.
Kaynak `src/main/services/ai/selftest.js`.

**Model danışmanı (D-023).** `bi:ai:advisor` girdi: `{kind:'llm'|'vision'|'stt'|'tts'}` →
`{kind, gpu:{name,vramGb,driver}, profile, budgetGb, safetyPct, bestId, bestReason,
rows:[{id,kind,label,params,quant,contextK,sizeGb,vramGb,ramGb,fit:'ok'|'tight'|'over',
headroomGb,tokensPerSec,turkey,quality,speedScore,why,pros,cons,bestFor,speedNote,license,
source:{registry,ref,url,license,sha},pairsWith,command,installed,note,tags,rank}],
notes, kinds}`. Sığmayan model **gizlenmez**, en sonda `over` olarak görünür ve nedeni yazılır.
`bi:ai:compare` girdi `{a,b}` → kalite/hız/VRAM kazananı + `pickA/pickB`. `bi:ai:testModel`
girdi `{id}`: kurulu modeli gerçek çağrıyla dener (llm 7+5, vision 1×1 PNG) →
`{ok,id,kind,ms,tokensPerSec,loadMs,usedModel,modelFallback,text,message}`. Kaynaklar:
`src/shared/model-advisor.js` (saf veri) + `src/main/services/ai/advisor.js` (servis).

**Model depolama konumu (D-024).** `bi:ai:storage` girdi `{dir?}` →
`{dir, defaultDir, configured, custom, exists, writable, freeGb, totalGb, usedPct, tight}`;
`dir` seçili (ya da varsayılan `~/.ollama/models`) klasördür, `tight` boş alan < 25 GB.
`bi:ai:storageSet` girdi `{action:'set'|'reset', dir?}`: yalnız **mutlak, var olan, yazılabilir**
dizin kabul eder; `reset` varsayılana döner. `bi:ai:pickDir` yerel klasör seçiciyi açar →
`{canceled, ...storage}`. `bi:ai:storageOpen` klasörü gezginde açar. Seçili klasör
`OLLAMA_MODELS` olarak `ollama serve` ve `ollama pull` süreçlerine verilir (Ollama yeniden
başlatılmalı). Kaynak `src/main/services/ai/storage.js`.

### 7.3 Yeni ekran — AI Merkezi

`#screen-ai` (`data-screen="ai"`), nav etiketi **AI Merkezi**, sidebar'da Ayarlar'ın üstünde.
Zorunlu kimlikler:

| Blok | id'ler |
|---|---|
| Donanım | `#ai-system`, `#ai-gpu`, `#ai-vram`, `#ai-ram`, `#ai-disk`, `#ai-ollama-state`, `#btn-ai-refresh` |
| Öneri | `#ai-preset`, `#ai-recommend-banner`, `#btn-ai-apply-preset` |
| Katalog | `#ai-search`, `#ai-kind-filter`, `#ai-catalog`, `#ai-catalog-count` |
| Kurulu | `#ai-installed`, `#ai-installed-count` |
| İndirmeler | `#ai-downloads`, `#ai-downloads-empty` |
| Yerel motor | `#ai-runtime-profile`, `#ai-runtime-state`, `#ai-runtime-loaded`, `#ai-runtime-tuning`, `#ai-runtime-note`, `#btn-ai-ollama-start`, `#btn-ai-warmup` |
| Öz test | `#ai-selftest-list`, `#ai-selftest-score`, `#ai-selftest-note`, `#btn-ai-selftest-run` |
| Danışman | `#ai-advisor-list`, `#ai-advisor-sub`, `#ai-advisor-budget`, `#ai-advisor-verdict`, `#ai-advisor-note`, `#ai-advisor-kinds`, `#btn-ai-advisor-compare` |
| Depolama | `#ai-storage-sub`, `#ai-storage-free`, `#ai-storage-dir`, `#ai-storage-hint`, `#ai-storage-default`, `#btn-ai-storage-pick`, `#btn-ai-storage-default`, `#btn-ai-storage-open` |
| Not | `#ai-note` |

Katalog kartı: `data-testid="model-card"`, `[data-model-id]`, `[data-kind]`, `[data-size-gb]`,
`[data-vram-gb]`; içinde `[data-act="download"]`, `[data-act="cancel"]`, `[data-act="remove"]`,
`[data-act="default"]`, `[data-act="inspect"]`. VRAM uyumu rozeti: `data-fit="ok"|"tight"|"over"`.

**Model ayrıntısı (D-031).** Her kartta `[data-act="inspect"]` düğmesi vardır ve katalogdaki
**her** model için ayrıntı penceresini açar (danışman kaydı olmayan ffmpeg/slayt modelleri dahil).
Pencere `[data-detail-model]` taşır: sığma/bütçe/pay (pay eksi ise "eksik X GB"), durum, tür, VRAM,
disk, sistem RAM, bağlam, parametre, kuantizasyon, Türkçe düzeyi, hız ve lisans. Danışman kaydı
varsa artı/eksi, gerekçe, indirme kaynağı ve "birlikte çalışır" satırı eklenir; `over` modelde
uyarı görünür. Eylemler: `Kapat` + kurulu değilse `Kur · X GB`, kuruluysa `Dene`. Danışman
listesindeki `[data-act="advisor-inspect"]` aynı pencereyi açar. Tüm değerler ortak satır
modelinden (`model-row.js`) gelir; yeni `bi:*` kanalı yoktur.

**Karşılaştırma tablosu (D-032).** `#btn-ai-advisor-compare` penceresi `[data-compare]` taşır;
sütunlar `Model · Sığma · Pay · Durum · VRAM · Disk · Kalite · Hız · Türkçe · tok/sn`. Sığma ve
durum hücreleri katalog kartı ve ayrıntı penceresiyle **aynı** ortak satır verisinden gelir; model
adı bir `[data-compare-inspect="<model id>"]` düğmesidir, tıklayınca karşılaştırma kapanır ve o
modelin ayrıntı penceresi açılır. Bütçe satırı `VRAM × %90` yazar; `over` satırda "eksik X GB"
görünür.

**A/B seçimi (D-033).** Pencerenin başında `[data-compare-select="a"]` ve `[data-compare-select="b"]`
iki `<select>` vardır (aynı tür modelleri). Seçim değişince satırlar `data-compare-pick="a"|"b"` ile
işaretlenir ve özet `[data-compare-summary]` mevcut `bi:ai:compare` kanalıyla tazelenir; aynı model
iki tarafta seçilirse özet "İki farklı model seçin" der ve çağrı yapılmaz. Yeni kanal yoktur.

Kurallar: hiçbir model **kendiliğinden indirilmez**; yalnız kullanıcı düğmesiyle. İndirme
ilerlemesi canlı (olay) + yüzde + hız + kalan süre. `over` uyumlu modelde düğme görünür ama
uyarı metni zorunlu ("16 GB VRAM'i aşar").

### 7.4 Yeni ekran — Yönetim (D-025)

`#screen-admin` (`data-screen="admin"`), rol **admin**, nav etiketi **Yönetim**, sidebar'da
Ekonomi'nin altında. Yalnız `bi:ai:*` kanallarını kullanır; yeni kanal açmaz. Zorunlu kimlikler:

| Blok | id'ler |
|---|---|
| Başlık | `#admin-runtime-pill`, `#btn-admin-refresh`, `#btn-admin-install-set`, `#admin-set-note` |
| KPI | `#admin-gpu`, `#admin-gpu-sub`, `#admin-vram`, `#admin-vram-sub`, `#admin-disk`, `#admin-disk-sub`, `#admin-installed`, `#admin-installed-sub` |
| Model tablosu | `#admin-kind-filter`, `#admin-models-count`, `#admin-models`, `#admin-models-body`, `#admin-models-note`, `#admin-model-search`, `#admin-only-missing` |
| Canlı indirme | `#admin-jobs`, `#admin-jobs-count`, `#admin-jobs-empty` |
| Depolama | `#admin-storage-sub`, `#admin-storage-free`, `#admin-storage-dir`, `#admin-storage-hint`, `#btn-admin-storage-pick`, `#btn-admin-storage-default`, `#btn-admin-storage-open` |
| Ortam | `#admin-runtime-note`, `#admin-tuning-note` |

Tablo satırı: `tr[data-model-id][data-fit]`; hücrelerde durum rozeti, `<progress>` yüzdesi,
**kalan süre** (`etaSec`), VRAM ve `[data-act="install"|"cancel"|"test"|"remove"]`.
Canlı indirme listesi 1,5 sn'de tazelenir; `document.hidden` iken durur.

**Önerilen set (D-026).** `#btn-admin-install-set` donanıma göre `bi:ai:plan` adımlarından
kurulu olmayanları **tek onayla** `bi:ai:setupStart {ids}` ile kuyruğa alır; düğme metni
eksik adet ve toplam boyutu (`Önerilenleri kur · 12,3 GB`), rozet `#admin-set-note`
`N eksik · X GB` ya da `set hazır` yazar. Set hazırsa düğme kilitlidir.

**Model tablosu süzgeci (D-027).** `#admin-model-search` ada/kimliğe göre arar (180 ms
debounce, Türkçe küçük harf), `#admin-only-missing` yalnız kurulu olmayanları bırakır,
`th button.admin-sort[data-sort="name|kind|state|vram"]` sıralar (aynı sütuna ikinci tıklama
yönü çevirir; `data-active`/`data-dir` ile ok gösterilir). Rozet `görünen / toplam model`,
alt not aktif süzgeçleri yazar; hiç sonuç yoksa "Süzgece uyan model yok" cümlesi.

**Ortak model satırı (D-030).** AI Merkezi kartı ile Yönetim tablosu sığma, durum, ilerleme,
kalan süre, arama ve sıralama kurallarını `src/renderer/lib/model-row.js` içinden alır; iki ekran
kendi kopyasını taşımaz. `SAFETY = 0,9` danışmanla (`src/shared/model-advisor.js`) aynıdır, böylece
aynı model iki ekranda aynı rozeti alır (`tests/model-row.test.js`). Modül yalnız veri üretir:
DOM ve `bi:*` çağrısı yoktur.

### 7.5 Tasarım v2 (profesyonelleşme)

- Yeni görsel dil: Linear/Raycast sınıfı. Koyu tema varsayılan, tek vurgu rengi, yumuşak yüzey
  katmanları, ince 1px kenarlar, ağır gölge yok, 8px ızgara, 10px yarıçap.
- Sol **ikon raylı** sidebar (64px) + genişleyen etiket paneli; üstte komut çubuğu görünümünde
  `#palette` tetikleyici (`Ctrl+K`).
- Tipografi: `Segoe UI Variable`/`system-ui`; başlıklarda -0.01em letter-spacing; tüm sayılar
  `font-variant-numeric: tabular-nums`.
- Her ekranda: sayfa başlığı + tek satır açıklama + sağda birincil eylem.
- Tablolar: yapışkan başlık, satır hover, boşluk 10px, hücre içi ikincil metin.
- Durum: `data-tone` pill'leri (`success|warning|danger|info|muted`) tek bileşen.
- İskelet yükleme (`[data-loading="true"]`) ve "boş durum" bileşeni zorunlu.
- `prefers-reduced-motion` desteği, focus ring 2px, kontrast ≥ 4.5.

### 7.5 Kütüphane oynatıcısı (C-013)

- Medya `file://` ile açılmaz. `bilgial-media://media/<göreli yol>` ayrıcalıklı şeması kullanılır;
  yol `store.mediaPath` ile doğrulanır, `..` ve sürücü yolu reddedilir.
- Video için HTTP **Range/206** desteklenir; ileri sarma çalışır.
- Teslim önceliği: `artifact.videoPath` → `<video>`; yoksa `artifact.wavPath` → `<audio>` +
  manifest zaman damgalarından slayt senkronu; medya yoksa slaytlar elle ilerletilir.
- Sahne listesi tıklanabilir; geçerli sahne `data-current="true"` ile işaretlenir. Ekrandan
  çıkışta tüm `video`/`audio` öğeleri duraklatılır.
- CSP `media-src` yalnız `'self' data: blob: bilgial-media:` içerir.

### 7.6 Dinamik ekran sınıf kataloğu (C-015)

- Renderer JS'in ürettiği her sınıf adı `styles/*.css` içinde tanımlı olmak zorundadır;
  `tests/ui.test.js` bunu zorunlu kılar. Durum sınıfları (`is-active`, `is-selected`) muaftır.
- Dinamik bileşenler statik HTML ile aynı görsel dili kullanır: `page-item`/`teacher-option`/
  `approval-item` kartları `file-chip` ve `checkbox-row` ile aynı yüzey/kenar/yarıçap
  belirteçlerini tüketir; `quote__row` ve `chip` v2 tokenlarıyla tanımlıdır.
- Zaman çizgisi dinamik olarak `timeline-step` + `data-state` üretir (`done|active|pending`).

### 7.7 Konuşma→metin (STT, C-016)

- Motor **faster-whisper**, Python alt süreci (`src/main/services/ai/whisper-worker.py`) olarak
  çalışır; Electron ana prosesi Python bağımlılığı yüklemez. Süreç stdout'a JSONL yazar
  (`status` / `progress` / `done` / `error`).
- Model ağırlıkları `<userData>/models/whisper` altında (`BILGIAL_WHISPER_DIR` ile değiştirilir).
  Varsayılan model `small`; ilk çözümlemede indirilir, sonra çevrimdışı çalışır.
- Kanal `bi:teacher:transcribe` (`{ videoId, language?, model? }`, `confirm` gerekmez çünkü
  yazma kanalı değildir) videoyu yazıya çevirir, `video.transcript` + `transcriptSource:"whisper"`
  + `transcriptModel` yazar. Model yoksa `pending-model` döner; Studio yapıştırma yoluna düşer.
- Python alt süreçlerinde `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1` zorunludur (Türkçe
  karakterlerin Windows cp1254 ile bozulmasını önler).
- Bağımlılık sürümleri: `faster-whisper 1.2.1`, `av<16` (av 19 `metadata_errors` hatası verir),
  `tokenizers 0.20.3`.

### 7.8 PDF → sayfa ayrıştırma (B-021)

- Öğrenci yüklemesi PNG/JPEG/WebP yanında **PDF** kabul eder. PDF imzası (`%PDF-`) içerikten
  doğrulanır; uzantıya güvenilmez.
- Ayrıştırma PyMuPDF ile Python alt sürecinde (`src/main/services/ai/pdf-worker.py`) yapılır;
  her sayfa 150 DPI PNG'ye çevrilir ve mevcut `students/<id>/<upload>/pNN.png` düzenine yazılır.
- Motor yoksa `bi:student:upload` `pending-model` döner; yalnız görsel akışı bozulmadan sürer.
- Yanıt `pageDetails[{path,page,bytes,name,sourceName,sourcePage}]` içerir; arayüz sayfa
  listesini bu ayrıntılardan kurar ve önizlemeyi `bilgial-media://` ile gösterir.
- Sayfa sayısı `media.maxPages` ile sınırlıdır; aşan PDF reddedilir.

### 7.9 Uzun ekranlarda bölüm gezinmesi (D-028)

- Ekran görünümün yüksekliğini `1,4×` aşıyorsa ve en az **2** başlıklı kart varsa,
  `.screen-head` altına yapışkan `<nav class="screen-jumps" aria-label="Ekran bölümleri">`
  çubuğu çizilir; `#screen-auth` bu kuralın dışındadır.
- Her kart için `button.jump-chip[data-jump]` üretilir, etiket kartın `.card-title` metnidir;
  kartın kimliği yoksa `jump-<ekran>-<sıra>` atanır ve `scroll-margin-top`
  `calc(var(--bi-topbar-h) + 64px)` olur.
- Çipe tıklama `scrollIntoView({behavior:'smooth', block:'start'})`; kaydırma sırasında
  görünüm çizgisini geçen son kart `aria-current="true"` alır, etkin çip şeritte görünür kalır.
- Çubuk `buildJumpBar`/`removeJumpBar` ile ekran değişiminde yeniden kurulur (MutationObserver +
  `jumpSignature`/`jumpBucket`); ekran değişince sayfa `scrollTo(0, 0)` ile başa döner.
- Kanallar değişmez: bölüm gezinmesi yalnız DOM'dur, `bi:*` çağrısı yapmaz.
- **Komut paleti (D-029).** Palet açılınca "Bu ekran" grubu ekranın kart başlıklarını listeler
  (`button.palette-item[data-jump-target]`); seçim paleti kapatır, `.jump-chip[data-jump]`
  tıklanır (yoksa `scrollIntoView`). Kısa ekranda (< 2 başlıklı kart) grup çizilmez ve
  grup "Eylemler" başlığının hemen önünde durur.

### 7.11 Telefon köprüsü — aynı Wi-Fi, QR eşleştirme (D-034)

Genel internete **sunucu açılmaz**. PC yerel model sunucusu olarak kalır; telefon aynı
Wi-Fi'dan `http://<pc-ip>:<port>/` adresine bağlanır. Uygulama `src/web/` (mobil PWA),
sunucu `src/main/services/mobile-server.js`, QR `src/shared/qr.js` (bağımlılıksız, düzey M).

- **Eşleştirme:** masaüstü kartı `http://<lan-ip>:<port>/?pair=<6 hane>` adresini QR olarak
  gösterir; kod 30 dk geçerlidir ve **tek kullanımlıktır**. Telefon `POST /api/pair {code}`
  ile 48 haneli hex cihaz belirteci alır (`localStorage: bilgial.device`); sonraki tüm
  istekler `x-bilgial-token` başlığını taşır. `?token=` yalnız `GET /api/events` (SSE) ve
  `GET /api/media` (video/ses/görsel akışı) içindir. Tanınmayan/iptal edilmiş belirteç
  `401 {code:'device-unknown'}` döner; mobil istemci belirteci siler ve QR ile yeniden eşleşmeye
  döner.
- **Oturum:** `POST /api/login {email,password}` cihaz oturumu açar; masaüstü oturumu
  **değişmez** (`accounts.authenticate`, `login` değil). `POST /api/logout` cihazı kapatır.
- **API (hepsi JSON, `{ok:true,...}` / hata `{ok:false,code,message}`):** `POST /api/pair`,
  `POST /api/login`, `POST /api/logout`, `GET /api/state` (host + kullanıcı + kredi + işler +
  kütüphane), `GET /api/teachers`, `POST /api/quote {pages,questions,complexity}`,
  `POST /api/solve {teacherId,images:[{dataBase64,fileName}],note,questions,complexity}`,
  `GET /api/job?id=`, `POST /api/cancel {jobId}` (kuyruktaki işi durdur + kredi iadesi),
  `GET /api/media?path=&token=` (sonuç medyası; `Range`/`206`, path
  `store.mediaPath` ile doğrulanır), `POST /api/ai/warmup`, `POST /api/ai/selftest`,
  `GET /api/health`,
  `GET /api/events` (SSE: `hello` + `job`). Statik: `/`, `/style.css`, `/app.js`,
  `/tokens.css`, `/manifest.webmanifest`, `/icon.svg`; yol `src/web` dışına çıkamaz.
- **İş görünümü (D-035):** `/api/state` iş listesi, `/api/job` ve SSE `job` olayı `jobView()`
  ile üretilir: `output.summary` (yoksa `<ders> çözümü`) ve `output.media`
  `{url, kind, name}` (`kind`: `video|audio|image|pdf|file`). `bilgial-media://` şeması
  telefonda kullanılmaz; medya aynı kökenden token'lı `/api/media` ile sunulur. Mobil istemci
  `kind`e göre `<video>/<audio>/<img>` önizlemesi gömer (`#job-preview`, `.output-media`).
- **Artefakt çözümü (D-045):** yeni boru hattı `job.output` içinde **yalnız `artifactId`**
  bırakır; gerçek medya yolları kitaplık kaydındadır. `jobView()` bu yüzden
  `output.path` yoksa `library.findByJob(job.id)` ile kaydı bulur ve sırayla
  `artifact.videoPath → path → wavPath` kullanır. Eski (`output.path` taşıyan) işler
  aynen çalışır; eşleşen kitaplık kaydı yoksa medya **uydurulmaz** (`media:null`).
  Bu, telefonda üretilen dersin oynatılmasının tek yoludur; testi
  `tests/mobile.test.js` "D-045" satırıdır.
- **Kurulabilir PWA / çevrimdışı kabuk (D-047):** `src/web/sw.js` servis çalışanı yalnız
  **uygulama kabuğunu** önbelleğe alır (`/`, `/index.html`, `/app.js`, `/style.css`,
  `/tokens.css`, `/manifest.webmanifest`, `/icon.svg`, `/icon-192.png`, `/icon-512.png`).
  `/api/*` ve `/api/media` **asla** önbelleğe girmez (canlı durum + Range/206 bozulmasın).
  `index.html` için network-first (çevrimdışıyken önbellekten), kabuk dosyaları için
  stale-while-revalidate; sürüm değişince eski önbellek silinir. `sw.js` ve `.html`
  `cache-control: no-store` ile sunulur, `Service-Worker-Allowed: /`. Manifest
  `display:standalone`, `start_url:/`, `scope:/`, 192/512 PNG + maskable ikon taşır.
  Mobil istemci `beforeinstallprompt` yakalar; kart durumu `kurulabilir → kurulu`,
  iOS'ta elle yol gösterir. Ölçüm: `work/d047-install.js` (SW kapsamı, kabuk anahtarları,
  `api/` dışlaması, kurulum kartı, ağ kapalıyken yeniden açılış).
- **İlk adımlar rehberi (D-048):** Ana ekranda `#start-card` dört gerçek adımı gösterir
  (`#start-steps`, sayaç `#start-count`, tek düğme `#btn-start-next`). Adımlar
  `state.user`, `state.quoted`, `state.jobs`, `state.library` üzerinden hesaplanır; hiçbiri
  `localStorage`'a yazılmaz. Boş listeler eylemlidir (`makeEmptyAction`): “Henüz iş yok…” →
  **İlk sorunu yükle**, “Henüz çözüm yok…” → **Çözüme git**. Ölçüm: `work/d048-start.js`.
- **AI bağlantıları: dürüst durum + tek indirme düğmesi (D-049):** `shared-bridge`
  `installHint`/`defaultEndpoint`/`action`/`requiresConsent` alanlarını korur (ekran artık
  “kurulum ipucu yok” yazmaz). `registry.js` ffmpeg'i `compose.ffmpegAvailable()` ile
  **gerçekten** arar; XTTS Piper'dan ayrı `consent-required` konektördür; Wav2Lip/SadTalker
  `consent-required`; OpenAI uyumlu `config-required` (isteğe bağlı). Ayarlar kartında tek
  düğme `#btn-ai-install` → `bi:ai:setupState` ile eksik adımlar, `bi:ai:setupStart` ile
  kuyruk; rıza kapısındaki konektörler indirilmez; etiket `İndiriliyor… %N` →
  `Gerekli her şey kurulu ✓`. Ölçüm: `work/d049-ai-install.js`, `work/d049-install-demo.js`.
- **Sınıf / ödev / teslim (D-050):** `classes.json` yeni store belgesi; tek doğruluk kaynağı
  `src/shared/classes-model.js` (katılım kodu alfabesi, `assignmentState`, `classStats`,
  `validateClassesFile`). Kanallar
  `bi:class:list|create|update|join|addMember|assign|archive|complete|stats|plan|export|feedback|remind|digest`;
  yazma kanalları `confirm` ister. `src/main/services/classes.js` yetki ve görünüm katmanıdır;
  öğrenciye `joinCode` dönmez, üye adı `students.json → users.json` zinciriyle çözülür.
  Ekranlar: öğretmen `#screen-classes` (sınıf aç, kod kopyala, ödev ver, detayda üye
  ilerlemesi), öğrenci `#screen-tasks` (kodla katıl, plan, ödev tamamla). Tamamlama =
  tamamlanan (öğrenci × ödev) hücresi / tüm hücreler. Ölçüm: `tests/classes.test.js` 11/11,
  `work/d050-classes.js` → `GECTI`.
- **Sınıf içgörüleri + CSV + günlük hedef (D-051):** model tek kaynak kalmaya devam eder;
  `weeklyActivity` (son 7 gün), `studentRisk` (eksik/gecikmiş, riskli önce), `dailyGoal`
  (bugün teslim + gecikmiş + bugün tamamlanan, en çok 3) ve `toCsv` (CRLF, tırnak kaçırma,
  formül enjeksiyonu etkisizleştirme) `src/shared/classes-model.js` içindedir. `bi:class:stats`
  yanıtı `insights` taşır (risk satırlarında ad, e-posta yok); yeni `bi:class:export`
  `{filename, rows, csv}` döner ve yalnız öğretmen/admin çağırabilir (öğrenci `forbidden`).
  Öğrenci planı `goal` alanıyla günlük hedefi taşır. Ekranlar: sınıflarda içgörü kartı
  (haftalık çubuklar, zamanında teslim, riskli öğrenci) + **CSV indir**; ödevlerde
  **Bugünün hedefi** ilerleme çubuğu. Ölçüm: `tests/classes.test.js` D-051 testleri,
  `work/d051-insights.js` → `GECTI`.
- **Ödev dönütü + hatırlatma (D-052):** öğretmen bir öğrencinin ödevine metin dönütü yazar;
  dönüt `submissions[].feedback = {text, at, by}` olarak **teslim kaydının içinde** durur ve
  `updatedAt` değişmez — öğretmen notu öğrenci etkinliği sayılmaz, haftalık ritim ve seri
  bozulmaz. Öğrenci kendi dönütünü `bi:class:plan` yanıtında görür; başka öğrencinin dönütü
  görünmez. `bi:class:remind` bir sınıfın **gecikmiş** hücrelerini öğrenci adı, sınıf, ödev
  başlığı ve teslim tarihiyle kopyalanabilir metne çevirir (`model.reminderMessage` tek
  kaynak); öğrenci ve yabancı öğretmen `forbidden`. Dönüt yalnız sınıfın öğretmeni/admin
  tarafından, sınıf üyesi öğrenciye yazılır (boş metin `invalid-feedback`). Ölçüm:
  `work/d052-service-probe.js`, `tests/classes.test.js` D-052 testleri.
- **Haftalık özet metni (D-053):** `bi:class:digest` sınıfın ya da tek öğrencinin son 7
  gününü kopyalanabilir metne çevirir (`model.classSummary` tek kaynak): dönem, zamanında
  teslim oranı, bu hafta tamamlanan ödev, riskli öğrenci sayısı ve öne çıkan 3 öğrenci;
  öğrenci özetinde tamamlama, gecikmiş/eksik, yazılan dönüt sayısı ve son etkinlik. Öğretmen
  sınıfın tamamı ya da sınıf üyesi bir öğrenci için, **öğrenci yalnız kendi** özetini alır;
  yabancı öğretmen ve üye olmayan öğrenci `forbidden`. Metinde e-posta ve katılım kodu
  **yoktur**. Ölçüm: `tests/classes.test.js` D-053 testleri, `tests/mobile-tasks.test.js`
  (öğrenci özeti), `work/d053-service-probe.js`, `work/d053-field.js`.
- **Sınıf üye araması + tek öğrenci özeti (D-054):** Sınıf detayında `#class-member-search`
  (`type="search"`) listeyi **yerel** süzer (istek yok); eşleme `searchKey` ile Türkçe harf
  duyarsızdır (`İ/ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c`, `toLocaleLowerCase('tr')`). Eşleşme yoksa
  sahte satır üretilmez; `.member-search-note` ““<sorgu>” ile eşleşen öğrenci yok.” yazar.
  Üye satırındaki **Özet** `bi:class:digest` çağrısına `studentId` ekler (`openDigest`),
  pencere başlığı `Öğrenci · dönem` olur. **Yeni kanal yoktur** (92 kalır); D-053 yetkileri
  aynen geçerlidir. Ölçüm: `tests/ui.test.js` D-054 testi, `work/d054-search.js`.
- **Yaklaşan teslimler + yerel bildirim (D-055):** `model.dueInfo(dueAt, now)` kalan süreyi
  tek yerden etiketler (`Süresi geçti`, `Son 1 saat`, `Bugün HH:MM`, `Yarın HH:MM`,
  `N gün kaldı`, uzakta `gg.aa.yyyy`); `soon` = 0 < kalan ≤ 48 saat. `classes.plan` yanıtı
  `plan.upcoming` (tamamlanmamış, en çok 5) ve `classes.stats` yanıtı `upcoming` taşır; ödev
  görünümlerinde `due` alanı vardır. `src/main/services/notify.js` en fazla **6 saatte bir**
  tek yerel bildirim gösterir (`buildMessage`, `shouldNotify`, `maybeNotify`; gönderici
  enjekte edilebilir, durum yalnız bellekte, yeni şema/ayar yok). `main.js` `bi:class:stats`
  ve `bi:class:plan` sonrası `maybeNotify` çağırır. Masaüstünde `#tasks-upcoming-card`,
  telefonda aynı kart (boşken gizli) ve `.task-row__due` rozeti; **yeni kanal yoktur** (92 kalır).
  Ölçüm: `tests/classes.test.js`, `tests/ui.test.js`, `tests/mobile-tasks.test.js` D-055
  testleri, `work/d055-due.js`.
- **Ödev arşivi (D-056):** `bi:class:archive` ödevi arşivler (`archived: true`) ya da geri alır
  (`archived: false`); yanıt `{assignment: {id, archived, archivedAt}}` olur ve `archivedAt`
  arşivde ISO tarih, geri alınca `null`'dır. Arşivli ödev `bi:class:list`, `plan`,
  `stats.assignments`, `stats.upcoming`, içgörü/CSV/özet hesaplarından düşer; `stats` yanıtı
  `archived` listesini taşır (o sınıfın arşivlileri, en yeni önce). Yalnız ödevin sahibi
  öğretmen arşivleyebilir (`forbidden`); bilinmeyen ödev `assignment-not-found`. Şemada
  `archivedAt` `null` ya da ISO tarihtir. Arayüz: ödev tablosunda **Arşivle**, `#class-archive-card`
  kartında **Geri al**. **Yeni kanal yoktur** (92 kalır). Ölçüm: `tests/classes.test.js`,
  `tests/ui.test.js` D-056 testleri, `work/d056-archive.js`.
- **Ödev tablosu arama/süzme/sıralama (D-057):** arayüz katmanı; yeni kanal yoktur (92 kalır).
  `#assignment-search` (`searchKey`, Türkçe harf duyarsız; başlık + sınıf + not), 
  `#assignment-state` (`assigned|watching|overdue|done`) ve `#assignment-sort`
  (`due|created|title|completion`; varsayılan `due`) ile `visibleAssignments()` süzer.
  Teslim tarihi olmayanlar sıralamada sonda; eşleşme yoksa `Eşleşen ödev yok` dürüst boş durumu;
  süzgeç etkinken `n / m ödev gösteriliyor` notu görünür. Ölçüm: `tests/ui.test.js` D-057,
  `work/d057-filter.js`.
- **Kitaplık görünümü (D-036):** `/api/state` içindeki kitaplık kayıtları `libraryView()`
  ile üretilir; `media` alanı `{url, kind, name}` olur ve dosya sırası
  `artifact.videoPath → artifact.path → artifact.wavPath` şeklindedir. Mobil Kitaplık'ta
  kayıt açıldığında önizleme **ilk açılışta** yüklenir (her kayıt için baştan istek yok),
  kapanınca video/ses duraklar; bağlantı yeni sekmede tam boy açılır.
- **Bağlantı izleme (D-037):** mobil istemci 20 sn'de bir `GET /api/health` yoklar (4 sn
  zaman aşımı, sekme görünür olunca hemen). Üst çubukta `#conn-state` rozeti
  `PC çevrimiçi` / `PC çevrimdışı` gösterir; kopmada bir kez uyarı, dönüşte bir kez
  "bağlantı geri geldi" bildirimi ve durum tazeleme yapılır. Sağlık ucu belirteç istemez.
- **Medya sahipliği (D-039):** `mediaAllowed(user, path)` her `/api/media` isteğinde çalışır.
  Yönetici tüm dosyaları görür. Öğrenci/öğretmen yalnız **kendi** köklerini görür:
  `jobs/<kendi job.id>` (iş erişimi `jobs.access` ile), `students/<kendi studentId>`,
  `teachers/<kendi teacherId>`. Bilinmeyen kök, `..` ve ters bölü (`\`) reddedilir →
  `403 {code:'forbidden'}`; sahipsiz iş klasörü de `403`. Bu nedenle üretilen sonuç medyası
  **iş kimliğiyle aynı klasöre** yazılır: `jobs/<job.id>/…`.
- **Bildirim (D-040):** mobil istemci Home'da "Bildirimler" kartı sunar. `Notification.requestPermission`
  yalnız kullanıcı düğmeye basınca çağrılır; izin `granted` ise rozet `açık` (`success`) olur ve
  düğme kilitlenir, `denied` ise `engellendi` (`error`). İş `done`/`failed`/`canceled` olduğunda
  `notifyJobFinished(job)` bildirim gösterir (`tag: bilgial-job-<id>`, Türkçe gövde; tıklayınca
  Kitaplık). Kullanıcı o işi Çöz ekranında açıkça izliyorsa bildirim gösterilmez; destek varsa
  `navigator.vibrate` ile titreşim verilir. Bildirim sunucu tarafı gerektirmez (aynı köken).
- **Kitaplık araması ve ders filtresi (D-041):** Kitaplık ekranında `#library-query` arama alanı
  başlık ve ders içinde arar (Türkçe küçük harf: `toLocaleLowerCase('tr-TR')`); `#library-subjects`
  içinde `Tümü` + kitaplıktaki dersler çip olarak listelenir (`aria-pressed` seçili olanı bildirir).
  Sayaç filtre varken `n / toplam` biçimindedir (`1 / 2`); eşleşme yoksa boş durum metni
  "Bu filtreyle eşleşen çözüm yok…" gösterilir. Arama 120 ms gecikmeyle uygulanır. Yeni eşleştirme
  ve çıkışta filtre durumu sıfırlanır. Filtreleme istemcide yapılır; ek uç gerekmez.
- **İş iptali (D-042):** `POST /api/cancel {jobId}` yalnız **student** oturumuna açıktır.
  Sahiplik `jobs.cancel` ile denetlenir; başkasının işi `403 forbidden`. Kuyruktaki
  (`queued`) iş `canceled` olur ve ayrılan kredi iade edilir — yanıt
  `{ok:true, refunded:true, job}`. Çalışan (`running`) işte iptal isteği kaydedilir ve akış
  `canceled` olayını getirir (`cancelRequested`, o an `refunded:false`). Tamamlanmış iş
  ikinci kez iptal edilemez → `409 {code:'not-cancelable'}`. Mobil istemcide düğme yalnız
  `queued`/`running` işte ve öğrenci oturumunda görünür; onay `window.confirm` ile alınır,
  iade olursa "Kredi geri yüklendi." bildirimi gösterilir.
- **Sınırlar:** yalnız LAN arayüzüne (`0.0.0.0`) bağlanır; sabit HTTP (TLS yok, LAN varsayımı);
  gövde `maxUploadMb × 4` ile sınırlı; sayfa en fazla 3 adet; `solve` yalnız `student`.
  Eşleştirmede aynı IP'den 5 dakikada en fazla **8 hatalı deneme** kabul edilir; sonrası
  `429 {code:'too-many-attempts'}` ve doğru kod bile bekletilir (kaba kuvvet kapısı).
  Köprü **kendiliğinden açılmaz**: masaüstünde "Telefondan bağlan" kartından başlatılır,
  pencere kapanınca durur (`mobile.stop()`).
- **Ödevlerim arama/süzgeç (D-058):** mobil istemcide `#tasks-search` (`type="search"`),
  `#tasks-state` (`""`, `assigned`, `watching`, `overdue`, `done`) ve `#tasks-tools-note`.
  `taskSearchKey()` Türkçe harf duyarsız katlar, `visibleTasks()` başlık + sınıf + dönüt üzerinde
  arar, durum süzgeci `assignment.state` ile birebir eşleşir, sunucu sırası korunur. Süzgeç
  etkinken not `n / m ödev gösteriliyor` (+ `· durum: <etiket>`) yazar; sonuç yoksa sahte satır
  üretilmez, dürüst boş durum gösterilir. Yeni kanal yoktur.
- **Masaüstü kanalları:** `bi:mobile:status` (durum + QR yolu + cihazlar), `bi:mobile:start`,
  `bi:mobile:stop`, `bi:mobile:rotate` (yeni kod), `bi:mobile:revoke` (cihaz iptali) — yazma
  kanalları `{confirm:true}` ister ve yalnız `admin`.
- **Masaüstü kartı kimlikleri:** `#ai-mobile`, `#ai-mobile-state`, `#ai-mobile-qr`,
  `#ai-mobile-ip`, `#ai-mobile-code`, `#ai-mobile-url`, `#ai-mobile-devices`,
  `#ai-mobile-count`, `#ai-mobile-note`, `#btn-ai-mobile-start`, `#btn-ai-mobile-stop`,
  `#btn-ai-mobile-rotate`, `#btn-ai-mobile-copy`; mantık `renderer/lib/mobile-card.js`.

### 7.12 Video stüdyosu — tema, oran, altyazı, kapak (D-059)

Video üretimi bir "stüdyo ayarı" ile yapılır. Ayarlar iş girdisinde `input.video` olarak saklanır
(şema yalnız tür denetler; biçim doğrulaması `ai/video.normalizeOptions` içinde). Herhangi bir
ayar yoksa güvenli varsayılanlar kullanılır, **bilinmeyen değer sessizce varsayılana döner** ve iş
durdurulmaz.

- **Motor (saf, `src/main/services/ai/video.js`):** dosya yazmaz, süreç başlatmaz, dış bağımlılık
  yoktur. `THEMES` (6: `gece`, `gunes`, `orman`, `kagit`, `mor`, `okyanus`; her tema `bg` gradyanı
  + `accent/title/body/muted/panel/label`) ve `FORMATS` (3: `16x9` 1280×720, `9x16` 720×1280,
  `1x1` 1080×1080; her format başlık/gövde/giriş/kapanış geometrisi) dışa açıktır.
- **Seçenekler:** `theme`, `formats` (en az bir; hepsi kapatılırsa `16x9`), `captions`, `cover`,
  `chapters`, `introSec`/`outroSec` (0–12), `sourceInset`, `progressBar`, `watermark`, `fps`
  (12–60), `crf` (16–40), `preset`, `transitionSec`. `knownFormats()` bilinmeyen oranı atar.
- **Zaman çizelgesi:** `buildTimeline(scenes, audio, options, meta)` giriş ve kapanış kartlarını
  ekler; sahne süresi ölçülen ses süresidir, kartlar boşluksuz zincirlenir.
- **Altyazı/bölüm:** `buildCaptions` yalnız konuşan sahnelere yazar (giriş/kapanış kartları
  almaz), `buildSrt`/`buildVtt`/`timecode` SRT ve WebVTT biçimlerini, `buildChapters`/
  `chapterText` oynatıcı bölüm listesini üretir. `chunkSpeech` uzun konuşmayı sınırlı parçalara
  böler.
- **Filtre:** `buildFilters` gradyan arka plan, PiP kaynak görsel (`scale`+`pad`,
  `force_divisible_by=2`), sahne rozetleri, geçişli `drawtext` (metin dosyaları üzerinden),
  ilerleme çubuğu ve filigranı tek `filter_complex` zincirinde kurar; `alphaExpr` geçiş ifadesi,
  `estimateTextWidth`/`wrapText` yerleşim güvenliği içindir.
- **Çıktı (`ai/compose.js`):** her format ayrı MP4 (`videos[]`; ilki `videoPath`), `cover.jpg`,
  `captions.srt`, `captions.vtt`, `chapters.txt`, `scenes.json` (**schemaVersion 2**: theme,
  options, captions, chapters, videos, cover). Hata ayıklama için `filter.txt` ve
  `render-error.txt` yazılır; `renderErrors` döner.
- **Kütüphane/mobil:** `library.js` `videos/coverPath/captionsPath/captionsVttPath/chaptersPath/
  theme` alanlarını saklar ve silmede temizler; `mobile-server.js` `.srt`/`.vtt` MIME ile
  `cover`/`captions`/`videos` URL'lerini `libraryView` içinde sunar.
- **Arayüz:** `#workspace-video` kartı (`#video-theme`, `#video-formats` içinde `16x9|9x16|1x1`,
  `#video-intro`, `#video-outro`, `#video-captions`, `#video-cover`, `#video-inset`,
  `#video-note`, `#video-estimate`); oynatıcıda `poster`, `track kind="captions"` ve
  `[data-testid^="player-format-"]` düğmeleri (konum/hız korunur).
- **Kural:** yeni IPC kanalı yoktur (92 kalır); ses/yüz klonlama rıza kapısı değişmez.

## 8. Deneme sürümü (D-043, D-044)

Deneme oturumları ana veriden **ayrı** bir kümeyle çalışır. Sözleşme dışına çıkmaz:
aynı şema, aynı kanallar, aynı kalite kapıları; yalnız `--user-data-dir` farklıdır.

- **Model kademeleri:** `tools/models-pull.js` tek komutla indirir. `core` (21.5 GB) →
  `quality` (~103 GB) → `speech` → `heavy` (deneysel 70B). Yalnız `ollama pull` çalıştırır,
  kurulu modeli atlar, disk yetmezse başlamaz (%15 pay, çıkış kodu 3), günlük
  `work/models-pull.log`. `--dry-run`, `--check`, `--only=` destekli. Ses klonlama
  (`xtts-v2`) rıza kapısında olduğu için araç onu indirmez.
- **Deneme kümesi:** `work/trial-data`, tohum `work/trial-seed.js`
  (`--keep` kullanıcıları korur). Hesaplar: `admin@`, `ogretmen@`, `ogrenci@bilgial.local`
  (parola `BilgiAl2026`); doğrulanmış öğretmen, 5000 simüle kredi, bir tamamlanmış iş +
  kitaplık + medya. Her yazım öncesi `schema.validate*` kapısı; geçersiz veri yazılmaz.
- **Başlatma:** `tools/trial.ps1` (`-Seed`, `-Port 9791`, `-Dev`) paketli exe'yi
  `work/trial-data` ile açar, PID `work/trial.pid`.
- **Ölçüm:** `work/trial-probe.js` gerçek akışı uçtan uca dener (`bi:ai:system`,
  `bi:teacher:list`, `bi:job:quote`, `bi:student:upload`, `bi:job:create`, `bi:job:get`,
  sonuç medyası). Sayfa görseli gerçek olmalı: 8×8 sabit PNG vision modelinde
  `Failed to load image` → `http-error` verir; prob videosundan çıkarılmış gerçek kare
  (`work/trial-page.png`) kullanılır.
- **Tek komut doğrulama (D-046, D-047):** `tools/trial-check.ps1` sırayla test/lint/doctor →
  paket → tohum → açılış → gerçek üretim → telefondan oynatma → kurulabilir PWA/çevrimdışı
  kabuk adımlarını ölçer ve tek karar yazar (`GECTI`/`KALDI`, çıkış kodu 0/1). `-Quick`
  yalnız kalite kapılarını, `-SkipBuild` hazır `dist`'i kullanır; süreç sonunda kapatılır.
  Yeni bağımlılık yoktur.
- **Kurallar:** gerçek ödeme yok (`paymentMode:'simulated'`), bulut kapalı
  (`allowCloud:false`), `dist/` paketi veri taşımaz.

## 9. Kalite kapıları

```
node --test tests/     -> tümü yeşil
node tools/lint.js     -> 0 hata (ham renk, !important, inline style, eksik kimlik, söz dizimi)
node tools/doctor.js   -> ortam + ollama + electron + paket kontrolü
tools/build.ps1        -> dist/BilgiAl/BilgiAl.exe açılıyor
```
