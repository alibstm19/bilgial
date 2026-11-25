# BilgiAl — Kullanım Kılavuzu (v0.1)

Sürüm: 0.1.0 · Son güncelleme: 2026-11-04 · Kapsam: **yalnız kodda var olan davranış**.
Bu kılavuzdaki her adım `src/` içinde doğrulandı; doğrulanamayan her şey "v0.1 kapsamı dışı" yazıldı.
Bölüm sonundaki **Kanıt dizini** hangi bilginin hangi dosyada olduğunu gösterir.

> **Tek cümle:** Öğrenci sayfasını yükler, doğrulanmış bir öğretmen seçer, maliyeti görür, üretimi
> başlatır; çıktı slayt + metin olarak kütüphaneye düşer. Her şey bu makinede kalır; ödeme simülasyondur.

---

## 0. Bu sürümde ne var, ne yok

| Var (çalışıyor) | Yok / kısmi (dürüst durum) |
|---|---|
| Yerel kayıt/giriş, 3 rol (öğrenci/öğretmen/yönetici) | Sunucu, çoklu cihaz senkronu |
| Sayfa görseli yükleme (PNG/JPG/WebP), en fazla 10 sayfa | **PDF ayrıştırma yok** (arayüz PDF seçtirse de sunucu reddeder) |
| Vision ile sayfa analizi (Ollama + `qwen3-vl`) | Metin LLM modeli ayrıca kurulmalı (`ollama pull`) |
| LLM ile ders planı + öğretmen `styleVector` enjeksiyonu | TTS (seslendirme) yok → `pending-model` |
| Slayt artefaktı (`slides.html`) ve kütüphane | Avatar / dudak senkronu yok |
| Credit defteri, paketler, %30 öğretmen payı, iade | Gerçek ödeme yok → **simülasyon** |
| Öğretmen doğrulama kuyruğu, $10 hoş geldin | Öğretmen sesi klonlama yok (v0.1) |
| Yerel AI bağlantı merkezi + sağlık testi | ffmpeg yok → video birleştirme yok |

---

## 1. Kurulum ve ilk açılış

### 1.1 Gereksinimler

| Gereksinim | Durum / not |
|---|---|
| Windows 10/11 | Hedef platform |
| Node.js ≥ 18 | `npm start` için |
| `src/node_modules` | Depoda hazır gelir; **`npm install` çalıştırmayın** (internetten indirme yapılmaz) |
| Ollama (opsiyonel) | `127.0.0.1:11434`; yoksa uygulama açılır, analiz/plan beklemede kalır |

### 1.2 Çalıştırma

```powershell
cd C:\Users\alibs\BilgiAl\src
npm start
```

`npm.ps1` betik ilkesiyle engellenirse: `npm.cmd start`.

