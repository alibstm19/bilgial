# BilgiAl — Yol Haritası (v0.1 → v0.4)

Sürüm: 0.1.0 · Son güncelleme: 2026-11-04 · Sahip: LDR
İlke: Bu belgede **"var"** denilen her şey `src/` içinde çalışan kodla eşleşir; eşleşmeyen her şey
"v0.1 kapsamı dışı" ya da "plan" olarak işaretlidir. Her satırın kanıtı §9'dadır.

> **Tek cümle:** v0.1 bugün slayt + metin üretir; v0.2 sesi, v0.3 yüzü, v0.4 gerçek parayı ekler.
> Sıra tesadüf değil: her sürüm bir öncekinin hukuki ve teknik kapısını açmadan başlamaz.

---

## 0. Sürüm özeti

| Sürüm | Tema | Kullanıcının gördüğü sonuç | Durum | Blokaj |
|---|---|---|---|---|
| **v0.1** | Çalışan iskelet | Sayfa → analiz → plan → **slayt + metin** kütüphanede | ✅ Kanıtlandı | — |
| **v0.2** | Ses | Aynı çıktı + **seslendirme** (mp3/wav) | 📋 Plan | Whisper/Piper/XTTS model kurulumu |
| **v0.3** | Yüz | Aynı çıktı + **dudak senkronlu video** | 📋 Plan | Wav2Lip/SadTalker + ffmpeg + GPU |
| **v0.4** | Para | Gerçek ödeme, fatura, iade | 📋 Plan | Ödeme kuruluşu + mevzuat |

Bugünkü gerçek: `pipeline.js` her işi `partial` bitirir; `voice` ve `compose` aşamaları
`pending-model` ile atlanır, çıktı yalnız slayttır (`src/main/services/pipeline.js:279-319`,
`src/main/services/pipeline.js:338`).

---

## 1. "Kanıtlanmış" tanımı

Bir yetenek ancak şu üçü birlikte doğruysa **v0.1'de var** sayılır:

| Koşul | Nasıl doğrulanır |
|---|---|
| Kod yolu çalışıyor | İlgili servis fonksiyonu gerçek veriyle çağrılabiliyor |
| Arayüzde giriş noktası var | `src/renderer/index.html` + `screens/*.js` içinde düğme/alan |
| Ölçülebilir çıktı üretiyor | `library.json` kaydı, credit defteri satırı veya `stages` durumu |

Üçünden biri yoksa satır "kısmi" veya "v0.1 kapsamı dışı" yazılır. Bu yüzden örneğin
`bi:job:cancel` kanalı vardır ama **iptal düğmesi yoktur** → kullanıcı için "yok" sayılır.

---

## 2. v0.1 — Bugün kanıtlanmış kapsam

### 2.1 Çalışan yetenekler

| Yetenek | Kanıt (dosya:satır) | Not |
|---|---|---|
| Yerel kayıt/giriş, 3 rol, scrypt parola | `src/main/services/accounts.js` | İlk hesap zorunlu `admin` |
| Sayfa yükleme: PNG/JPG/WebP, sihirli bayt denetimi | `src/main/services/students.js:81-90`, `:122-162` | PDF **reddedilir** |
| 10 sayfa / 50 MB sınırı | `src/main/services/settings.js:115`, `:341-345` | UI "500 MB" yazsa da sunucu 50 MB |
| Vision analizi (Ollama `qwen3-vl`) | `src/main/services/pipeline.js:170-215` | Model yoksa `pending-model` |
| LLM planı + `styleVector` enjeksiyonu | `src/main/services/pipeline.js:218-275` | Eğitilmemiş öğretmende iş reddedilir |
| Slayt artefaktı (`slides.html`) | `src/main/services/ai/slides.js` | Bağımlılıksız, yerleşik |
| Kütüphane kaydı | `src/main/services/pipeline.js:321-336` | `library.json` |
| Credit defteri, paketler, %30 pay, iade | `src/main/services/credits.js:21-23`, `src/main/services/credits.js:79+` | 1 credit = 1 sent |
| Fiyat teklifi formülü | `src/main/services/jobs.js:46-63` | `paymentMode: 'simulated'` |
| Öğretmen doğrulama + $10 | `src/main/services/teachers.js:566-594` | Rıza yoksa onay reddedilir |
| Rıza kaydı (`consent.json`) | `src/main/services/teachers.js:469-488` | Geri alma silmez |
| AI bağlantı merkezi + probe | `src/shared/ai-registry.js:23-105` | 9 konektör |

