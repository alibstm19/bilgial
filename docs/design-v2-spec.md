# BilgiAl — Tasarım Sistemi v2 · Teknik Spesifikasyon

Bağlayıcı. DSN-A (`tokens/base/shell`) ve DSN-B (`screens/index.html`) bu belgeye göre çalışır.
Amaç: Linear / Raycast / Descript sınıfı profesyonel masaüstü uygulaması hissi.

## 1. Token adları (TAM liste — başka token icat etme)

Renk (koyu varsayılan):
`--bi-bg` `--bi-bg-1` `--bi-bg-2` `--bi-bg-3` `--bi-bg-hover` `--bi-bg-active` `--bi-overlay`
`--bi-fg` `--bi-fg-2` `--bi-fg-3` `--bi-fg-inverse`
`--bi-border` `--bi-border-strong` `--bi-border-focus`
`--bi-accent` `--bi-accent-hover` `--bi-accent-soft` `--bi-accent-fg`
`--bi-accent-2` `--bi-accent-2-soft`
`--bi-success` `--bi-success-soft` `--bi-warning` `--bi-warning-soft`
`--bi-danger` `--bi-danger-soft` `--bi-info` `--bi-info-soft`
`--bi-rail-bg` `--bi-sidebar-bg` `--bi-topbar-bg`

Tipografi: `--bi-font-display` `--bi-font-sans` `--bi-font-mono`
`--bi-fs-11` `--bi-fs-12` `--bi-fs-13` `--bi-fs-14` `--bi-fs-16` `--bi-fs-20` `--bi-fs-26` `--bi-fs-34`
`--bi-fw-regular` `--bi-fw-medium` `--bi-fw-semibold` `--bi-fw-bold`
`--bi-lh-tight` `--bi-lh-normal`

Boşluk (8px taban): `--bi-s1`(4) `--bi-s2`(8) `--bi-s3`(12) `--bi-s4`(16) `--bi-s5`(24) `--bi-s6`(32) `--bi-s7`(48) `--bi-s8`(64)

Geometri: `--bi-r-sm`(6) `--bi-r-md`(10) `--bi-r-lg`(14) `--bi-r-pill`(999)
`--bi-shadow-1` `--bi-shadow-2` `--bi-rail-w`(60px) `--bi-sidebar-w`(236px) `--bi-topbar-h`(52px) `--bi-content-max`(1280px)

Hareket: `--bi-dur-fast`(120ms) `--bi-dur`(180ms) `--bi-ease`

## 2. Bileşen sınıfları (TAM liste)

```
app-shell  rail  rail-item  sidebar  side-nav  side-nav-item  topbar  topbar-search
screen  screen-head  screen-title  screen-sub  toolbar  content
card  card-head  card-title  card-sub  card-body  card-foot  card-grid
kpi  kpi-value  kpi-label  kpi-delta  kpi-row
table  table-wrap  table-empty
field  input  select  textarea  checkbox  checkbox-row  field-hint  field-error
btn  btn-primary  btn-ghost  btn-danger  btn-icon  btn-sm  btn-block
segmented  segmented-item
pill  badge  avatar  kbd  divider  spinner  skeleton
empty  empty-icon  empty-title  empty-text  empty-action
stack  row  row-between  grid-2  grid-3  split
progress  progress-bar  progress-label
timeline  timeline-step  timeline-dot
dropzone  dropzone-hint  file-list  file-chip
model-card  model-meta  model-stars  dl-row  dl-head  dl-bar
player  scene-card  scene-list
stat-ring  chart-box  legend  legend-item
```

Durum: `.pill[data-tone="success|warning|danger|info|muted"]`
VRAM: `.model-card[data-fit="ok|tight|over"]`
Rol: `body[data-role="student|teacher|admin"]` → `[data-roles]` içindeki nav öğeleri gizlenir.
Ekran: `body[data-view="..."]` → ilgili `section[hidden]` kaldırılır (JS).

## 3. Görsel kurallar

- Derinlik **kenar + yüzey tonu** ile; ağır gölge yok (`--bi-shadow-1` yalnız yüzen katman).
- Her ekran: `screen-head` (sol: `screen-title` + `screen-sub`; sağ: `toolbar`).
- Kart: 1px `--bi-border`, `--bi-bg-1`, `--bi-r-md`, iç boşluk `--bi-s4`.
- Tablo: yapışkan `thead`, satır hover `--bi-bg-hover`, hücre `--bi-s3`, sayılar tabular.
- Düğme birincil: `--bi-accent` zemin, `--bi-accent-fg`; ikincil: şeffaf + kenar.
- Boş durum: ikon + başlık + tek satır açıklama + eylem.
- Focus: `outline: 2px solid var(--bi-border-focus)`, `outline-offset: 2px`.
- `prefers-reduced-motion: reduce` → tüm süreler 0.01ms.
- Yatay taşma 0 (`.stack,.grid-2,.grid-3,.split` içinde `minmax(0,1fr)`).

## 4. Yasaklar

- Ham `#hex`/`rgb()` yalnız `tokens.css` içinde.
- `!important` yasak (yalnız `[hidden]` istisnası).
- Inline `style="..."` yasak.
- CDN, uzak font, ikon kütüphanesi yasak — ikonlar inline SVG (24x24, stroke 1.5).
- Sabit px boşluk yasak — `--bi-s*` kullan.

## 5. Dosya sahipliği

| Dosya | Sahip |
|---|---|
| `styles/tokens.css`, `base.css`, `shell.css` | DSN-A |
| `styles/screens.css`, `index.html` | DSN-B |
| `app.js`, `lib/**`, `screens/**` | DEV-2 |