Derlenmiş sürüm için:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build.ps1   # dist\BilgiAl\BilgiAl.exe
tools\BilgiAl.cmd
```

### 1.3 İlk açılışta ne olur

1. Tek örnek kilidi devreye girer; ikinci kez açılırsa var olan pencere öne gelir.
2. Pencere 1360×900 açılır (en küçük 1100×740).
3. **Giriş / Rol** ekranı gelir. Henüz hesap yoksa "Yeni hesap oluştur" kullanılır.
4. Sağ üstteki **"Demo rolü"** seçici yalnız arayüzde hangi menülerin görüneceğini değiştirir;
   yetki her zaman hesabın gerçek rolünden gelir.

> İlk açılışta bir sağlık kontrolü yapılır: Ollama çalışıyorsa ayarlı model kurulu değilse
> mevcut model otomatik seçilir (`modelFallback` için §7.3).

### 1.4 Veri nerede tutulur

Electron `userData` klasörü:

| Klasör | İçerik |
|---|---|
| `<userData>\data\*.json` | `users`, `teachers`, `students`, `jobs`, `library`, `credits`, `settings` |
| `<userData>\media\students\<studentId>\...` | Öğrenci sayfa görselleri |
| `<userData>\media\teachers\<teacherId>\...` | Öğretmen videoları + `consent.json` |
| `<userData>\media\jobs\<jobId>\slides.html` | Üretilen slayt artefaktı |

Windows'ta tipik yol: `%APPDATA%\bilgial\` (paket adı `bilgial`). Uygulamada
**Ayarlar → Gizlilik → Veri klasörünü aç** düğmesi vardır.

---

## 2. Kayıt ve giriş

### 2.1 Alanlar

Giriş ekranı yalnız üç şey ister: **e-posta, parola, rol**. Ayrı bir "ad soyad" alanı yoktur;
kayıt sırasında ad, e-postanın `@` öncesinden türetilir (örn. `elif.yilmaz@ornek.com` → "elif yilmaz").

| Kural | Değer |
|---|---|
| E-posta | Geçerli biçim; küçük harfe çevrilir, 200 karaktere kırpılır |
| Parola | **En az 8 karakter**, en az bir harf + bir rakam (arayüz 4 karakterle izin verse de sunucu reddeder) |
| Parola saklama | `scrypt` + kullanıcıya özel tuz; düz metin yok |
| Oturum | Yalnız bellekte; uygulama kapanınca yeniden giriş gerekir |

### 2.2 Roller ve ilk hesabın özel kuralı

| Rol | Ne yapar | Kayıt kuralı |
|---|---|---|
| **Yönetici (admin)** | Onay kuyruğu, ekonomi, AI ayarları | **Yalnız ilk kayıt admin olur** — ilk kullanıcı hangi rolü seçerse seçsin admin atanır |
| **Öğretmen** | Stüdyo, video/transkript, rıza, kazanç | İlk kullanıcıdan sonra serbest |
| **Öğrenci** | Çalışma alanı, kütüphane, credits | İlk kullanıcıdan sonra serbest |

- İkinci bir admin **oluşturulamaz** (`admin-exists` hatası).
- Öğretmen profili, öğretmen ilk kez **Stüdyo**'yu açtığında otomatik oluşur (boş taslak).
- Öğrenci profili, öğrenci ilk kez çalışma alanı/credits çağrısı yaptığında oluşur.

### 2.3 Giriş / çıkış

- "Giriş yap": e-posta + parola doğrulanır; rol seçimi girişte kullanılmaz, hesabın rolü geçerlidir.
- Menü: **Dosya → Çıkış** (`Alt+F4`). Çıkışta iş kuyruğu durdurulur; bekleyen işler iptal + iade edilir.

---

## 3. Öğretmen rehberi (Stüdyo)

Menü: **Stüdyo** · Yanındaki **Kazanç** ekranı kazanç dökümünü gösterir.

### 3.1 Akışın özeti

```
Kaynak videolar → Transkript → Rıza → Profil eğitimi (%100) → "Kaynaklar hazır"
→ İncelemeye gönder → Yönetici onayı → verified + 1.000 credit ($10)
```

### 3.2 Video / ses yükleme

**Stüdyo → Video ekle.**

| Konu | Kural |
|---|---|
| Kabul edilen uzantılar | `.mp4 .webm .mov .mkv .m4a .wav .mp3 .ogg .opus` |
| Tür otomatiği | `.wav/.mp3/.m4a` → **ses örneği**, diğerleri → **ders anlatımı** |
| Dosya boyutu | **Dosya başına 50 MB** (`media.maxUploadMb`) — arayüzdeki "500 MB" etiketi v0.1'de geçerli değildir |
| Saklama | `media/teachers/<teacherId>/<videoId>-<dosyaadı>` (ad temizlenir) |

**Ne yüklemeli (öneri, kod bunu zorunlu tutmaz):**

- **En az 2 ders anlatımı** videosu (farklı konularda, gerçek ders anlatımı).
- **3–10 dakika temiz konuşma** ses örneği: tek konuşmacı, müzik/gürültü yok, kesintisiz.
- Yüz/vücut görünmek zorunda değil; ses netliği önemli.
- Yüklenen dosya sayısı ve süresi profil kalitesini belirler; süre alanı **ölçülmez**, 0 kalır
  (yönetici ekranında "0 dk" görünebilir — bkz. §6.1 notu).

**Silme:** her kaynağın yanındaki çöp kutusu kaydı ve medya dosyasını siler.

### 3.3 Transkript

**v0.1'de STT (Whisper) yoktur.** Transkript otomatik çıkarılmaz:

1. Video satırında **Transkript ekle**'ye bas.
2. Ders anlatımının metnini yapıştır (en az 20 karakter).
3. **Transkripti kaydet** → rozet "transkript hazır" olur.

Eğitim için **en az bir videonun transkripti** zorunludur. Transkript yoksa eğitim
`no-transcript` hatası verir.

### 3.4 Rıza onayı — neden zorunlu?

**Stüdyo → Rıza ve ses profili** kutusunu işaretle.

| Soru | Yanıt |
|---|---|
| Ne kaydedilir? | `media/teachers/<teacherId>/consent.json` — sürüm, zaman damgası, kullanıcı/öğretmen kimliği, ad ve rıza metni |
| Neden zorunlu? | Ses/yüz klonlama hukuken açık rıza ister. **Rıza kaydı yoksa yönetici onayı `consent-required` ile reddedilir** ve profil `verified` olamaz |
| Kapsam | Yalnız bu uygulamada, yerel işleme; bulut ayrıca açılmalı |
| Geri alma | Rıza metni "kayıtlarımı ve ses profilimi istediğim zaman sildirebileceğimi" içerir; `bi:teacher:deleteVoice` ses profilini ve referans dosyasını siler |
| v0.1 gerçeği | **Ses klonlanmıyor** (TTS/XTTS modeli yok); rıza yine de doğrulama kapısıdır |

> Arayüzde kutuyu kaldırmak kayıtlı rızayı silmez: sunucu `accepted:true` dışındaki isteği
> reddeder ve kutu geri işaretlenir. Silme işlemi `deleteVoice` çağrısıyla yapılır
> (v0.1'de bunun için ayrı bir ekran düğmesi yok — v0.1 kapsamı dışı).

### 3.5 Profil eğitimi ve `styleVector`

**Stüdyo → Profil eğitimi → Eğitimi çalıştır.**

| Adım | İlerleme | Ne olur |
|---|---|---|
| Başlangıç | 0 | Kaynak yok |
| Eğitim başladı | 15 | Durum `training` |
| LLM yanıtı alındı | 70 | Transkriptlerden tarz çıkarımı |
| Bitti | 100 | Durum `ready`, `styleVector` kaydedilir |

Eğitim, transkriptleri **tek bir LLM çağrısında** birleştirir ve yalnız JSON döndürmesini ister.
Model yoksa `no-llm`; model kurulu değilse `modelFallback` ile mevcut model kullanılır (§7.3).

**`styleVector` nedir?** Öğretmenin *ne anlattığı* değil, *nasıl anlattığı*dır. Sekiz alan:

| Alan | Anlamı | Üretimde etkisi |
|---|---|---|
| `pace` | Konuşma hızı bandı (örn. "orta") | Sahne yoğunluğu ve cümle uzunluğu |
| `tone` | Ton (örn. "samimi-öğretici") | Anlatım dili |
| `structure` | Pedagojik sıra (örn. "soru→ipucu→çözüm→özet") | Sahne sırası |
| `catchphrases` | Karakteristik ifadeler ("bir bakalım") | Konuşma metnine calmadan serpiştirilir |
| `difficultyRamp` | Zorluk eğrisi (kolaydan zora) | Sahne zorluk sırası |
| `questionStyle` | Soruya yaklaşım ("önce şıkları eleyerek") | Çözüm stratejisi |
| `analogies` | Benzetme kaynağı ("günlük hayat") | Örnek seçimi |
| `avoid` | Kaçınılacaklar (ezber, jargon) | Üslup kısıtı |

Bu vektör, üretimde **LLM sistem istemine** eklenir; model bu pedagojik kalıpları uygular.
Kimlik taklidi yapılmaz; yalnız tarz kalıpları kullanılır. Eksik alanlarda dürüst varsayılanlar
(`pace:"orta"`, `tone:"samimi-öğretici"`, `structure:"soru→ipucu→çözüm→özet"`,
`difficultyRamp:"kolaydan zora"`) yazılır; uydurma ayrıntı eklenmez.

### 3.6 "Kaynaklar hazır" → inceleme → $10

1. İlerleme **%100** ve rıza işaretli olunca Stüdyo'da şu metin görünür:
   *"Kaynaklar hazır. Gönderince başvurun onay kuyruğuna düşer; onayda $10 hoş geldin bakiyesi yazılır."*
2. **İncelemeye gönder** → öğretmen durumu `review` olur, başvuru admin kuyruğuna düşer.
3. Yönetici onaylarsa durum `verified` olur ve **1.000 credit = $10** hoş geldin bakiyesi yazılır
   (kullanıcı+rol başına **bir kez**, idempotent).
4. Reddedilirse durum `rejected`; ret gerekçesi zorunludur.

> Hoş geldin ödülü **nakit değil**, credit bakiyesidir: 1.000 cr. Öğretmen bunu kendi
> üretimlerinde harcayabilir; "Kazanç" ekranında ayrı satır olarak görünür.

### 3.7 Kazanç ekranı

- Her harcanan creditin **%30'u**, iş **settle** olduğu anda öğretmenin credit bakiyesine yazılır
  (satın alma anında değil, tüketim anında).
- Ekran: bu ay kazanç, tüketilen credit, hareketler (öğretmen payı / doğrulama ödülü / iade).
- **Çekim yoktur:** "Çekim talebi · yakında" düğmesi kapalıdır; v0.1'de gerçek ödeme yapılmaz.
- "Bekleyen pay" alanı v0.1'de 0 döner (hesaplanmış bekleyen yok).

---

## 4. Öğrenci rehberi (Çalışma Alanı)

Menü: **Çalışma Alanı**, **Kütüphane**, **Credits**.

### 4.1 Sayfa yükleme

1. **Dosyaları buraya bırak** alanına tıkla veya dosyaları sürükle.
2. Dosya türü: **PNG, JPG, WebP** (içerik imzasıyla doğrulanır).
3. Sayfa sayısı: **en fazla 10**. Dosya boyutu: **sayfa başına 50 MB**.
4. Her dosya `<userData>\media\students\<studentId>\<uploadId>\pNN.<ext>` altına yazılır.

> **PDF uyarısı:** Arayüz PDF seçimine izin veriyor görünür, ancak v0.1'de PDF→görsel
> dönüştürücü yoktur. PDF yüklenirse `bad-file-type` alınır. **PDF'yi önce PNG/JPG'ye çevirin.**

**Görsel kalite kuralları (öneri — kod yalnız tür/boyut/sayı denetler):**

| Kural | Neden |
|---|---|
| **Tek sayfa** tek karede | Model iki sayfayı tek görselde karıştırabilir |
| **Dik** (portre) ve tam sayfa kadrajda | Kenar kesilirse soru metni eksik okunur |
| **Net**, gölge/parlama yok | Vision modeli bulanık metni yanlış çıkarır |
| Yazı okunur boyutta (örnek ekran görüntüsünde 1600×2200) | Küçük punto → eksik soru |
| El yazısı yerine baskı tercih | El yazısı tanıma güvenilir değil |

### 4.2 Hoca seçimi

- Listede **yalnız `verified` öğretmenler** görünür; `review`/`rejected` profiller seçilemez.
- Kartta ders, konu, kelime/dk ve tarz etiketleri gösterilir.
- Hoca yoksa boş durum: *"Doğrulanmış hoca yok"*.

### 4.3 Maliyet nasıl hesaplanır?

Formül (saf fonksiyon, sent/credit tam sayı):

```
credits = ceil( (10 + sayfa×8 + soru×4 + dakika×3) × karmaşıklık )
BASE = 10   sayfa = 8   soru = 4   dakika = 3
karmaşıklık: kolay ×1.0 · orta ×1.3 · zor ×1.6
```

**Önemli:** Arayüzde soru ve dakika alanı yoktur. Çalışma alanı şu tahmini gönderir:

```
soru   = sayfa × 3
dakika = sayfa × 2
```

Karmaşıklığı kullanıcı "Kolay / Orta / Zor" seçicisinden belirler (varsayılan **orta**).
1 credit = **1 sent** ($0,01). Öğretmen payı = `floor(credit × 0,30)`.

**Örnek tablo (arayüzün gönderdiği soru/dakika tahminleriyle):**

| Sayfa | Soru (×3) | Dakika (×2) | Karmaşıklık | Hesap | Credit | Öğrenci öder | Öğretmen %30 |
|---|---|---|---|---|---|---|---|
| 1 | 3 | 2 | kolay | (10+8+12+6)×1,0 = 36 | **36** | $0,36 | 10 cr ($0,10) |
| 2 | 6 | 4 | orta | (10+16+24+12)×1,3 = 80,6 → 81 | **81** | $0,81 | 24 cr ($0,24) |
| 3 | 9 | 6 | orta | (10+24+36+18)×1,3 = 114,4 → 115 | **115** | $1,15 | 34 cr ($0,34) |
| 5 | 15 | 10 | zor | (10+40+60+30)×1,6 = 224 | **224** | $2,24 | 67 cr ($0,67) |
| 10 | 30 | 20 | zor | (10+80+120+60)×1,6 = 432 | **432** | $4,32 | 129 cr ($1,29) |

> Ekonomi belgesindeki "$0,50'lik tek üretim ≈ 50 credit" sezgisi bu formülün özel bir
> örneğidir; tablodaki değerler sayfa/soru/dakika ile değişir. Fiyat **sabit**tir:
> yerel GPU süresi credit'e yansımaz.

### 4.4 Onay ve üretim aşamaları

1. **Maliyeti hesapla** → önizleme: sayfa, soru, süre, zorluk, toplam credit, öğrenci ödemesi,
   hocaya giden pay. Bakiye yetmezse "Bakiye yetersiz" uyarısı ve **Credits yükle** düğmesi çıkar.
2. **Çözümü üret · N cr** → credit **hemen rezerve edilir** (deftere negatif `spend` yazılır),
   iş kuyruğa girer. Kuyruk **FIFO**, eşzamanlılık **1** (tek GPU).
3. Aşamalar canlı gösterilir:

| # | Aşama | v0.1'de ne olur |
|---|---|---|
| 1 | Sayfa alındı (`ingest`) | Görseller okunur, sayfa sayısı doğrulanır |
| 2 | Analiz (`analyze`) | Vision modeli ders/konu/soru/karmaşıklık JSON'u üretir |
| 3 | Ders planı (`plan`) | LLM, `styleVector` ile 3–8 sahne senaryosu üretir |
| 4 | Seslendirme (`voice`) | **Atlanır** — TTS yok (`pending-model`) |
| 5 | Video birleştirme (`compose`) | Slayt artefaktı üretilir; video birleştirme **atlanır** |
| 6 | Kütüphaneye teslim (`deliver`) | Kayıt kütüphaneye yazılır |

4. Sonuç: iş `partial` (kısmi) olur; **slayt + metin** teslim edilir. Ekranda
   *"Ses modeli kurulu değil… kısmi teslim"* uyarısı görünür.
5. Hata olursa iş `failed` olur ve **credit tam iade** edilir. Kısmi teslimde iade yoktur
   (çünkü analiz + plan + slayt üretilmiştir).

### 4.5 Kütüphane

- Üretilen her çözüm burada listelenir; **öğretmene veya konuya göre** filtre.
- Oynatıcı slaytları tek tek gösterir (önceki/sonraki); ses yoksa "kısmi üretim" rozeti.
- **Sil** → onay sorulur, kayıt ve artefakt dosyası silinir (iş ve defter kaydı korunur).
- Kütüphane öğrenciye özeldir; öğretmen yalnız kendi işlerinin çıktısını görür, admin tümünü görür.

---

## 5. Credits (cüzdan)

### 5.1 Paketler

| Paket | Fiyat | Credits | Birim fiyat | ≈ çözüm (36 cr ort.) |
|---|---|---|---|---|
| Başlangıç (`p10`) | $10 | 1.000 | **$0,0100** | ≈ 27 |
| Standart (`p30`) | $30 | 5.000 | **$0,0060** | ≈ 138 |
| Profesyonel (`p100`) | $100 | 17.000 | **$0,0059** (tam: $0,00588) | ≈ 472 |

Paket tanımları sabittir (`p10/p30/p100`); fiyat/credit oranı paket içinde hesaplanır, gizli ücret yok.

### 5.2 Satın alma — simülasyon

- **Satın al · simülasyon** → onay penceresi: *"Demo ödeme — gerçek tahsilat yok… kart bilgisi istenmez"*.
- Onaylanınca bakiye anında yüklenir; deftere `purchase` satırı ve
  *"Simülasyon: gerçek ödeme alınmadı."* notu yazılır.
- **Gerçek para tahsilatı v0.1 kapsamı dışıdır** (ödeme kuruluşu + mesafeli satış + vergi gerekir).

### 5.3 Defter türleri

| Tür (kod) | Ekranda | Yön | Ne zaman |
|---|---|---|---|
| `purchase` | satın alma | + | Paket simülasyonu |
| `spend` | harcama | − | İş oluşturulurken rezervasyon |
| `refund` | iade | + | İş başarısız/iptal/işaretli |
| `teacher_share` | öğretmen payı | + (öğretmene) | İş başarıyla settle olunca %30 |
| `welcome_bonus` | doğrulama ödülü | + (öğretmene) | Doğrulama başına bir kez 1.000 cr |

Defter **append-only**'dir; her satırdan sonra bakiye gösterilir. Değişmez kural:
`sum(ledger) == balance`, bakiye negatife düşemez, aynı iş için ikinci settle/refund **no-op**.

### 5.4 İade nasıl işler?

| Durum | İade | Öğretmen payı |
|---|---|---|
| İş `failed` (aşama hatası) | **Tam iade** | Pay yazılmadıysa yazılmaz; yazıldıysa geri alınır |
| İş `canceled` (kuyrukta iptal / uygulama kapandı) | **Tam iade** | Aynı |
| İş `partial` (kısmi teslim) | **İade yok** | Pay yazılır |
| İş `done` | İade yok | Pay yazılır |
| Kötü çıktı "işaretle" (`bi:job:flag`) | **Tam iade** + kütüphaneden silme | Geri alınır |

> v0.1 arayüzünde "iptal / işaretle / yeniden dene" düğmesi yoktur; bu üç işlem yalnız
> IPC kanalı olarak hazırdır (`bi:job:cancel`, `bi:job:flag`, `bi:job:retry`) — arayüzü
> v0.1 kapsamı dışıdır.

---

## 6. Yönetici rehberi

### 6.1 Onay kuyruğu — kontrol listesi

**Onay Kuyruğu** ekranı en eski başvuruyu üstte gösterir. Başvuru detayında "Kanıtlar" listesi
otomatik işaretlenir. Onaylamadan önce şu sırayla bak:

| # | Kontrol | Nerede görünür | Zorunlu mu? |
|---|---|---|---|
| 1 | **Yazılı rıza** (`consent.json`) | "Yazılı ses rızası kayıtlı · tarih" | **Evet** — yoksa onay `consent-required` ile durur |
| 2 | **Profil eğitimi %100** ve `styleVector` var | "eğitim %100", "Anlatım vektörü" çipleri | **Evet** — `not-trained` |
| 3 | **En az 2 ders videosu** | "N ders videosu" | UI uyarısı (sunucu onayda ayrıca saymaz) |
| 4 | Transkriptler mevcut | "transkriptler mevcut/eksik" | UI uyarısı |
| 5 | **En az 3 dk (180 sn) temiz ses örneği** | "X dk Y sn temiz ses örneği" | UI uyarısı |
| 6 | Ses profili | "Ses profili üretildi / bekleniyor" | Uyarı — v0.1'de TTS yok, beklenen |
| 7 | Biyografi / ders alanları | Başvuru başlığı | Öneri |
| 8 | Karar notu | Alt textarea | **Ret için zorunlu**; onayda isteğe bağlı |

**Not — süre ölçümü:** v0.1'de video süresi ölçülmez; yükleme `durSec=0` ile yapılır.
Bu yüzden 5. satır gerçek videoda bile "0 dk 0 sn" görünebilir. Bu bir **bilinen sınır**tır,
öğretmeni bu yüzden tek başına reddetmeyin; dosya boyutu ve transkript içeriğine bakın.

**Kararlar:**

- **Onayla ve $10 yaz** → durum `verified`, 1.000 cr hoş geldin (idempotent).
- **Reddet** → gerekçe yazılmadan kaydedilmez; durum `rejected`.

### 6.2 Ekonomi ekranı nasıl okunur?

| Alan | Anlamı | Kaynak |
|---|---|---|
| **Credit satışı** | `purchase` satırlarının sent toplamı | Defter |
| **Öğretmen payı** | `teacher_share` satırlarının sent toplamı (%30) | Defter |
| **Platform net** | `satış − öğretmen payı` | Defter |
| **Marj** | `net / satış` (yüzde) | Hesaplanır |
| **Döküm tablosu** | Satış, öğretmen payı, "Yerel AI maliyeti", net | Defter + sabit |
| **Son işler** | Kuyruk, aşama, credit, durum | İş kayıtları |

**Dürüst okuma notları:**

- **"Yerel AI maliyeti" v0.1'de 0'dır** (`aiCostCents: 0`). Yani "AI maliyeti düşülmüş" etiketi
  bugün için yanıltıcıdır; net = satış − pay. Gerçek elektrik maliyeti (`~$0,0024/üretim`)
  v0.1'de muhasebeye girmez.
- Satış rakamı **simüle** satın almalardan gelir; gerçek tahsilat yoktur.
- Aylık grafik defterdeki son 6 ayın satış/pay satırlarından üretilir; hareket yoksa boş durum.
- "1 çalışıyor" rozeti kuyruktaki `running` iş sayısıdır; eşzamanlılık 1'dir.

### 6.3 Yöneticinin diğer yetkileri

| Yetki | Nerede | Not |
|---|---|---|
| AI ayarlarını kaydetme | Ayarlar → Sağlayıcı yapılandırması | **Yalnız admin**; öğrenci/öğretmen kaydedemez (`forbidden`) |
| Tüm kütüphane kayıtları | Kütüphane | Admin tümünü görür/siler |
| Tüm işler | Ekonomi → Son işler | `admin:jobs` |

---

## 7. AI bağlantıları

Menü: **Ayarlar** (tüm roller görür; **kaydetme** yalnız admin).

### 7.1 Ollama kurulumu (önerilen yol)

1. Ollama'yı kur ve servisi başlat:
   ```powershell
   ollama serve
   ```
   Adres: `http://127.0.0.1:11434` (Ayarlar → Ollama adresi).
