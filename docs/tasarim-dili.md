# BilgiAl — Tasarım Dili (v2)

Sahip: DSN-A (`tokens.css`, `base.css`, `shell.css`) · DSN-B (`screens.css`, `index.html`).
Bağlayıcı kaynak: `docs/design-v2-spec.md` §1–§4 ve `docs/contract-v0.md` §7.4.
Token ve sınıf adları spec ile **birebir**; bu belge yeni ad icat etmez.

## 1. İlke

Linear / Raycast sınıfı profesyonel masaüstü paneli: koyu tema varsayılan, tek vurgu rengi,
kenar + yüzey tonuyla derinlik, ağır gölge yok, 8px ızgara, 10px kart yarıçapı.
Her ekranın tek işi vardır: `screen-title` + `screen-sub` + sağda `toolbar`.

## 2. Token tablosu (özet)

### Renk

| Grup | Tokenlar | Rol |
|---|---|---|
| Yüzey | `--bi-bg` `--bi-bg-1` `--bi-bg-2` `--bi-bg-3` | Sayfa → kart → iç panel → seçili |
| Etkileşim | `--bi-bg-hover` `--bi-bg-active` | Hover / basılı zemin |
| Maske | `--bi-overlay` | Palet ve modal arkası |
| Metin | `--bi-fg` `--bi-fg-2` `--bi-fg-3` `--bi-fg-inverse` | Ana / ikincil / üçüncül / ters |
| Kenar | `--bi-border` `--bi-border-strong` `--bi-border-focus` | Standart / güçlü / odak |
| Vurgu | `--bi-accent` `--bi-accent-hover` `--bi-accent-soft` `--bi-accent-fg` | Birincil eylem, aktif nav |
| İkincil vurgu | `--bi-accent-2` `--bi-accent-2-soft` | Kredi/öne çıkarma |
| Anlam | `--bi-success` `--bi-warning` `--bi-danger` `--bi-info` (+ `-soft`) | Durum, daima metinle birlikte |
| Kabuk | `--bi-rail-bg` `--bi-sidebar-bg` `--bi-topbar-bg` | Rail / sidebar / topbar yüzeyi |

Koyu değerler `:root`, açık değerler `[data-theme="light"]` altında. **Ham renk yalnız
`tokens.css` içinde.**

### Tipografi

| Token | Değer |
|---|---|
| `--bi-font-display` / `--bi-font-sans` / `--bi-font-mono` | Segoe UI Variable Display / Text / Cascadia Code |
| `--bi-fs-11…34` | 11, 12, 13, 14, 16, 20, 26, 34px |
| `--bi-fw-regular…bold` | 400 / 500 / 600 / 700 |
| `--bi-lh-tight` / `--bi-lh-normal` | 1.2 / 1.55 |

Gövde 14px/1.55, tüm sayılar `tabular-nums`, başlıklar `letter-spacing: -0.015em`.

### Boşluk, geometri, hareket

| Grup | Tokenlar |
|---|---|
| Boşluk | `--bi-s1…s8` → 4, 8, 12, 16, 24, 32, 48, 64px |
| Yarıçap | `--bi-r-sm/md/lg/pill` → 6 / 10 / 14 / 999px |
| Gölge | `--bi-shadow-1` (yüzen), `--bi-shadow-2` (palet/modal) |
| Ölçü | `--bi-rail-w` 60, `--bi-sidebar-w` 236, `--bi-topbar-h` 52, `--bi-content-max` 1280px |
| Hareket | `--bi-dur-fast` 120ms, `--bi-dur` 180ms, `--bi-ease` |

`[data-density="compact"]` boşluk ölçeğini (`--bi-s3…s8`) küçültür; veri/tablo ekranlarında.

## 3. Bileşen sözlüğü

