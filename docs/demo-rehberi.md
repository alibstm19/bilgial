# BilgiAl — Demo Rehberi

Bu rehber, depoyu ilk kez gören biri için **15 dakikalık** bir tur. Amacı tüm özellikleri
listelemek değil, ürünün ne yaptığını **kendi gözünle** görmek.

> Paket: [Releases](https://github.com/alibstm19/bilgial/releases) → `BilgiAl-0.2.0-deneme.zip`
> Hesaplar: `ogrenci@bilgial.local` · `ogretmen@bilgial.local` · `admin@bilgial.local` — parola `BilgiAl2026`

---

## 0. Hazırlık (3 dakika)

```powershell
# Ollama çalışıyor mu?
ollama list
# Beklenen: qwen3:14b (metin) ve minicpm-v:8b (görsel) kurulu olmalı
```

Yoksa:

```powershell
ollama pull qwen3:14b
ollama pull minicpm-v:8b
```

Ses için (isteğe bağlı, yoksa sessiz slayt üretilir):

```powershell
python -m pip install piper-tts
```

## 1. Açılış (1 dakika)

ZIP'i çıkar, `Baslat-Deneme.cmd` dosyasına çift tıkla. Uygulama deneme verisiyle açılır:
hazır bir öğretmen profili, bir sınıf, ödevler ve örnek ders videosu gelir.

**Bak:** yan menüde 13 ekran; üst çubukta oturum bilgisi. Hiçbir yerde "bulut" zorunluluğu yok.

## 2. Çözüm üret (5 dakika) — ürünün kalbi

1. **Öğrenci** hesabıyla gir.
2. **Çöz** sekmesinde net bir soru sayfası fotoğrafı yükle.
3. Öğretmeni seç, fiyatı gör, **Çözümü üret**.
4. Aşamalar canlı ilerler: `oku → anla → planla → seslendir → birleştir → teslim`.
5. Bitince **Kitaplık**'a git; ders videosu oynar.

**Dikkat et:** her aşamanın gerçek süresi görünür; atlanan aşama varsa dürüstçe `pending-model`
yazar — sahte bir "tamam" yok.

## 3. Video stüdyosu (2 dakika)

Stüdyoda aynı içeriği farklı biçimlerde üret:

- **6 tema** (gece, güneş, orman, kağıt, mor, okyanus)
- **16:9 / 9:16 / 1:1** oran — telefonda dikey, Instagram'da kare
- giriş / kapanış kartı, **SRT + VTT altyazı**, kapak görseli, resim-içinde-resim
- oynatıcıda oran geçişinde konum ve hız korunur

## 4. Sınıf ve ödev (2 dakika)

1. **Öğretmen** hesabına geç, **Sınıflar** ekranını aç.
2. Sınıf oluştur → 6 karakterlik **katılım kodu** çıkar.
3. Ödev ver: başlık, not, teslim tarihi.
4. **Öğrenci** hesabına geç, **Ödevlerim** ekranında kodu gir ve katıl.
5. Ödevi **Tamamla** → öğretmen tarafında tamamlanma yüzdesi yükselir.

Sonra öğretmen tarafında şunları dene:

| Ne | Nerede | Ne görmelisin |
|---|---|---|
| İçgörüler | Sınıflar → içgörü kartı | Haftalık ritim çubukları, zamanında teslim %, riskli öğrenci |
| CSV | İçgörü kartı → **CSV indir** | `<sınıf>.csv` iner; formül enjeksiyonuna karşı korumalı |
| Dönüt | Üye satırı → **Dönüt** | Öğrenci dönütü Ödevlerim'de görür |
| Hatırlat | **Hatırlat** | Gecikmiş ödevler için kopyalanabilir metin |
| Özet | **Özet metni** | Son 7 günün metni; e-posta ve katılım kodu **yok** |
| Arama | Üye arama | `"den"` → Türkçe harf duyarsız eşleşme; eşleşmezse dürüst boş durum |
| Yaklaşan | Ödevlerim kartı | 48 saat içindeki ödevler + kalan süre rozeti |
| Arşiv | Ödev satırı → **Arşivle** | Listeden kalkar; **Geri al** ile döner |
| Filtre | Ödev tablosu üstü | Arama + durum süzgeci + sıralama (`n / m` sayacı) |

## 5. Telefon (2 dakika)

1. Masaüstünde **Telefon köprüsü** kartını aç, QR'ı göster.
2. Telefonda QR'ı okut (aynı Wi-Fi) → `http://<PC-IP>:4780/?pair=...`
3. **Ana ekrana ekle** ile PWA olarak kur.
4. Öğrenci olarak **Ödevlerim**: günlük hedef, ödev listesi, dönüt, **Tamamla**.
5. Wi-Fi'yi kapat: kabuk yine açılır (çevrimdışı), PC dönünce veriler gelir.

## 6. Yerel AI ve dürüstlük (1 dakika)

- **AI** ekranı: 9 konektörün gerçek durumu; tek indirme düğmesi yalnız **rıza gerektirmeyen**
  bileşenleri kurar.
- **Model danışmanı**: sığma / kalite / hız karşılaştırması, gerçek ölçüm.
- **Krediler**: satın alma **simülasyon**; kayıt `paymentMode: "simulated"` yazar.
- Ses klonlama (XTTS) ve avatar: **yazılı rıza** olmadan açılmaz.

---

## Neyi ölçtük?

| Kapı | Komut | Sonuç |
|---|---|---|
| Testler | `node tools/test.js` | 300 / 300 |
| Stil | `node tools/lint.js` | 0 hata, 0 uyarı |
| Ortam | `node tools/doctor.js` | 0 hata, 0 uyarı |
| Uçtan uca | `tools/package.ps1` | paket + deneme verisi + ses modeli |

Her özellik gerçek Electron penceresinde (CDP) ve gerçek telefon köprüsüyle ölçülür; kabul eşiği
**taşma 0** ve **konsol hatası 0**'dır.

## Geri bildirim

- Hata: [bug](https://github.com/alibstm19/bilgial/issues/new?template=bug_report.yml)
- Fikir: [idea](https://github.com/alibstm19/bilgial/issues/new?template=feature_request.yml)
- Kurulum: [setup](https://github.com/alibstm19/bilgial/issues/new?template=setup.yml)

En çok şunu merak ediyoruz: **öğretmenin işini gerçekten kısaltıyor mu?**
