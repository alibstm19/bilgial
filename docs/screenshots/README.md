# Ekran görüntüleri

Bu klasördeki görüntüler gerçek uygulamadan alınmıştır (Electron + CDP ve headless Edge telefon
köprüsü), çizim veya mockup değildir. Her dosya ilgili özelliğin saha ölçümüyle birlikte
üretilmiştir; ayrıntı `docs/deneme-surumu.md` ve depo panosundadır.

| Dosya | Ekran | Ne gösterir |
|---|---|---|
| `01-siniflar-ve-odevler.png` | Sınıflar | Sınıf oluşturma, katılım kodu, ödev verme, üye ilerlemesi |
| `02-sinif-icgoruleri.png` | Sınıflar | Haftalık ritim, zamanında teslim, riskli öğrenci, CSV |
| `03-video-studyosu.png` | Video stüdyosu | Tema, oran, altyazı, kapak, PiP ayarları |
| `04-telefon-odevlerim.png` | Telefon · Ödevlerim | Günlük hedef, ödev listesi, dönüt, Tamamla |
| `05-yaklasan-teslimler.png` | Ödevlerim | 48 saat içindeki ödevler ve kalan süre rozetleri |
| `06-haftalik-ozet.png` | Sınıflar | Kopyalanabilir haftalık özet metni |
| `07-telefon-arama.png` | Telefon · Ödevlerim | Arama ve durum süzgeci |
| `08-ai-kurulum.png` | AI | Konektör durumları, tek indirme düğmesi |
| `09-kitaplik-oynatici.png` | Kitaplık | Ders videosu, altyazı izi, oran geçişi |
| `10-odev-arama-siralama.png` | Sınıflar | Ödev arama, durum süzgeci, sıralama |

## Kendi ölçümünü almak

Görüntüleri yeniden üretmek için depo kökünde:

```powershell
powershell -ExecutionPolicy Bypass -File tools/trial.ps1 -Port 9791
```

Ardından ilgili `work/d0xx-*.js` betiği CDP üzerinden bağlanıp ekranı kaydeder. (Bu betikler
geliştirme aracıdır; herkese açık depoda yalnız uygulama kaynağı ve testler bulunur.)
