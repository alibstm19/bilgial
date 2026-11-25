# BilgiAl — kurulum ve test rehberi (deneme sürümü)

Bu rehber, `BilgiAl-0.2.0-deneme.zip` paketini alan kişinin uygulamayı **kurmasını**,
**denemesini** ve **kendi testini yapmasını** anlatır. Kurulum yönetici hakkı istemez;
uygulama klasörden çalışır.

---

## 1. Paketi al

| Ne | Yer |
|---|---|
| Paket | `BilgiAl-0.2.0-deneme.zip` (211.8 MB) |
| İçerik | `BilgiAl/BilgiAl.exe` (238 MB) + Electron dosyaları |
| Deneme verisi | `BilgiAl/deneme/` (hazır hesaplar, 2 çözüm, 1 soru fotoğrafı, ses modeli) |
| Kılavuz | `BilgiAl/OKU-BENI.txt` |
| Başlatıcı | `BilgiAl/Baslat-Deneme.cmd` |

## 2. Kur

1. ZIP'i sağ tık → **Tümünü ayıkla**. Klasörü kalıcı bir yere çıkar
   (ör. `C:\BilgiAl`). **ZIP içinden çalıştırma**; Electron güncelleme/önbellek yazamaz.
2. `C:\BilgiAl\BilgiAl\Baslat-Deneme.cmd` dosyasına **çift tıkla**.
3. Windows "Bilinmeyen yayıncı" derse: **Daha fazla bilgi → Yine de çalıştır**.
   Kod imzası yoktur (deneme sürümü), uygulama internete veri göndermez.
4. Giriş ekranı gelir. Deneme hesapları:

   | Rol | E-posta | Parola |
   |---|---|---|
   | Öğrenci | `ogrenci@bilgial.local` | `BilgiAl2026` |
   | Öğretmen | `ogretmen@bilgial.local` | `BilgiAl2026` |
   | Yönetici | `admin@bilgial.local` | `BilgiAl2026` |

> `Baslat-Deneme.cmd` uygulamayı `--user-data-dir=...\deneme` ile açar; böylece hazır veri
> kullanılır ve **ana verine dokunulmaz**. `BilgiAl.exe`'ye doğrudan çift tıklarsan kendi
> boş profilinde açılır (yeni kurulum gibi).

## 3. Ön koşullar (deneme makinesinde)

| Gerekli | Neden | Kontrol |
|---|---|---|
| Ollama çalışıyor | metin + görsel model | `http://127.0.0.1:11434` açılıyor mu |
| `qwen3:14b` | çözüm planı, anlatım | `ollama list` |
| `minicpm-v:8b` | soru fotoğrafını okuma | `ollama list` |
| Python `piper-tts` | Türkçe seslendirme | `python -m pip install piper-tts` |
| `tr_TR-dfki-medium` sesi | seslendirme modeli | pakette `deneme\models\piper\` içinde gelir |
| ffmpeg | video birleştirme | `ffmpeg -version` |

Eksik olan ses modeli **hata değildir**: iş `partial` biter, video yerine slayt çıkar.
Uygulama içinde **Ayarlar → AI Bağlantıları → Tanı** ekranı hangi bileşenin eksik olduğunu
söyler; `node tools/doctor.js` aynı listeyi konsolda verir.

## 4. 5 dakikalık deneme akışı

1. **Öğrenci** hesabıyla gir.
2. **Çöz** sekmesi → gerçek bir soru fotoğrafı yükle (net, düz çekim; ekran görüntüsü değil).
3. Öğretmen seç → fiyat görünür (kredi) → **Çözümü üret**.
4. Aşamalar canlı akar: `oku → anla → planla → seslendir → birleştir → teslim`.
5. **Bitti** rozetine bas: ders videosu uygulama içinde oynar, tam ekran bağlantısı vardır.
6. **Kitaplık** sekmesinde kayıt kalır; filtre/arama ile bulunur, tekrar izlenir.

Denemenin ilk açılışta hazır getirdiği içerik: 2 tamamlanmış çözüm (video + sahneler),
1 soru fotoğrafı, 5000 simüle kredi, doğrulanmış öğretmen.

## 5. Telefondan test (aynı Wi-Fi)

1. Masaüstünde **Telefon köprüsü** kartını aç (yönetici hesabı gerekir) → QR görünür.
2. Telefonla QR'ı okut ya da adresi yaz: `http://<PC-IP>:4780/?pair=<6 hane>`.
   QR kodu **tek kullanımlıktır**, 30 dakika geçerlidir; süresi geçerse yeniden üret.