### 2.2 Bilerek yapılmayanlar (v0.1 kapsamı dışı)

| Konu | Neden yok | Hangi sürüm |
|---|---|---|
| Seslendirme (TTS) | Model/ikili kurulu değil; `voice` aşaması `skipped` | v0.2 |
| Transkript (STT) | Whisper + Python paketi yok | v0.2 |
| Avatar / dudak senkronu | Wav2Lip/SadTalker ağırlıkları yok | v0.3 |
| Video birleştirme | `ffmpeg` PATH'te yok | v0.3 |
| Ortam sesi/gürültü temizleme | Ses hattı olmadığı için anlamsız | v0.2 |
| Gerçek ödeme | Hukuk + ödeme kuruluşu hazır değil | v0.4 |
| Sunucu / çok cihaz senkronu | Tek makine mimarisi bilinçli | v0.4+ |
| PDF → PNG dönüşümü | Dönüştürücü bağımlılık yok | v0.2 (aday) |
| İptal / işaretle / yeniden dene düğmeleri | IPC kanalı var, UI düğmesi yok | v0.2 (aday) |
| Ses/yüz silme düğmesi | `bi:teacher:deleteVoice` var, UI yok | v0.3 |

### 2.3 v0.1 teknik borcu ve dürüstlük düzeltmeleri

Bunlar "özellik" değil, **belgede yanlış anlatılan gerçeklerdir**; sürüm planı bunları kapatmalıdır.

| # | Sorun | Kodda gerçek | Etki |
|---|---|---|---|
| B-01 | Admin ekonomi "AI maliyeti düşülmüş" diyor | `aiCostCents: 0` sabit (`src/main/main.js:320`) | Marj rozetleri olduğundan yüksek görünür |
| B-02 | Yüklenen videonun süresi | `durSec = 0`; onay "≥180 sn temiz örnek" kontrolü 0 gösterir | Admin yanlış reddedebilir |
| B-03 | Çalışma alanı soru/dakika | `questions = pages*3`, `minutes = pages*2` otomatik | Öğrenci gerçek soru sayısını giremez |
| B-04 | PDF | Arayüz seçtirir, `students.sniffImage` reddeder | Kullanıcı hatası sanır |
| B-05 | Yükleme sınırı | Sunucu 50 MB, arayüz "500 MB" yazar | Büyük dosya sessiz reddedilir |
| B-06 | Rıza geri alma | Onay kutusu kaldırılsa da `consent.json` durur | "Rızamı geri aldım" yanlış güven |
| B-07 | İptal/işaretle/yeniden dene | Yalnız IPC kanalı, düğme yok | R-03 azaltımı kâğıt üstünde |

---

## 3. v0.2 — Ses (TTS) + transkript (Whisper)

**Hedef:** İş `partial` yerine `done` bitsin; kütüphanede **sesli** çıktı olsun.

### 3.1 İş kalemleri

