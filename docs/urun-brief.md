# BilgiAl — Ürün Brief'i (v1)

Tarih: 2026-11-04 · Sahip: LDR · Kaynak: kullanıcı beyanı

## 1. Problem

Öğrenci anlamadığı soruyu çözmek için ya özel ders alıyor (pahalı, saat kısıtlı) ya da rastgele
video izliyor (kendi sayfasına, kendi sorusuna uymuyor). Öğretmen ise bilgisini ölçekleyemiyor:
aynı anlatımı yüzlerce kez yapıyor, bir kez kaydedip gelir elde edemiyor.

## 2. Çözüm

Öğrenci sayfasını yükler → anlatımını sevdiği öğretmeni seçer → uygulama o sayfayı analiz eder,
soruların özünü çıkarır ve **o öğretmenin anlatım tarzıyla** sesli-görsel çözüm üretir.
Öğretmen bu kullanımdan credits geliri elde eder, uygulama sahibi komisyon alır.

## 3. Kullanıcılar

| Rol | Ne yapar | Kazancı |
|---|---|---|
| **Öğrenci** | Sayfa yükler, hoca seçer, credits harcar, çözümü izler | Kendi sayfasına özel, sevdiği hocadan anlatım |
| **Öğretmen** | Eğitim videoları yükler, profilini eğitir, doğrulanır | Harcanan creditsin %30'u + doğrulama ödülü $10 |
| **Sahip (admin)** | Doğrulama kuyruğunu onaylar, ekonomiyi izler | Kalan marj + credit satışı |

## 4. İlk sürümde KESİN (v0.1)

1. **Üç rol, tek makine:** kayıt/giriş, rol ayrımı (öğrenci / öğretmen / admin). Sunucu yok.
2. **Öğretmen stüdyosu:** ders anlatım videosu + ses örneği yükleme, profil eğitimi ilerlemesi.
3. **Profil eğitimi:** yüklenen videolardan anlatım tarzı çıkarımı (hız, vurgu, pedagojik sıra,
   karakteristik ifadeler) → `profile.json` taslağı.
4. **Doğrulama akışı:** öğretmen "kaynaklarım hazır" der → admin kuyruğuna düşer → admin onaylarsa
   profil `verified` olur ve **$10 hoş geldin bakiyesi** yazılır.
5. **Öğrenci akışı:** sayfa görseli yükle → hoca seç → **credit maliyeti önizlemesi** → onayla →
   iş kuyruğa girer → üretim → çözüm sayfası + seslendirme.
6. **Credits ekonomisi:** paketler, satın alma (v0.1'de **simülasyon**), harcama, %30 öğretmen payı,
   iade, append-only defter.
7. **Yerel AI bağlantı merkezi:** LLM / görsel / STT / TTS / avatar sağlayıcıları; Ollama otomatik
   keşif ve sağlık testi; her aşama için model seçimi.
8. **Kütüphane:** üretilmiş çözümler, tekrar izleme, öğretmene göre filtre.
9. **Admin paneli:** doğrulama kuyruğu, gelir/pay dağılımı, iş (job) izleme.
10. **Profesyonel arayüz:** koyu/açık tema, token tabanlı tasarım, komut paleti.

## 5. v0.1'de OLMAYANLAR (bağlayıcı)

- Gerçek para tahsilatı / ödeme sağlayıcısı (Stripe/iyzico) — **simülasyon**, hukuki zemin hazır değil.
- Bulut AI zorunluluğu — her şey yerel çalışabilir.
- Öğretmenin **gerçek yüz videosu** üretimi (lip-sync): arayüz ve aşama tanımlı, model kurulu değil.
  v0.1 çıktısı: **slayt + seslendirme videosu** (avatar aşaması `pending-model`).
- Canlı ders, ödev takibi, sınav motoru, veli paneli, mobil.
- Çoklu cihaz senkronu, sosyal özellikler, yorum/puanlama.

## 6. Dürüst teknik sınırlar (bugün ölçüldü)

| Yetenek | Durum | Kanıt |
|---|---|---|
| Sayfa görsel analizi (vision) | ✅ gerçek | `qwen3-vl:8b` Ollama'da kurulu, servis 200 |
| Metin LLM | ⚠️ model yok | Ollama'da yalnız vision modeli var; `ollama pull` gerekir |
| Ses → metin (STT) | ❌ kurulu değil | Python boş, model yok |
| Metin → ses (TTS) | ❌ kurulu değil | Piper/XTTS kurulmalı |
| Dudak senkronu / avatar | ❌ kurulu değil | Wav2Lip/SadTalker + model ağırlıkları gerekir |
| Video birleştirme | ❌ ffmpeg yok | PATH'te yok |

Bu tablo ürün vaadini değiştirmez; **v0.1 bu aşamaları çalışır arayüzle bağlar, eksik olanı
`pending-model` diye dürüstçe gösterir.**

## 7. Başarı ölçütü (v0.1 kabulü)

Öğretmen kayıt olur, 2 video yükler, profil eğitimi tamamlanır, admin onaylar, $10 bakiye düşer.
Öğrenci kayıt olur, sayfa yükler, hoca seçer, maliyeti görür, 50 credit harcar, çözüm üretilir,
öğretmenin bakiyesine %30 pay yazılır, defter tutarlıdır. Testler yeşil, paket açılıyor.
