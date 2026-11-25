# Katkı Rehberi

BilgiAl'a ilgi gösterdiğiniz için teşekkürler. Bu depo **çalışan bir demo** ve açık bir fikir;
sahadan gelen gerçek geri bildirim en değerli katkıdır.

## Nasıl katkı verilir

1. **Önce konuşun.** Büyük bir değişiklik (yeni ekran, yeni kanal, yeni bağımlılık) için
   [Issue](https://github.com/alibstm19/bilgial/issues) açın. Küçük düzeltmeler doğrudan pull request olabilir.
2. Depoyu çatallayın, `main` üzerinden anlamlı bir dal açın (`fix/odev-tarihi`, `feat/…`).
3. Değişikliği **ölçülebilir** tutun: tek bir davranış, tek bir test.
4. Kapıları yeşil bırakın:

   ```powershell
   node --test tests/
   node tools/lint.js
   node tools/doctor.js
   ```

5. Pull request açıklamasında **kanıt** verin: çalıştırdığınız komut ve çıktısı, ya da önce/sonra
   ekran görüntüsü. "Bence çalışıyor" kabul edilmez.

## Kurallar

- **Yeni çalışma zamanı bağımlılığı eklemeyin.** Proje bilinçli olarak yalnız Electron kullanır;
  geri kalan her şey Node yerleşikleri ve yerel araçlardır.
- **Dil:** kullanıcıya görünen metin **Türkçe**; kod, dosya adı ve commit mesajı **İngilizce**.
- **Stil kapısı:** `tokens.css` dışında ham renk yok, `!important` yok, inline `style` yok.
  Renk ve boşluklar tasarım tokenlarından gelir.
- **Tek doğruluk kaynağı:** iş kuralları `src/shared/` içinde yaşar. Arayüzde kural tekrarlamayın.
- **Sözleşme:** yeni bir IPC kanalı ekliyorsanız `docs/contract-v0.md` §5 listesini ve
  `tests/contract.test.js` beklentisini birlikte güncelleyin.
- **Şema kapıları:** diske yazmadan önce `schema.validate*` çağırın.
- **Sır yok:** anahtar, token, parola ve kişisel veri commit etmeyin. `.env` dosyası commit
  edilmez; demo hesapları kurgusaldır.
- **Etik kapılar:** ses klonlama ve avatar özellikleri yazılı rıza olmadan açılmaz. Bu kapıları
  kaldıran değişiklikler kabul edilmez.

## Commit mesajı

```
feat(classes): add Turkish-insensitive member search
fix(video): keep caption track when switching aspect ratio
test(mobile): cover overdue badge in tasks search
docs(readme): explain local model tiers
```

## Hata bildirimi

[Issue](https://github.com/alibstm19/bilgial/issues) açarken şunları ekleyin:

- Windows sürümü, Node sürümü, Ollama sürümü
- Uygulamayı nasıl çalıştırdığınız (paket ZIP mi, kaynak mı)
- Beklenen ve gerçek davranış
- Mümkünse `node tools/doctor.js` çıktısı ve ekran görüntüsü

Güvenlik açığı için lütfen [SECURITY.md](SECURITY.md) yolunu izleyin; herkese açık issue açmayın.

## Davranış kuralları

Topluluk [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) ile yönetilir. Saygılı olun; eğitimciler ve
öğrenciler bu projeyi gerçek sınıflarda deniyor.

## Lisans

Katkı vererek değişikliğinizi [MIT lisansı](LICENSE) altında yayınlamayı kabul etmiş olursunuz.