| # | İş | Dosya | Bağımlılık | Kabul ölçütü |
|---|---|---|---|---|
| V2-01 | Whisper konektörünü gerçek çalıştır | `src/main/services/ai/stt.js` | Python 3.12 + `faster-whisper` | 3 dk videodan transkript, `stt` aşaması `done` |
| V2-02 | Piper'ı bağla (öğretmen sesi olmadan) | `src/main/services/ai/tts.js` | Piper ikilisi + TR ses modeli | Sahne başına wav, toplam süre raporlanır |
| V2-03 | XTTS ses klonunu bağla | `src/main/services/ai/tts.js` | XTTS v2 ağırlıkları + rıza | `voiceProfile.voiceId` ile sentez |
| V2-04 | `voice` aşamasını gerçek çağrıya çevir | `src/main/services/pipeline.js:279-286` | V2-02/03 | `skip()` yerine `execute()` |
| V2-05 | Konektör durumlarını `ready` yap | `src/shared/ai-registry.js:42-68` | Model kurulumu | Arayüzde "hazır" |
| V2-06 | Ayarlar ekranında TTS/STT seçimi | `src/renderer/screens/settings.js` | V2-01/02 | Seçim `settings.ai.tts/stt`'ye yazılır |
| V2-07 | Transkript yükleme (STT yoksa) | `src/main/services/teachers.js` | — | Video olmadan `styleVector` çıkarılabilir |
| V2-08 | Süre ölçümü düzeltmesi (B-02) | `src/main/services/teachers.js` | ffprobe/ffmpeg | `durSec` gerçek saniye |
| V2-09 | PDF → PNG (aday) | `src/main/services/students.js:81-90` | `pdftoppm`/pdf.js | PDF kabul edilir, sayfa sınırı korunur |
| V2-10 | İptal/işaretle/yeniden dene düğmeleri | `src/renderer/screens/workspace.js` | IPC hazır | R-03 azaltımı gerçekten çalışır |

### 3.2 v0.2 "bitti" tanımı

- [ ] `voice` aşaması `done`, `skipped` değil.
- [ ] İş `done` döner (en az bir gerçek ses artefaktı varsa).
- [ ] `node --test tests/` yeşil; ses üretimi için yeni test.
- [ ] Rıza yoksa XTTS **çalışmaz** (kapı korunur).
- [ ] `doctor` çıktısında Whisper/Piper/XTTS "hazır".

### 3.3 Kapsam dışı (v0.3'e)

- Dudak senkronu, yüz, video birleştirme.
- Duygu tonlaması, çok konuşmacılı ses.
- Bulut TTS (yerel öncelik ilkesi korunur).

---

## 4. v0.3 — Avatar / dudak senkronu + rıza yönetimi

**Hedef:** Slayt + ses + **konuşan öğretmen yüzü** tek videoda.

### 4.1 İş kalemleri

| # | İş | Dosya | Bağımlılık | Kabul ölçütü |
|---|---|---|---|---|
| V3-01 | ffmpeg'i PATH'ten bul ve doğrula | `src/shared/ai-registry.js:87-95` | ffmpeg ikilisi | `doctor` "hazır" |
| V3-02 | Wav2Lip konektörü | `src/main/services/ai/avatar.js` | Kod + ağırlık + GPU | Ses + tek foto → dudak senkronu |
| V3-03 | SadTalker (baş hareketi) | `src/main/services/ai/avatar.js` | Ağırlıklar, VRAM | Alternatif konektör |
| V3-04 | `compose` aşamasını gerçek videoya çevir | `src/main/services/pipeline.js:288-319` | V3-01/02 | `compose` `done`, mp4/webm |
| V3-05 | Rıza sürümleme + geri alma | `src/main/services/teachers.js:469-488` | — | Geri alma `consent.json`'u geçersiz kılar |
| V3-06 | "Sesimi/yüzümü sil" düğmesi | `src/renderer/screens/studio.js` | `bi:teacher:deleteVoice` | `voiceId` + referans dosya silinir |
| V3-07 | Rıza denetim izi | `consent.json` + `teachers.json` | V3-05 | Kim, ne zaman, hangi metin sürümü |
| V3-08 | Reşit olmayan için veli onayı | `src/main/services/accounts.js` | Hukuk kararı (R-02) | Onaysız üretim yok |
| V3-09 | Model lisans kaydı | `docs/ai-mimari.md` | R-11 | Ticari kullanım onaylı ağırlık |

### 4.2 v0.3 "bitti" tanımı

- [ ] `compose` `done`; çıktı oynatılabilir video.
- [ ] Rıza geri alındığında yeni üretim **reddedilir**, eski profil silinir.
- [ ] Silme işlemi referans dosyaları da kaldırır (yalnız kayıt değil).
- [ ] VRAM ölçümü: 16 GB'de tek eşzamanlı iş çökmüyor.
- [ ] Lisanssız ağırlık paketlenmiyor.

### 4.3 Kapsam dışı

- Gerçek zamanlı avatar, canlı ders.
- Yüz değiştirme (face-swap) — etik ve hukuken ayrı ürün.