| Bileşen | Kural |
|---|---|
| `.app-shell` | Grid: `rail` \| `sidebar` \| `main`; auth'ta tek sütun |
| `.rail` / `.rail-item` | 60px dikey ikon şeridi; aktif öğede sol accent şerit, alt kısımda tema |
| `.sidebar` / `.side-nav-item` | 236px; aktif öğe `bg-hover` + sol accent + `aria-current="page"` |
| `.topbar` / `.topbar-search` | 52px; arama kutusu komut çubuğu görünümünde, `kbd` ipucu sağda |
| `#palette` | Blur overlay; üstte arama, gruplu `.palette-item` listesi, alt kısayol şeridi |
| `#modal-root` / `#toast-root` | Modal ortada, toast sağ üstte; boşken görünmez |
| `#role-switch` | Segmentli kontrol; seçili öğe `bg-3` + `aria-pressed="true"` |
| `.screen-head` | Sol `screen-title` + `screen-sub`, sağ `toolbar` |
| `.content` | Ana kaydırma alanı; `--bi-s5` iç boşluk, `--bi-content-max` sınırı |
| `.card` | 1px `--bi-border`, `--bi-bg-1`, `--bi-r-md`, `--bi-s4` iç boşluk |
| `.kpi` / `.kpi-value` | Değer tabular; `kpi-delta` yönü metinle söyler |
| `.table` / `.table-wrap` | Yapışkan `thead`, satır hover `--bi-bg-hover`, sayılar tabular |
| `.field` / `.input` / `.select` | Görünür etiket; hata `field-error`, ipucu `field-hint` |
| `.btn` + varyantlar | Birincil accent zemin; ikincil şeffaf + kenar; ikon düğmesi `btn-icon` |
| `.segmented-item` | Seçili `aria-pressed="true"`; klavye ile gezinir |
| `.pill` / `.badge` | `data-tone="success\|warning\|danger\|info\|muted"`; metinsiz durum yok |
| `.empty` | İkon + başlık + tek cümle + tek eylem |
| `.progress` / `.stat-ring` / `.chart-box` | Yerel `<progress>` ve satır içi SVG; inline stil yok |
| `.dropzone` / `.file-chip` | Yükleme alanı bir `label`; dosya girişi görsel gizli, klavyeyle erişilir |
| `.model-card[data-fit]` | `ok` / `tight` / `over`; `over` uyarısı metinle zorunlu |

Durum ve ekran kabloları: `body[data-role]` + `[data-roles]` filtresi,
`body[data-view]` + `section[hidden]` geçişi. `body[data-theme]`, `body[data-density]`.

## 4. Erişilebilirlik

- **Kontrast:** gövde ≥ 4.5:1, büyük başlık ≥ 3:1, UI sınırı ≥ 3:1. Anlam renkleri bu eşiğe göre.
- **Odak:** `:focus-visible` → 2px `--bi-border-focus`, 2px offset; gizli inputlarda `:focus-within`.
- **Klavye:** `Ctrl+K` palet, `Escape` kapatır, `↑/↓ + Enter` seçer; skip link ilk odakta görünür.
- **Anlam:** durum asla yalnız renkle; her ikon `aria-hidden`, yalnız ikonlu düğmede `aria-label`.
- **Hareket:** `prefers-reduced-motion: reduce` tüm süreleri 0.01ms yapar.
- **Dokunma:** en küçük hedef 32px.

## 5. Yapma listesi

- ❌ Ham `#hex` / `rgb()` / `hsl()` — yalnız `tokens.css`; gerisi `var(--bi-*)`.
- ❌ `!important` ve inline `style="…"`.
- ❌ Yeni token veya spec dışı sınıf adı uydurmak.
- ❌ 4'ün katı olmayan px boşluk; sabit px yerine `--bi-s*`.
- ❌ Ağır gölge, gradient süs, CDN/uzak font/ikon kütüphanesi (ikonlar inline SVG, stroke 1.5).
- ❌ Renkle tek başına durum anlatmak; rozet metinsiz olmaz.
- ❌ Aynı `id`/`data-testid` iki kez; boş listeyi açıklamasız bırakmak.
- ❌ Sidebar'da rol dışı menü; `data-role` + `[data-roles]` belirler.
- ❌ Gerçek ödeme varmış gibi davranmak; simülasyon açıkça yazar.
