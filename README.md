# FlowDesk

**[English](#english) · [Türkçe](#türkçe)**

---

## English

A Windows desktop app for reminders, payment & subscription tracking and note-taking (Electron).

**Download:** [release/FlowDesk_Setup.exe](release/FlowDesk_Setup.exe) — installs per user, no administrator rights needed.

### Features

- **Payments & subscriptions** — monthly / weekly / yearly recurrence, categories, spending chart, CSV / PDF export
- **Upcoming payments** — everything due within 3 days, right on the home screen
- **Reminders** — Windows notification at the chosen date and time
- **Notebook** — full-screen editor, search, `.txt` / `.md` export
- **Global search (Ctrl+K)** — notes, payments, subscriptions and reminders at once
- **Security** — master password; auto-locks when the window is closed to the tray
- **Backup** — all data in a single file; AES-256 encrypted `.flow` or plain `.json`
- **Themes** — Light, Dark and Devilt Violet
- **Languages** — Türkçe, English, Deutsch, Español, Français, Português (Brasil), 日本語, 简体中文, Русский

### Development

```bash
npm install
npm start        # run the app in development mode
npm run dist     # build the installer into dist/FlowDesk_Setup.exe
```

In development mode data is written to the `data/` folder inside the project; the installed app
writes to `%APPDATA%\FlowDesk+\data`. The `data/` folder is excluded from the repository via `.gitignore`.

### Project structure

```
main.js          Main process: data store, notifications, tray, lock, backups
preload.js       Secure API bridge exposed to the UI
src/             UI (index.html, app.js, style.css, i18n.js)
src/locales/     Language files
src/assets/      Icons and logo
release/         Ready-to-install package
```

---

## Türkçe

Windows için hatırlatıcı, ödeme/abonelik takibi ve not defteri uygulaması (Electron).

**İndir:** [release/FlowDesk_Setup.exe](release/FlowDesk_Setup.exe) — kurulum kullanıcı bazlıdır, yönetici izni istemez.

### Özellikler

- **Ödemeler & abonelikler** — aylık / haftalık / yıllık tekrar, kategoriler, harcama grafiği, CSV / PDF dışa aktarma
- **Yaklaşan ödemeler** — vadesine 3 gün veya daha az kalanlar ana sayfada
- **Hatırlatıcılar** — belirlenen tarih/saatte Windows bildirimi
- **Not Defteri** — tam ekran editör, arama, `.txt` / `.md` dışa aktarma
- **Genel arama (Ctrl+K)** — notlar, ödemeler, abonelikler ve hatırlatıcılarda tek seferde
- **Güvenlik** — ana şifre; pencere kapatılınca (tepsiye) otomatik kilit
- **Yedekleme** — tüm veriler tek dosyada; AES-256 ile şifreli `.flow` veya düz `.json`
- **Temalar** — Açık, Koyu ve Devilt Violet
- **Diller** — Türkçe, English, Deutsch, Español, Français, Português (Brasil), 日本語, 简体中文, Русский

### Geliştirme

```bash
npm install
npm start        # uygulamayı geliştirme modunda açar
npm run dist     # dist/FlowDesk_Setup.exe kurulum paketini üretir
```

Geliştirme modunda veriler proje içindeki `data/` klasörüne, kurulu uygulamada ise
`%APPDATA%\FlowDesk+\data` klasörüne yazılır. `data/` klasörü `.gitignore` ile depodan hariç tutulur.

### Proje yapısı

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
