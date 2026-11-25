# BilgiAl — AI Mimarisi (v1)

Sahip: LDR · Bağlayıcı. Kodda karşılığı: `src/main/services/ai/*`, `src/shared/ai-registry.js`.

## 1. İlke: tek arayüz, çok sağlayıcı

Her AI yeteneği bir **konektör**. Uygulama hiçbir sağlayıcıya doğrudan bağlı değil; kayıt defterinden
(`registry`) seçer. Sağlayıcı değişince pipeline kodu değişmez.

```
kind: llm | vision | stt | tts | avatar | video
Her konektör:
  id, kind, label, local:boolean
  probe()  -> {ok, latencyMs, detail}      // sağlık
  models() -> [{id, sizeGb, note}]         // kullanılabilir modeller
  run(job, opts) -> stream|result
```

### Konektörler (v0.1 kapsamı)

| Konektör | Kind | Durum | Not |
|---|---|---|---|
| `ollama` | llm, vision | ✅ kod + canlı probe | `127.0.0.1:11434`; `qwen3-vl:8b` vision |
| `openai-compatible` | llm, vision | ✅ kod | Yerel vLLM/LM Studio/uzak; endpoint kullanıcı girer |
| `whisper-local` | stt | ⛔ arayüz | Python bağımlılığı; `pending-model` |
| `piper` | tts | ⛔ arayüz | Hızlı, CPU'da çalışır; `pending-model` |
| `xtts` | tts (ses klonu) | ⛔ arayüz | Öğretmen sesi için; rıza zorunlu |
| `wav2lip` | avatar | ⛔ arayüz | Dudak senkronu; `pending-model` |
| `sadtalker` | avatar | ⛔ arayüz | Baş hareketi; ağır |
| `ffmpeg` | video | ⛔ arayüz | PATH'te yok; `pending-model` |
| `slides` | video | ✅ kod (yerleşik) | Canvas/SVG slayt + ses → webm/animasyon; bağımlılıksız |

**Kritik:** `slides` konektörü sayesinde uygulama, hiçbir ağır model olmadan **çalışan bir çıktı**
üretebilir (slayt + seslendirme). Avatar geldiğinde aynı pipeline'da aşama değişir.

## 2. Pipeline (iş = job)

```
ingest → analyze → plan → voice → compose → deliver
```

| Aşama | Girdi | Çıktı | Konektör | v0.1 |
|---|---|---|---|---|
| `ingest` | sayfa görselleri (png/jpg/pdf→png) | normalize görüntü, sayfa sayısı | — | ✅ |
| `analyze` | görüntü | `{subject, topics[], questions[{no,text,type}], complexity}` | vision | ✅ gerçek |
| `plan` | analiz + öğretmen profili | `{scenes[{id,title,bullets,speech,durationSec}]}` | llm | ✅ gerçek |
| `voice` | `speech` metinleri + ses profili | ses dosyaları | tts | ⛔ `pending-model` |
| `compose` | slaytlar + ses | video dosyası | video/avatar | ⚠️ slayt-only |
| `deliver` | video | kütüphane kaydı | — | ✅ |

Her aşama: `status(pending|running|done|failed|skipped)`, `startedAt`, `endedAt`, `costCredits`,
`note`. Hata olursa iş `failed` + **tam iade**. Aşama `pending-model` ise iş **kısmi** teslim edilir
(analiz + plan + slayt metni gösterilir, ses/video yerine "model gerekli" kartı).

## 3. Öğretmen profili (en özgün kısım)

İki katman:

**A) Betimleyici profil** (`styleVector`, LLM ile çıkarılır)
```json
{
  "pace": "orta",            // kelime/dk bandı
  "tone": "samimi-öğretici",
  "structure": "soru→ipucu→çözüm→özet",
  "catchphrases": ["bir bakalım", "dikkat edin"],
  "difficultyRamp": "kolaydan zora",
  "questionStyle": "önce şıkları eleyerek",
  "analogies": "günlük hayat",
  "avoid": ["ezber", "jargon"]
}
```
Üretimde bu vektör **LLM sistem istemine** enjekte edilir → aynı konu, o hocanın anlatımıyla.

**B) Ses profili** (`voiceProfile`, TTS klonu)
- 3–10 dk temiz konuşma → `xtts`/`piper` referansı → `voiceId`.
- **Rıza kapısı:** `consent.json` yoksa ses profili oluşturulmaz, `verified` olunamaz.
- Silme: öğretmen "sesimi sil" dediğinde `voiceId` ve referans dosyaları kalıcı silinir.