3. Telefonda öğrenci hesabıyla gir; **Çöz** ve **Kitaplık** sekmeleri çalışır.
4. **Ana ekrana ekle** kartı ile uygulama gibi kurulur; Wi-Fi kopsa arayüz yine açılır
   (kabuk cihazda saklanır, canlı veri PC dönünce gelir).
5. Telefonda video oynatma: aynı kökenden `/api/media` **Range/206** ile akar.

## 6. Kendi testini yap — kabul listesi

Aşağıdakileri sırayla dene; her satır bir kabul kriteridir.

| # | Adım | Beklenen |
|---|---|---|
| 1 | Uygulamayı aç | giriş ekranı, "PC" kartı VRAM/GPU gösterir |
| 2 | Öğrenci girişi | Ana ekran, kredi bakiyesi 5000 |
| 3 | Kitaplık | 2 kayıt, birine bas → video oynar |
| 4 | Çöz: fotoğraf yükle | küçük önizleme, sayfa sayısı doğru |
| 5 | Fiyat al | kredi ve "yeterli" bilgisi |
| 6 | Çözümü üret | 6 aşama canlı, sonunda **Bitti** |
| 7 | Sonuç | video oynar, süre/sahne sayısı görünür |
| 8 | Kitaplık | yeni kayıt en üstte, silinebilir |
| 9 | Telefon eşleşme | QR okut → aynı hesapla giriş |
| 10 | Telefonda video | oynar, tam ekran, takılmaz |
| 11 | Wi-Fi kapat | arayüz açılır, "PC'ye ulaşılamıyor" uyarısı |
| 12 | Wi-Fi aç | bağlantı geri gelir, veriler tazelenir |
| 13 | Kapat/aç | oturum ve kitaplık korunur |
| 14 | Ayarlar → **AI bağlantıları** (yönetici) | 9 satır; her satırda kısa kurulum ipucu; XTTS/Wav2Lip/SadTalker **rıza gerekli**; ffmpeg gerçekten **hazır** |
| 15 | **Gerekli olanları indir** düğmesi | eksik varsa tek tıkla indirir ve `%N` ilerleme gösterir; eksik yoksa **Gerekli her şey kurulu ✓** |
| 16 | Öğretmen → **Sınıflar** → sınıf aç | sınıf listelenir, 6 karakterlik katılım kodu görünür ve **Kopyala** çalışır |
| 17 | **Ödev ver** | seçili sınıfa ödev yayınlanır; ödev tablosunda tamamlanma `0/1 · %0` görünür |
| 18 | Öğrenci → **Ödevlerim** → kodla katıl | sınıf çipinin içinde görünür; ödev listede, yaklaşan ödev kartında çıkar |
| 19 | Ödevi **Tamamla** | durum `tamamlandı`, Tamamlanan `1`, ilerleme `%100`, seri `1 gün` |
| 20 | Öğretmen → Sınıflar → **Sınıf içgörüleri** | haftalık tamamlanma, zamanında teslim `%…`, riskli öğrenci sayısı ve **7 günlük çubuklar** görünür |
| 21 | **CSV indir** | `…csv` dosyası iner; bildirim `<dosya>.csv · N öğrenci` yazar, dosyada her öğrenci bir satırdır |
| 22 | Öğrenci → Ödevlerim → **Bugünün hedefi** | hedef `0/1 ödev · 1 kaldı` gibi otomatik hesaplanır; ödev tamamlanınca yüzde yükselir |
| 23 | Öğretmen → Sınıflar → **Dönüt** | üye satırına **Dönüt** bas → ödev + metin + **Kaydet**; `bi:class:feedback` (yazma, `confirm`) dönüme yazar |
| 24 | Öğretmen → Sınıflar → **Hatırlat** | **Hatırlat** bas → gecikmiş hücre listesi → **Tümünü kopyala**; grubuna yapıştırma metni hazır |
| 25 | Telefon → **Ödevlerim** sekmesi | günlük hedef, bekleyen/tamamlanan/seri sayıları ve ödev listesi görünür; satırda dönüt varsa okunur; **Tamamla** → masaüstünde de `tamamlandı` |
| 26 | Öğretmen → Sınıflar → **Özet metni** | son 7 günün özeti metin olarak açılır; **Kopyala** → panoya gider; metinde e-posta ve katılım kodu yok |
| 27 | Telefon → **Ödevlerim** → **Haftalık özetim** | öğrencinin kendi özeti görünür (`Öğrenci: …`); **Kopyala** → “Özet metni kopyalandı.” |
| 28 | Öğretmen → Sınıflar → **Öğrenci ara** + üye satırında **Özet** | arama Türkçe harf duyarsız süzer; eşleşmeyen sorguda “ile eşleşen öğrenci yok.” yazar (sahte satır yok); **Özet** tek öğrenci özetini açar |
| 29 | Öğrenci → **Ödevlerim** (48 saat içinde ödev varken) | **Yaklaşan teslimler** kartı görünür, sayaç satır sayısıyla aynı (`Bugün 18:00` / `Yarın 09:00` / `Son 1 saat`); telefonda aynı kart + ödev satırında kalan süre rozeti; ilk açılışta tek yerel bildirim çıkar |
| 30 | Öğretmen → Sınıflar → ödev satırında **Arşivle** → **Geri al** | ödev tablodan çıkar, **Arşiv** kartı açılır (`Arşiv: gg Ay yyyy · n/m tamamlandı`), sayaç `1`; öğrencinin ödev listesinden ve yaklaşanlardan düşer; **Geri al** → ödev tabloya döner, kart kapanır |
| 31 | Öğretmen → Sınıflar → ödev tablosunda **Ödev ara** / durum / sıralama | arama Türkçe harf duyarsız süzer (`vektor` → `Vektörler`); eşleşmeyen aramada "Eşleşen ödev yok" yazar; süzgeç notu `n / m ödev gösteriliyor`; sıralamada teslim tarihi olmayanlar sonda |
| 32 | Telefon → **Ödevlerim** → **Ödev ara** + durum süzgeci | arama Türkçe harf duyarsız süzer (`gecikmis` → `Gecikmiş`), sınıf adıyla da eşleşir; durum süzgeci (`Atanmış/İzleniyor/Gecikmiş/Tamamlandı`) yalnız o durumu bırakır; not `n / m ödev gösteriliyor · durum: ...`; eşleşme yoksa "“sorgu” ile eşleşen ödev yok." yazar (sahte satır yok) |
| 33 | Öğrenci → **Çözümle** → **4 · Video stüdyosu** | tema (6), oranlar (16:9 / 9:16 / 1:1, en az biri), giriş/kapanış 0–12 sn, altyazı/kapak/soru görseli anahtarları; özet `Seçili: ...` ve süre tahmini anında güncellenir; üretimden sonra Kitaplıkta kapak, oynatıcıda altyazı izi ve oran düğmeleri görünür, oran değişince video başka dosyaya geçer |

