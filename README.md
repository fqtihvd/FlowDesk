# FlowDesk

Windows için hatırlatıcı, ödeme/abonelik takibi ve not defteri uygulaması (Electron).

**İndir:** [release/FlowDesk_Setup.exe](release/FlowDesk_Setup.exe) — kurulum kullanıcı bazlıdır, yönetici izni istemez.

## Özellikler

- **Ödemeler & abonelikler** — aylık / haftalık / yıllık tekrar, kategoriler, harcama grafiği, CSV / PDF dışa aktarma
- **Yaklaşan ödemeler** — vadesine 3 gün veya daha az kalanlar ana sayfada
- **Hatırlatıcılar** — belirlenen tarih/saatte Windows bildirimi
- **Not Defteri** — tam ekran editör, arama, `.txt` / `.md` dışa aktarma
- **Genel arama (Ctrl+K)** — notlar, ödemeler, abonelikler ve hatırlatıcılarda tek seferde
- **Güvenlik** — ana şifre; pencere kapatılınca (tepsiye) otomatik kilit
- **Yedekleme** — tüm veriler tek dosyada; AES-256 ile şifreli `.flow` veya düz `.json`
- **Temalar** — Açık, Koyu ve Devilt Violet
- **Diller** — Türkçe, English, Deutsch, Español, Français, Português (Brasil), 日本語, 简体中文, Русский

## Geliştirme

```bash
npm install
npm start        # uygulamayı geliştirme modunda açar
npm run dist     # dist/FlowDesk_Setup.exe kurulum paketini üretir
```

Geliştirme modunda veriler proje içindeki `data/` klasörüne, kurulu uygulamada ise
`%APPDATA%\FlowDesk+\data` klasörüne yazılır. `data/` klasörü `.gitignore` ile depodan hariç tutulur.

## Proje yapısı

```
main.js          Ana süreç: veri deposu, bildirimler, tepsi, kilit, yedekleme
preload.js       Arayüze açılan güvenli API köprüsü
src/             Arayüz (index.html, app.js, style.css, i18n.js)
src/locales/     Dil dosyaları
src/assets/      İkonlar ve logo
release/         Hazır kurulum paketi
```

---

by Devilt Interactive