---

## 5. v0.4 — Gerçek ödeme + hukuk

**Hedef:** `paymentMode: 'simulated'` → gerçek tahsilat; defter ile banka mutabakatı.

### 5.1 İş kalemleri

| # | İş | Dosya | Bağımlılık | Kabul ölçütü |
|---|---|---|---|---|
| V4-01 | Ödeme kuruluşu entegrasyonu | yeni `src/main/services/payments.js` | Sağlayıcı sözleşmesi | Test ödemesi başarılı |
| V4-02 | Sunucu tarafı doğrulama | `main.js` `credits:purchase` | V4-01 + backend | İstemci tutarı değiştiremez |
| V4-03 | Webhook / mutabakat | V4-01 | İmza doğrulama | Ödeme ↔ defter satırı eşleşir |
| V4-04 | Fatura / makbuz | V4-01 | Vergi kaydı | Her satın alma için belge |
| V4-05 | İade akışı | `src/main/services/credits.js` | V4-01 | İade defterde izlenir |
| V4-06 | Mesafeli satış sözleşmesi | `docs/` | Hukuk | Kullanıcı onayı kayıtlı |
| V4-07 | KVKK aydınlatma + silme hakkı | `docs/` | Hukuk | Talep akışı tanımlı |
| V4-08 | Reşit olmayan / veli onayı | `accounts.js` | V4-06 | Onaysız ödeme yok |
| V4-09 | `aiCostCents` gerçek ölçüm (B-01) | `src/main/main.js:320` | Yerel GPU sayacı | Marj doğru gösterilir |

### 5.2 v0.4 "bitti" tanımı

- [ ] Gerçek kart/havale ile paket satın alınabiliyor.
- [ ] `sum(ledger) == balance` her kullanıcıda korunuyor.
- [ ] İade, vergi ve fatura hukuken tamam.
- [ ] Ödeme olmadan üretim başlatılamıyor; üretim olmadan pay yazılmıyor.
- [ ] Sırlar `safeStorage`'da; repoda anahtar yok.

### 5.3 Kapsam dışı

- Abonelik, kupon, kurumsal fatura (sonraki sürüm).
- Uluslararası ödeme/vergi.

---

## 6. Bağımlılık ve öncelik

```
v0.1 (bugün)
  │
  ├─► v0.2 ses ──► v0.3 yüz ──► (video ürünü tamam)
  │        │
  │        └─► rıza yönetimi erken gerekir (v0.3 kapısı)
  │
  └─► v0.4 para ──► hukuk (paralel, bağımsız)
```

| Kural | Gerekçe |
|---|---|
| v0.3, v0.2 olmadan başlamaz | Dudak senkronu ses gerektirir |
| v0.4, hukuk olmadan başlamaz | R-06: mesafeli satış + vergi |
| Rıza yönetimi v0.3'ten önce bitmeli | R-01: ses/yüz klonlama kapısı |
| Telif uyarısı v0.2'de arayüze girmeli | R-07: yüklenen sayfa ders kitabı olabilir |
| Model lisansı her sürümde kontrol | R-11: ticari kullanım |

---

## 7. Kritik uyarılar (yayın kapısı)

Bu dört madde **teknik değil hukuki** kapılardır; kod hazır olsa bile bunlar kapanmadan sürüm çıkmaz.

| # | Uyarı | Neden kritik | Yayın öncesi zorunlu | Kaynak |
|---|---|---|---|---|
| **U-1** | **Telif:** Yüklenen sayfa ders kitabı olabilir | Kullanıcı telifli içerik yükler; üretilen çözüm türev eser sayılabilir | "Yalnız kendi materyalin" beyanı + yüklemede uyarı + şikâyetle silme + ticari yeniden dağıtım yasağı | `docs/riskler.md:14` (R-07) |
| **U-2** | **Reşit olmayan öğrenci verisi** | Sayfa görseli ve soru metni çocuk verisi olabilir | Varsayılan yerel depolama, bulut kapalı, loglarda içerik yok, veli onayı alanı, silme hakkı | `docs/riskler.md:9` (R-02) |
| **U-3** | **Ses/yüz klonlama rızası** | Öğretmen sesi izinsiz klonlanırsa hukuk + itibar zararı | `consent.json` olmadan profil/`verified` yok; sürümlü + zaman damgalı rıza; kalıcı silme; klon yalnız yerel | `docs/riskler.md:8` (R-01), `src/main/services/teachers.js:469-488`, `:576-577` |
| **U-4** | **Ödeme lisansı/mevzuatı** | Gerçek tahsilat, mesafeli satış, vergi ve iade yükümlülüğü | Ödeme kuruluşu + mesafeli satış sözleşmesi + vergi kaydı + sunucu tarafı doğrulama | `docs/riskler.md:13` (R-06), `src/main/services/jobs.js:62` |