Hata görürsen: ekran görüntüsü + saat + hangi adım olduğunu not et. Konsol kaydı için
uygulamayı `BilgiAl.exe --remote-debugging-port=9783` ile açıp `http://127.0.0.1:9783`
adresinden DevTools açılabilir.

## 7. Geliştirici doğrulaması (tek komut)

Depo içinde, tüm zinciri ölçen komut:

```powershell
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -SkipBuild   # dist hazır
powershell -ExecutionPolicy Bypass -File tools/trial-check.ps1 -Quick       # yalnız kapılar
```

24 adım ölçülür: `testler → lint → doctor → paket → tohum → açılış → üretim → telefon →
kurulum → rehber → sinif → rapor → donut → digest → baglantilar → indirme → saha → ozet → arama → yaklasan → arsiv → filtre → mobilfiltre → video`;
tek karar yazar (`GECTI`/`KALDI`). Ayrıntı: `docs/deneme-surumu.md`.

## 8. Geri alma / sıfırlama

- Deneme verisini sıfırla: `BilgiAl\deneme\` klasörünü sil, ZIP'ten aynı klasörü geri çıkar.
- Uygulamayı kaldır: klasörü sil (kayıt defterine, servise, sürücüye bir şey yazmaz).
- Kullanıcı verisi: `%APPDATA%` altına yazmaz; her şey seçtiğin `--user-data-dir` içinde.

## 9. Bilinen sınırlar (deneme)

- Gerçek ödeme yok: kredi satın alma simülasyondur (`paymentMode:'simulated'`).
- Bulut kapalı (`allowCloud:false`); her şey yerelde çalışır.
- Ses klonlama (XTTS) ve avatar/lip-sync yazılı rıza (`consent.json`) olmadan açılmaz.
- 70B "heavy" kademe 32 GB RAM'de yavaştır; deneme için önerilmez.