2. Modelleri çek:
   ```powershell
   ollama pull qwen3-vl:8b-instruct-q4_K_M   # vision (analiz)
   ollama pull qwen2.5:7b-instruct           # LLM (ders planı, tarz çıkarımı)
   ```
3. Uygulamada **Ayarlar → Sağlık testi** → Ollama satırında `N ms` ve "hazır" görünmeli.
4. Model seçimi aşama bazlıdır:
   - **LLM modeli · plan** → ders planı + `styleVector` çıkarımı
   - **Vision modeli · analiz** → sayfa görsel analizi
5. Değişiklik **yeni işlerde** geçerli olur (çalışan iş etkilenmez).

**Durum rozetleri:** `hazır` · `model gerekli` (`pending-model`) · `yok` (`missing`) · `kurulu değil`.

### 7.2 `modelFallback` ne demek?

Ayarlarda seçili model Ollama'da **kurulu değilse** uygulama sessizce düşmez; sırayla şu modele geçer:

```
1) qwen3-vl*  →  2) qwen*  →  3) kurulu ilk model
```

ve bunu **açıkça bildirir**:

| Yer | Mesaj |
|---|---|
| Aşama notu | `model değişti: <kullanılan> (ayarlı <istenen> kurulu değil)` |
| Ayarlar uyarısı | "Ayarlı model (X) kurulu değil; üretimde mevcut model kullanılacak: Y" |
| İş kaydı | `stage.modelFallback = true`, `usedModel`, `requestedModel` |