> Ek uyarı (U-5): **model lisansı.** XTTS/Wav2Lip/SadTalker ağırlıkları ticari kullanıma uygun
> olmayabilir; lisanssız ağırlık paketlenmez (`docs/riskler.md:18`, R-11).

---

## 8. Sürüm kapıları — ölçülebilir "bitti"

| Kapı | v0.1 | v0.2 | v0.3 | v0.4 |
|---|---|---|---|---|
| `node --test tests/` | ✅ yeşil | ses testleri eklenir | video testleri | ödeme testleri |
| `node tools/doctor.js` | Ollama + Electron | + Whisper/Piper/XTTS | + ffmpeg/GPU | + ödeme sağlayıcı |
| İş durumu | `partial` | `done` (ses) | `done` (video) | `done` |
| Rıza kapısı | Var (onay) | Var | + geri alma/silme | + veli onayı |
| Ödeme | Simülasyon | Simülasyon | Simülasyon | **Gerçek** |
| Telif uyarısı | Yok | Arayüzde | Arayüzde | Sözleşmede |

---

## 9. Kanıt dizini

| İddia | Dosya:satır |
|---|---|
| `voice`/`compose` `pending-model` ile atlanır | `src/main/services/pipeline.js:279-319` |
| İş `skipped` varsa `partial` döner | `src/main/services/pipeline.js:338` |
| Konektör durumları: whisper/piper/xtts/wav2lip/sadtalker/ffmpeg `pending-model` | `src/shared/ai-registry.js:42-95` |
| Ollama ve slides `ready` | `src/shared/ai-registry.js:23-32`, `:96-104` |
| Rıza kaydı ve onay kapısı | `src/main/services/teachers.js:469-488`, `:576-577` |
| Doğrulama + $10 hoş geldin | `src/main/services/teachers.js:566-594` |
| `styleVector` eğitimi `state:'ready'` | `src/main/services/teachers.js:386-388` |
| Credit birimi ve hoş geldin 1000 | `src/main/services/credits.js:21-23` |
| Fiyat formülü ve `paymentMode:'simulated'` | `src/main/services/jobs.js:46-63` |
| `aiCostCents: 0` | `src/main/main.js:320` |
| 10 sayfa / 50 MB varsayılanı | `src/main/services/settings.js:115`, `:341-345` |
| PNG/JPG/WebP sihirli bayt; PDF yok | `src/main/services/students.js:81-90`, `:162` |
| Risk kayıtları R-01, R-02, R-06, R-07, R-11 | `docs/riskler.md:8-18` |
| AI konektör tablosu ve v0.1/v0.2 durumu | `docs/ai-mimari.md:19-53` |
| Ekonomi formülü ve paketler | `docs/ekonomi.md:6-47` |

---

## 10. Açık kararlar (LDR onayı gerekir)

| # | Karar | Etki |
|---|---|---|
| K-1 | v0.2'de PDF dönüşümü yapılsın mı? | Yeni ikili bağımlılık (`pdftoppm`) |
| K-2 | XTTS mi Piper mı varsayılan? | Klon kalitesi vs CPU hızı |
| K-3 | Veli onayı v0.1'e mi, v0.3'e mi? | R-02 kapsamı |
| K-4 | Gerçek ödeme için hedef pazar/mevzuat | v0.4 takvimi |
| K-5 | Hangi ses/avatar modelleri ticari lisanslı? | R-11, paketleme |