**Eğitim akışı:** video yükle → `stt` (yoksa LLM'e transkript yapıştırma seçeneği) → `styleVector`
çıkar → `trainingProgress` (0-100) → "kaynaklar hazır" → admin kuyruğu → onay → `verified` + $10.

## 4. Maliyet ve kota

- Yerel: GPU süresi ölçülür (`stage.durationMs`), credit'e **yansımaz** (fiyat sabit).
- Bulut: token/saniye sayacı, `settings.ai.cloudBudgetMonthly` sınırı; aşarsa yeni iş reddedilir.
- Eşzamanlılık: 1 (tek GPU). Kuyruk FIFO, iptal edilebilir.

## 5. Gizlilik

- Sayfa görselleri ve üretimler `userData/media/` altında, dışarı çıkmaz.
- Bulut konektörü açıksa arayüz **açık uyarı** gösterir ve `settings.ai.allowCloud` işareti ister.
- Loglarda metin içeriği yazılmaz; yalnız kimlik, aşama, süre, hata kodu.

## 6. Bugünkü gerçek durum (ölçüldü, 2026-11-04)

```
ollama serve  : 200 OK
modeller      : qwen3-vl:8b-instruct-q4_K_M (6.2 GB)
python        : 3.12, paket yok
ffmpeg        : PATH'te yok
GPU           : RTX 4070 Ti SUPER (16 GB)
```

Sonuç: **vision + llm yolu bugün çalışır** (llm için `ollama pull` bir kez gerekir).
Ses/video yolu kod olarak hazır, model kurulunca devreye girer.

## 7. Yerel AI Merkezi — 16 GB VRAM için model seçimi (v0.2)

Hedef donanım: **RTX 4070 Ti SUPER, 16 GB VRAM, 256-bit**, 466 GB boş disk, Ollama kurulu,
Python 3.12. Katalog kodu: `src/shared/local-catalog.js` (contract §7.1). Küratörlü liste
**21 kayıt**tır; hiçbir model kendiliğinden indirilmez, yalnız kullanıcı düğmesiyle indirilir.

Tablolarda boyut/VRAM **GB**, hız ve kalite **1-5**'tir. "Türkçe" konuşma/okuma kalitesidir;
`ffmpeg`/`slides` gibi araç kayıtlarında dil bağımsız oldukları için `weak` yazılır.

### 7.1 LLM (7)

| Model | Boyut | VRAM | Hız / Kalite | Türkçe | Ne zaman seçilir |
|---|---:|---:|---|---|---|
| `qwen2.5:7b-instruct` | 4,7 | 5,5 | 4 / 4 | best | **Varsayılan**; dengeli preset, vision ile birlikte sığar |
| `qwen2.5:14b-instruct-q4_K_M` | 9,0 | 10,5 | 3 / 5 | best | Kalite preset; en iyi yerel plan, vision ile aynı anda yüklenemez |
| `qwen2.5:3b` | 1,9 | 2,6 | 5 / 3 | good | Hızlı preset; taslak, düşük gecikme, zayıf GPU |
| `llama3.1:8b` | 4,9 | 6,0 | 4 / 4 | good | Genel alternatif; Llama lisansı ticari kullanımda gözden geçirilir |
| `gemma2:9b` | 5,5 | 6,6 | 3 / 4 | good | Kısa/öğretici yanıt alternatifi |
| `mistral-nemo:12b` | 7,1 | 8,4 | 3 / 4 | good | Uzun bağlamlı metinler |
| `deepseek-r1:8b` | 5,2 | 6,2 | 3 / 4 | weak | Matematik/fizikte adım adım akıl yürütme; Türkçe zayıf |

### 7.2 Vision (4)

| Model | Boyut | VRAM | Hız / Kalite | Türkçe | Ne zaman seçilir |
|---|---:|---:|---|---|---|
| `qwen3-vl:8b-instruct-q4_K_M` | 6,2 | 7,0 | 3 / 5 | best | **Kurulu ve varsayılan**; sayfa/soru okumada en iyi Türkçe |
| `qwen2.5vl:7b` | 6,0 | 7,2 | 3 / 4 | good | El yazısı/tablo ağırlıklı alternatif |
| `llava:13b` | 8,0 | 9,5 | 2 / 3 | weak | Eski yedek; yalnız İngilizce içerik |
| `llama3.2-vision:11b` | 7,8 | 9,0 | 2 / 4 | good | Genel görsel anlama; yavaş, Llama lisansı |

### 7.3 STT (3)

| Model | Boyut | VRAM | Hız / Kalite | Türkçe | Ne zaman seçilir |
|---|---:|---:|---|---|---|
| `faster-whisper-large-v3` | 3,0 | 4,5 | 3 / 5 | best | Öğretmen videosu eğitimi; en doğru transkript |
| `faster-whisper-medium` | 1,5 | 2,5 | 4 / 4 | good | Dengeli preset; günlük transkript |
| `faster-whisper-small` | 0,5 | 1,2 | 5 / 3 | weak | Hızlı preset; kaba taslak transkript |

### 7.4 TTS (3)

| Model | Boyut | VRAM | Hız / Kalite | Türkçe | Ne zaman seçilir |
|---|---:|---:|---|---|---|
| `piper-tr_TR-dfki-medium` | 0,06 | 0 (CPU) | 5 / 3 | best | **Varsayılan**; hızlı, VRAM yemez |
| `xtts-v2` | 1,8 | 4,0 | 2 / 5 | good | Öğretmen sesi klonu; **yazılı rıza zorunlu**, lisans ticari kullanıma kapalı olabilir |
| `piper-en_US-lessac-medium` | 0,06 | 0 (CPU) | 5 / 3 | weak | İngilizce içerik/karşılaştırma |

### 7.5 Video (2) ve Avatar (2)

| Model | Boyut | VRAM | Hız / Kalite | Türkçe | Ne zaman seçilir |
|---|---:|---:|---|---|---|
| `ffmpeg` | 0,08 | 0 | 4 / 5 | — | Slayt + ses birleştirme; PATH'te olmalı |
| `slides` | 0 | 0 | 5 / 3 | — | Yerleşik, bağımlılıksız slayt videosu |
| `wav2lip` | 2,4 (0,4 model + ~2 torch) | 6,0 | 2 / 3 | — | Dudak senkronu; lisans araştırma amaçlı |
| `sadtalker` | 4,0 (2 model + ~2 torch) | 9,0 | 1 / 4 | — | Baş hareketi; yavaş, VRAM ağır |

### 7.6 Presetler

| Preset | Modeller (llm + vision + stt + tts) | Toplam VRAM | Ne zaman |
|---|---|---:|---|
| `hizli` | 3B + Qwen3-VL 8B + whisper-small + piper-tr | 10,8 | Zayıf GPU, taslak, en düşük gecikme |
| `dengeli` | 7B + Qwen3-VL 8B + whisper-medium + piper-tr | 15,0 | **Varsayılan**; 16 GB'da güvenli |
| `kalite` | 14B-Q4 + Qwen3-VL 8B + whisper-large-v3 + xtts-v2 | 26,0 | 16 GB sınırında en yüksek kalite; model değişimiyle |

> Preset `vramGb` değeri katalogdaki **tüm modellerin tepe VRAM toplamıdır** (temkinli üst sınır).
> Pipeline aşamaları sıralı olduğu için gerçek eşzamanlı yük genelde daha düşüktür; yine de
> `recommendFor` toplam **12,5 GB**'ı aşınca uyarı üretir.

### 7.7 Kritik hesap: 14B + vision birlikte çalışır mı?

**Hayır, aynı anda yüklenmez.**

```
kalite  : Qwen2.5 14B Q4  10,5 GB
          Qwen3-VL 8B      7,0 GB
          -------------------------
          toplam          17,5 GB  >  16 GB VRAM
```

Ollama tek GPU'da modelleri **değiştirir (swap)**: vision çağrısı geldiğinde 14B boşaltılır,
7 GB vision yüklenir; sonraki LLM çağrısında 14B yeniden yüklenir. Sonuç: ilk token gecikmesi
ve diskten okuma. Bu yüzden `recommendFor(16)` "kalite" presetini önerirken **uyarı** döndürür ve
`#ai-recommend-banner` bu uyarıyı göstermek zorundadır ("vision çağrısı LLM'i boşaltır").

Karşılaştırma:

```
dengeli : 7B 5,5 + vision 7,0 = 12,5 GB  -> 16 GB'a sığar (birlikte çalışır)
hizli   : 3B 2,6 + vision 7,0 =  9,6 GB  -> rahat
```

Not: `fitFor(model, vramGb)` **tek modeli** ölçer (`≤%75 ok`, `≤%100 tight`, `>%100 over`).
Birlikte sığma kontrolü `recommendFor`/`totalVram` işidir; 14B tek başına `10,5/16 = %66 → ok`
görünürken vision ile toplamı taşar. Bu yüzden iki kontrol birlikte kullanılır.

### 7.8 Dosya ve kanallar

- Kurulum kaydı: `userData/data/ai-installs.json` → `{schemaVersion:1, items:{[modelId]:{state, installedAt, sizeGb, runtime, path?}}, downloads:[]}` (`schema.js`).
- Kanallar (contract §7.2): `bi:ai:catalog|system|installed|download|cancelDownload|downloads|remove|preset|setDefault`, olay `bi:event:download`.
- İndirme yazma kanalları `{confirm:true}` ister; ilerleme `bi:event:download` ile canlı akar.

### 7.9 Donanıma göre kademeli indirme (`tools/models-pull.js`)

Arayüzden bağımsız, tek komutluk indirici. `core` (21.5 GB) → `quality` (~103 GB) →
`speech` → `heavy` (deneysel 70B). Yalnız `ollama pull` çalıştırır, kurulu modeli atlar,
disk yetmezse başlamaz (%15 pay), günlük `work/models-pull.log`. Ses klonlama (`xtts-v2`)
rıza kapısında olduğu için araç onu indirmez. Ayrıntı: `docs/deneme-surumu.md` §1.

**Neden 200 GB doldurulmuyor:** 70B sınıfı 32 GB RAM'de diske takas eder; deneme
oturumunu yavaşlatır. Bu yüzden kalite kademesi 16 GB VRAM'e oturan MoE `qwen3:30b-a3b`
ile kapanır, 70B `heavy`de deneysel kalır.