Amaç: bugün yalnız vision modeli kurulu olsa bile uygulamanın çalışması; ama **hangi modelin**
kullanıldığını gizlememek. Kaliteli plan için yine de `qwen2.5:7b-instruct` çekilmelidir.
Hiç model yoksa `no-model` hatası döner.

### 7.3 TTS / avatar / ffmpeg yok — ne olur?

| Yetenek | Konektör durumu | Üretimde sonuç |
|---|---|---|
| **STT (Whisper)** | `pending-model` | Transkript otomatik çıkmaz; elle yapıştırılır |
| **TTS (Piper/XTTS)** | `pending-model` | `voice` aşaması **skipped**; ses yok |
| **Avatar (Wav2Lip/SadTalker)** | `pending-model` | `compose` slayt-only; video/dudak senkronu yok |
| **ffmpeg** | `pending-model` (PATH'te yok) | Video birleştirme yok |
| **Slides** | `ready` (yerleşik) | Slayt + metin artefaktı **her zaman** üretilir |

Sonuç: iş **`partial`** olur ve öğrenciye *"Ses modeli kurulu değil… analiz, plan ve slayt metni
hazır"* kartı gösterilir. Bu bir hata değil, **dürüst kısmi teslim**dir.

### 7.4 Eksik araçlar nasıl kurulur (kısa)

| Araç | Kurulum (özet) | Kodda beklenen |
|---|---|---|
| **Piper (TTS)** | Piper ikilisi + Türkçe ses modeli; CPU'da hızlı | `piper` konektörü, `pending-model` |
| **XTTS (ses klonu)** | XTTS v2 ağırlıkları; **yazılı rıza zorunlu** | `xtts`, `requiresConsent: true` |
| **Whisper (STT)** | Python 3.12 + `faster-whisper` + model ağırlıkları | `whisper-local` |
| **Wav2Lip (avatar)** | Wav2Lip kodu + ağırlıkları; GPU önerilir | `wav2lip` |
| **SadTalker** | Ağırlıklar; bellek kullanımı yüksek | `sadtalker` |
| **ffmpeg** | `ffmpeg.exe` PATH'e eklenir | `ffmpeg` |

> Bu araçlar kurulduğunda **pipeline kodu değişmez**; ilgili aşama `skipped` yerine çalışır.
> Ancak v0.1'de bu konektörlerin **çalıştırma kodu iskelettir**; gerçek sentez v0.2/v0.3 işidir.
> Model kurmak tek başına ses üretmez — bkz. `docs/yol-haritasi.md`.

### 7.5 Bulut kullanımı

- Varsayılan: **kapalı** (`allowCloud:false`), tüm çağrılar `127.0.0.1`.
- Açmak için: **Bulut konektörüne izin ver** + uzak endpoint + API anahtarı (anahtar `safeStorage`
  ile şifrelenir, arayüze geri dönmez).
- Bulut kapalıyken uzak endpoint'e istek atılırsa `cloud-disabled` hatası döner.
- Renderer'da `fetch` yoktur; tüm ağ çağrıları ana proseste yapılır (CSP `connect-src 'none'`).
- Aylık bütçe alanı vardır (`cloudBudgetMonthlyCents`); v0.1'de kota kesintisi iş akışına
  bağlanmamıştır (v0.1 kapsamı dışı).

---

## 8. SSS

| Soru | Yanıt |
|---|---|
| **Veriler nerede?** | Bu makinede, Electron `userData` altında: `data\*.json` ve `media\`. Sunucuya gitmez. |
| **İnternet gerekir mi?** | **Hayır.** Kurulum ve AI yereldir. Yalnız model indirmek (`ollama pull`) internet ister. Bulut opsiyoneldir. |
| **Öğretmen sesi klonlanıyor mu?** | **v0.1: hayır.** TTS/XTTS modeli yok; `voiceProfile` hiç oluşturulmaz. Yine de rıza kaydı doğrulama için zorunludur. |
| **Öğrenci verisi dışarı çıkar mı?** | Varsayılan **hayır**. Sayfa görselleri `media\students` altında kalır; loglarda metin içeriği yazılmaz. Bulut yalnız admin açarsa ve anahtar girilirse. |
| **Çözüm neden sessiz?** | TTS yok. `voice` aşaması `pending-model` olarak atlanır; çıktı slayt + metindir. |
| **İade nasıl işler?** | Başarısız/iptal iş **tam iade**; kısmi teslimde iade yok; öğretmen payı iade edilirse geri alınır (§5.4). |
| **Aynı iş için iki kez ödeme olur mu?** | Hayır. Rezervasyon, settle ve refund aynı `jobId` için idempotenttir. |
| **Birden fazla kullanıcı aynı anda?** | Tek makine, tek GPU; kuyruk FIFO ve eşzamanlılık 1. Çoklu cihaz/sunucu yok. |
| **Veriyi yedekleyebilir miyim?** | `userData` klasörünü kopyalayın (uygulama kapalıyken). Otomatik yedekleme yoktur. |
| **Parolamı unuttum?** | v0.1'de parola sıfırlama akışı yok; yerel veriyi yönetici müdahalesiyle sıfırlamak gerekir (v0.1 kapsamı dışı). |
| **Öğretmenin gerçek yüzü videoda mı?** | Hayır. Avatar/lip-sync yok; çıktı slayttır. |

---

## 9. Sorun giderme

### 9.1 Önce `doctor` çalıştır

```powershell
node tools\doctor.js
```

Çıktı biçimi: `[OK]`, `[UYARI]`, `[HATA]`; son satır `SONUÇ: GEÇTİ` / `GEÇTİ (uyarılarla)` /
`BAŞARISIZ`. Çıkış kodu: hata varsa **1**, yoksa **0**.

| Bölüm | Neyi kontrol eder |
|---|---|
| Node | Sürüm ≥ 18 |
| Electron | `src\node_modules\electron` ve sürüm 45.2.1, `electron.exe` |
| Kaynak dosyaları | `main.js`, `preload.js`, `index.html` var ve boş değil |
| Paket durumu | `package.json` ad/sürüm/main, `node_modules` |
| Ollama | `/api/tags` yanıtı, model listesi, `qwen3-vl`, LLM adayı |
| Yardımcı araçlar | `ffmpeg`, `python` (yoksa **uyarı**, hata değil) |

`[HATA]` yoksa uygulama açılır; eksik AI araçları yalnız ilgili aşamayı kısmi bırakır.

### 9.2 Sık hata kodları

| Kod | Anlamı | Çözüm |
|---|---|---|
| `not-running` | Ollama/servise ulaşılamadı | `ollama serve` çalışıyor mu? Ayarlar → adres `http://127.0.0.1:11434`; güvenlik duvarı |
| `timeout` | 120 sn içinde yanıt yok | Büyük model/sayfa; tekrar dene; daha küçük model |
| `no-model` | İstenen model kurulu değil / hiç model yok | `ollama pull <model>`; Ayarlar → LLM/Vision seç; Sağlık testi |
| `pending-model` | Aşama modeli yok (TTS/avatar/ffmpeg/STT) | **Normal**; kısmi teslim. Model kurulumu v0.2/v0.3 |
| `forbidden` | Yetki yok | Doğru hesapla giriş; admin işlemi öğrenciyle yapılıyorsa admin hesabı; başka kullanıcının işine erişim |
| `unauthorized` | Oturum yok | Yeniden giriş |
| `insufficient-credits` | Bakiye yetmiyor | Credits → paket satın al (simülasyon) |
| `no-llm` | LLM konektörü bağlı değil | Ayarlar → AI Bağlantıları → model seç |
| `no-vision` | Vision konektörü yok | Ollama + `qwen3-vl` kur |
| `bad-json` | Model geçerli JSON üretmedi | Tekrar dene; daha yetenekli model; sayfayı netleştir |
| `no-transcript` | Eğitim için transkript yok | Stüdyo → Transkript ekle |
| `not-trained` | `styleVector` yok | Önce eğitimi çalıştır (`%100`) |
| `consent-required` | Yazılı rıza yok | Stüdyo → rıza kutusu; admin onayı bundan önce geçmez |
| `bad-file-type` | Desteklenmeyen görsel/biçim | Sayfa: PNG/JPG/WebP. **PDF'yi dönüştür.** Video: §3.2 listesi |
| `too-many-pages` | 10'dan fazla sayfa | Sayfaları böl, ayrı iş oluştur |
| `file-too-large` | 50 MB üstü | Küçült / sıkıştır |
| `teacher-not-verified` | Seçilen öğretmen doğrulanmamış | Yalnız `verified` hocalar seçilebilir; admin onayı gerekir |
| `cloud-disabled` | Bulut kapalı | Ayarlar → bulut izni + anahtar; ya da yerel model kullan |
| `confirm-required` | Yazma onayı yok | Arayüz bunu otomatik ekler; doğrudan IPC çağrısında `{confirm:true}` gerekir |
| `email-taken` / `admin-exists` / `weak-password` | Kayıt kuralı | Farklı e-posta; admin yalnız ilk hesap; parola ≥ 8 + harf + rakam |

### 9.3 Tipik durumlar

| Belirti | Olası neden | Yapılacak |
|---|---|---|
| Uygulama açılıyor ama analiz hiç başlamıyor | Ollama kapalı / vision modeli yok | `doctor`; `ollama serve`; `ollama pull qwen3-vl:8b-instruct-q4_K_M` |
| Plan aşaması hata veriyor | LLM modeli yok | `ollama pull qwen2.5:7b-instruct`; Ayarlar → LLM |
| Ses hiç gelmiyor | TTS yok | Beklenen; kısmi teslim. v0.2 |
| Öğretmeni listede göremiyorum | Profil `verified` değil | Admin onayı bekliyor |
| Onay düğmesi çalışmıyor | Rıza veya `styleVector` eksik | Stüdyo → rıza + eğitim %100 |
| İncelemeye gönder kapalı | İlerleme %100 değil veya rıza yok | Stüdyo uyarı metnini oku |
| Bakiye 0, üretim başlamıyor | Satın alma yapılmadı | Credits → simülasyon satın alma |
| Uygulama kapandı, iş yarıda kaldı | Kapanışta kuyruk durur | Açılışta iş `failed` + **iade** olur; yeniden üret |

---

## 10. Kanıt dizini

Bu kılavuzdaki bölümlerin kod karşılıkları:

| Bölüm | Doğrulandığı yer |
|---|---|
| 1.2 Çalıştırma / derleme | `README.md:23-30,54-61`, `tools/build.ps1:24-125`, `src/package.json:8-13` |
| 1.3 İlk açılış, tek örnek, pencere | `src/main/main.js:33-34,52-62`, `src/renderer/screens/auth.js:84-104` |
| 1.4 Veri yolları | `src/main/services/store.js:6,69-88,405-420`, `src/main/main.js:520` |
| 2 Kayıt/giriş, ilk admin, parola | `src/main/services/accounts.js:17-21,43-51,127-187` |
| 2.1 Ad türetme | `src/renderer/screens/auth.js:137` |
| 2.2 Demo rol seçici | `src/renderer/index.html:157-165`; yetki: `src/main/main.js:73-99` |
| 3.2 Video türleri / 50 MB | `src/main/services/teachers.js:26,176-208`; `store.js:42`; `settings.js:341-347` |
| 3.3 Transkript | `src/renderer/screens/studio.js:107-158`, `teachers.js:310-318` |
| 3.4 Rıza | `teachers.js:28-36,469-489,499-512,577`, `studio.js:394-415` |
| 3.5 Eğitim / `styleVector` | `teachers.js:291-308,310-388`; `pipeline.js:228-237`; `ai-mimari.md:59-77` |
| 3.6 "Kaynaklar hazır" / hoş geldin | `studio.js:82-84,256-257`; `teachers.js:390-406,566-594`; `credits.js:22,269-289` |
| 3.7 Kazanç / çekim yok | `teachers.js:410-454`; `index.html:996-1015` |
| 4.1 Sayfa yükleme / PDF yok | `students.js:80-93,116-179`; `workspace.js:171-205`; `settings.js:341-347` |
| 4.2 Hoca listesi | `teachers.js:514-531`; `workspace.js:650-657` |
| 4.3 Maliyet formülü | `src/shared/credits-model.js:10-32,71-87`; `jobs.js:46-64`; `workspace.js:553-560` |
| 4.4 Aşamalar / kısmi teslim | `pipeline.js:23,94-350`; `jobs.js:104-109,238-260`; `workspace.js:20-36,416-520` |
| 4.5 Kütüphane | `library.js:22-83`; `library.js` (ekran) `60-98,162-309` |
| 5.1 Paketler | `shared-bridge.js:136-140`; `ekonomi.md:6-14` |
| 5.2 Satın alma simülasyonu | `credits.js:79-105`; ekran `credits.js:207-230` |
| 5.3 Defter türleri | `credits.js:21-23,29-44`; ekran `credits.js:17-23` |
| 5.4 İade | `credits.js:107-267`; `jobs.js:262-412` |
| 6.1 Onay kriterleri | `teachers.js:533-613`; `approval.js:202-227,229-280` |
| 6.2 Ekonomi | `main.js:286-330`; `economy.js:57-155` |
| 6.3 Admin yetkileri | `main.js:455-512` |
| 7.1 Ollama | `ai/ollama.js:12-89`; `settings.js` (ekran) `224-249`; `doctor.js:204-223` |
| 7.2 `modelFallback` | `ollama.js:91-101,124-137,189-198`; `pipeline.js:75-81` |
| 7.3/7.4 Eksik modeller | `ai/tts.js:11-49`, `ai/avatar.js:16-38`, `ai/stt.js:16-42`, `ai/registry.js:20-43`; `shared/ai-registry.js:42-105` |
| 7.5 Bulut kapısı | `ai/openai-compat.js:40-53`; `main.js:508-511`; `index.html:6`; `main.js:119-141` |
| 9.1 Doctor | `tools/doctor.js:140-250` |
| 9.2 Hata kodları | `ollama.js:25-42,114-201`; `pipeline.js:171-226`; `credits.js:107-141`; `jobs.js:116-136,352-431`; `library.js:476-490` |

> Bu tablo **iddia → kanıt** eşlemesidir. Kodda karşılığı olmayan hiçbir davranış bu kılavuzda
> "var" diye yazılmadı; eksikler açıkça "v0.1 kapsamı dışı" veya "model gerekli" olarak işaretlendi.
