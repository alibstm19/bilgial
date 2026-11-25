# Güvenlik Politikası

## Desteklenen sürüm

| Sürüm | Destek |
|---|---|
| `0.2.x` (deneme) | ✅ |
| `0.1.x` | ❌ |

## Açık bildirimi

Güvenlik açığını **herkese açık issue olarak açmayın**. Bunun yerine:

1. GitHub'ın **Private vulnerability reporting** özelliğini kullanın
   (Security → Report a vulnerability), veya
2. Depo sahibine GitHub üzerinden özel mesaj gönderin.

Lütfen şunları ekleyin: etkilenen bileşen, yeniden üretme adımları, olası etki ve varsa önerilen
düzeltme. İlk yanıt hedefi 72 saattir.

## BilgiAl'ın güvenlik modeli

- Uygulama **yerel öncelikli**dir. Ağ erişimi yalnız `127.0.0.1:11434` (Ollama) ve isteğe bağlı
  LAN telefon köprüsü (`:4780`) içindir.
- Telefon köprüsü **eşleştirme kodu** ister, oturum belirteci üretir ve yalnız aynı ağda çalışır.
  İnternete açık şekilde yayınlanması desteklenmez.
- IPC yüzeyi `contextBridge` ile sınırlıdır; renderer doğrudan Node API'sine erişemez.
- Her yazma öncesi şema doğrulaması yapılır; bozuk belge diske yazılmaz.
- Sırlar depoda tutulmaz. Demo hesapları kurgusaldır ve yalnız yerel deneme verisinde geçerlidir.
- Paket **kod imzalı değildir**; dağıtımda SmartScreen uyarısı beklenir. Bu bir güvenlik açığı
  değil, imza bütçesi olmayan bir demo sınırıdır.

## Bilinen ve kabul edilen sınırlar

- Gerçek ödeme entegrasyonu yoktur; kredi işlemleri simülasyondur.
- Ses klonlama ve avatar üretimi yazılı rıza kapısı arkasındadır ve demo bunları indirmez.
- Sınıf verisi yerel JSON belgelerinde tutulur; çok kullanıcılı sunucu sertleştirmesi bu sürümün
  kapsamı dışındadır.
