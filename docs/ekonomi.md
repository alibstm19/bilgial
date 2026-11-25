# BilgiAl — Credits Ekonomisi (v1, hesaplanmış)

Sahip: LDR · 2026-11-04 · Bağlayıcı. Bu belgedeki tüm sayılar `src/shared/credits-model.js` içinde
koda dökülür ve testle doğrulanır. Kullanıcının verdiği paketler ve %30 pay aynen korunur.

## 1. Birim: 1 credit = 0,01 $

Kullanıcının paketleri kendi içinde tutarlıysa credit fiyatı şudur:

| Paket | Fiyat | Credits | Birim fiyat |
|---|---|---|---|
| Başlangıç | $10 | 1.000 | **$0,0100** |
| Standart | $30 | 5.000 | **$0,0060** |
| Profesyonel | $100 | 17.000 | **$0,0059** |

> **Düzeltme notu (dürüstlük):** Kullanıcı "1 credit $0,50 oldu, $0,15'i hocaya gider" dedi.
> Paket tablosuyla bu 50 kat çelişiyor (1.000 credit $10 ise credit 1 senttir). Çelişki şöyle
> çözüldü: **credit = 1 sent**; "$0,50'lik tek üretim" = **50 credit**. Böylece kullanıcının
> sezgisi ("bir ders ~$0,50, hocaya $0,15") aynen korunur ve paketler bozulmaz.

## 2. Öğretmen payı

Harcanan her creditin **%30'u** o anlatımı yapan öğretmene yazılır (satış anında değil, **tüketim
anında** — böylece kullanılmayan credit kimseye gelir yazmaz).

| Paket | Credit fiyatı | Öğretmen %30 | Platform brüt |
|---|---|---|---|
| Başlangıç | $0,0100 | $0,0030 | $0,0070 |
| Standart | $0,0060 | $0,0018 | $0,0042 |
| Profesyonel | $0,0059 | $0,0018 | $0,0041 |

## 3. Bir üretimin credit maliyeti

```
credits = ceil( BASE + PAGES*8 + QUESTIONS*4 + MINUTES*3 ) * complexity
BASE = 10
complexity: kolay 1.0 · orta 1.3 · zor 1.6
```

| Örnek | Hesap | Credits | Öğrenci öder | Öğretmen | Platform |
|---|---|---|---|---|---|
| 1 sayfa, 3 soru, 2 dk, kolay | 10+8+12+6 = 36 | 36 | $0,36 | $0,108 | $0,252 |
| 2 sayfa, 5 soru, 3 dk, orta | (10+16+20+9)×1,3 = 72 | 72 | $0,72 | $0,216 | $0,504 |
| 4 sayfa, 10 soru, 6 dk, zor | (10+32+40+18)×1,6 = 160 | 160 | $1,60 | $0,48 | $1,12 |

Kıyas: aynı soru için özel ders saati Türkiye'de ~$15–30. **Bir sayfa çözümü ~$0,40** — özel dersin
%3'ü. Fiyatlandırma bu yüzden savunulabilir.

## 4. Neden yerel AI şart (iş modelinin kalbi)

Marj, AI maliyeti düşüldükten sonra kalır. Tek üretim için gerçek maliyetler:

| Kalem | Yerel (RTX 4070 Ti SUPER) | Bulut API (tipik) |
|---|---|---|
| Görsel analiz (2 sayfa) | ~0 (GPU amortismanı) | $0,004–0,02 |
| Metin planı (LLM) | ~0 | $0,01–0,05 |
| TTS (3 dk) | ~0 | $0,15–0,90 |
| Video birleştirme | ~0 | $0,02–0,10 |
| **Toplam / üretim** | **≈ $0,002 (yalnız elektrik)** | **≈ $0,20–1,00** |

70 credit'lik bir üretimde platform brüt $0,49. **Bulut TTS ile marj sıfırlanır veya negatife döner;**
yerelde marj ~%99'dur. Yani "local AI" bir tercih değil, **iş modelinin ön koşuludur** (brief §6).

Elektrik kalemi: 300 W × 0,1 saat = 0,03 kWh; ~$0,08/kWh → **$0,0024**.

## 5. Öğretmen kazancı (gerçekçi senaryo)

Ayda 400 öğrenci × 60 credit = 24.000 credit tüketimi. Öğretmenler arasında dağılım:

| Öğretmen | Payı | Tüketilen credit | Aylık kazanç (%30, $0,01) |
|---|---|---|---|
| Çok tercih edilen | %40 | 9.600 | **$28,80** |
| Orta | %35 | 8.400 | $25,20 |
| Yeni | %25 | 6.000 | $18,00 |

Not: kullanıcının "$10 hoş geldin" ödülü ayrıdır ve **doğrulama başına bir kez** verilir.

## 6. Platform geliri (aynı senaryo)

- Satış: 24.000 credit × ortalama $0,008 = **$192**
- Öğretmen payı: %30 → **$57,60**
- Platform brüt: **$134,40**
- AI maliyeti (yerel): 400 üretim × $0,0024 ≈ **$1**
- **Net ≈ $133** (ödeme sağlayıcı komisyonu hariç; v0.1'de ödeme yok)

## 7. Defter kuralları (test edilecek)

1. `sum(ledger) == balance` — her kullanıcı için, her zaman.
2. Bakiye asla negatife düşmez (rezervasyon aşamasında reddedilir).
3. Öğretmen payı **settle** anında yazılır; iptal/iade varsa pay geri alınır.
4. Başarısız iş credit **iade** eder, öğretmen payı iptal olur.
5. Aynı iş için iki kez settle çağrılırsa ikincisi no-op (idempotent).
6. Hoş geldin ödülü kullanıcı+rol başına bir kez.
7. Tüm tutarlar **sent (int)**; float yok. Gösterimde yuvarlanır.

## 8. Açık riskler

- **Hukuk:** gerçek para tahsilatı v0.1'de yok. Ödeme alınacaksa ödeme kuruluşu + mesafeli satış
  sözleşmesi + vergi gerekir. Öğrenci reşit değilse veli onayı.
- **Rıza:** öğretmen sesi/yüzü klonlanıyorsa yazılı rıza + silme hakkı zorunlu (`consent.json`).
- **Kalite:** kötü bir üretim öğretmenin itibarına zarar verir; bu yüzden öğrenci çıktıyı
  işaretleyebilmeli ve iade alabilmeli (v0.1: işaretle + otomatik iade).
