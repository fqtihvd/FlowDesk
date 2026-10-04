const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// ---------------------------------------------------------------------
// Gumroad licensing config — fill these in once the product is live on
// Gumroad: Settings > "Edit product" page URL is gumroad.com/l/<permalink>.
// Product ID is optional (permalink alone is enough for verification).
// ---------------------------------------------------------------------
const GUMROAD_PRODUCT_PERMALINK = 'REPLACE_WITH_GUMROAD_PERMALINK';
const GUMROAD_PURCHASE_URL = 'https://gumroad.com/l/REPLACE_WITH_GUMROAD_PERMALINK';
const TRIAL_DAYS = 7;

// The "F" app icon. The .ico carries 16–256 px frames, so Windows picks a
// crisp size for the taskbar, title bar and tray; the PNG is used for
// notification toasts.
const ASSETS_DIR = path.join(__dirname, 'src', 'assets');
let cachedIcons = null;
function appIcons() {
  if (!cachedIcons) {
    const png = nativeImage.createFromPath(path.join(ASSETS_DIR, 'app-icon.png'));
    const ico = nativeImage.createFromPath(path.join(ASSETS_DIR, 'app-icon.ico'));
    cachedIcons = { png, window: process.platform === 'win32' && !ico.isEmpty() ? ico : png };
  }
  return cachedIcons;
}
const appIconImage = () => appIcons().png;

const isDev = !app.isPackaged;
// Development: store data next to the project so it's easy to inspect.
// Packaged app: store in the per-user app data folder.
const dataDir = isDev
  ? path.join(__dirname, 'data')
  : path.join(app.getPath('userData'), 'data');

const configPath = path.join(dataDir, 'config.json');
const dataPath = path.join(dataDir, 'data.json');
const settingsPath = path.join(dataDir, 'settings.json');
const licensePath = path.join(dataDir, 'license.json');
const notifiedPath = path.join(dataDir, 'notified.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// The per-user data folder is named after productName, so each rebrand
// would otherwise orphan existing data. On first launch of a packaged build
// with no data yet, copy it over from the previous product folder(s).
function migrateLegacyData() {
  if (isDev || fs.existsSync(path.join(dataDir, 'config.json'))) return;
  for (const legacy of ['PayFlow Desk', 'Görevlerim']) {
    const from = path.join(app.getPath('appData'), legacy, 'data');
    if (!fs.existsSync(path.join(from, 'config.json'))) continue;
    fs.mkdirSync(dataDir, { recursive: true });
    for (const name of ['config.json', 'data.json', 'settings.json', 'license.json']) {
      const src = path.join(from, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, name));
    }
    return;
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
}

function getConfig() {
  return readJson(configPath, { passwordHash: null, salt: null });
}

function saveConfig(cfg) {
  writeJson(configPath, cfg);
}

function getData() {
  const d = readJson(dataPath, { themes: [], items: [], categories: [], notebook: [] });
  if (!Array.isArray(d.categories)) d.categories = [];
  if (!Array.isArray(d.notebook)) d.notebook = [];
  return d;
}

function saveData(d) {
  writeJson(dataPath, d);
}

const UI_THEMES = ['dark', 'light', 'violet'];
const DEFAULT_SETTINGS = { language: 'en', currency: '$', minimizeToTray: true, launchAtStartup: true, theme: 'dark' };

function getSettings() {
  const stored = readJson(settingsPath, {});
  // Email/SMTP support was removed; drop any stored credentials (they were
  // kept in plain text) the first time settings are read.
  if (stored.email) {
    delete stored.email;
    try { saveSettings(stored); } catch {}
  }
  return { ...DEFAULT_SETTINGS, ...stored };
}

// Window background per theme, so the frame never flashes another palette
// before the page paints.
const THEME_BACKGROUNDS = { dark: '#0f1117', light: '#f5f6f8', violet: '#110e1d' };

function saveSettings(s) {
  writeJson(settingsPath, s);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makeId() {
  return crypto.randomBytes(9).toString('hex');
}

function nextOrder(list) {
  if (list.length === 0) return 0;
  return Math.max(...list.map((x) => x.order ?? 0)) + 1;
}

// ---------- Licensing (Gumroad) ----------

function getLicense() {
  let lic = readJson(licensePath, null);
  if (!lic) {
    lic = { key: null, status: 'trial', trialStartedAt: Date.now(), verifiedAt: null };
    writeJson(licensePath, lic);
  }
  return lic;
}

function saveLicense(lic) {
  writeJson(licensePath, lic);
}

// Build-time switch read from app.config.json shipped next to main.js.
// `require_license: false` = developer/local build: no trial clock, no
// banner, no lock screen. A missing or unreadable file defaults to TRUE so
// a release build can never accidentally ship unlocked.
const REQUIRE_LICENSE = readJson(path.join(__dirname, 'app.config.json'), {}).require_license !== false;

function computeLicenseStatus() {
  if (!REQUIRE_LICENSE) return { status: 'dev', daysLeft: null, key: null };
  const lic = getLicense();
  if (lic.status === 'licensed' && lic.key) {
    return { status: 'licensed', daysLeft: null, key: lic.key };
  }
  const elapsedDays = (Date.now() - lic.trialStartedAt) / (1000 * 60 * 60 * 24);
  const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays));
  return { status: daysLeft > 0 ? 'trial' : 'expired', daysLeft, key: null };
}

function verifyGumroadLicense(licenseKey) {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      product_permalink: GUMROAD_PRODUCT_PERMALINK,
      license_key: licenseKey,
      increment_uses_count: 'false',
    }).toString();

    const req = https.request(
      {
        hostname: 'api.gumroad.com',
        path: '/v2/licenses/verify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            resolve({ ok: !!json.success, raw: json });
          } catch {
            resolve({ ok: false, error: 'BAD_RESPONSE' });
          }
        });
      }
    );
    req.on('error', () => resolve({ ok: false, error: 'NETWORK_ERROR' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'TIMEOUT' }); });
    req.write(body);
    req.end();
  });
}

// ---------- Recurrence date math (for the notification scheduler) ----------

function addMonthsClamped(date, months) {
  const day = date.getDate();
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setMonth(d.getMonth() + months);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInMonth));
  return d;
}

function addYearsClamped(date, years) {
  const day = date.getDate();
  const d = new Date(date.getFullYear() + years, date.getMonth(), 1);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInMonth));
  return d;
}

function advanceOccurrence(date, periodType) {
  if (periodType === 'weekly') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
  if (periodType === 'yearly') return addYearsClamped(date, 1);
  return addMonthsClamped(date, 1);
}

// Mirrors the renderer's computeRecurrence(): finds the next due date for a
// recurring payment as of today, without ever mutating stored data.
function computeNextDue(item) {
  if (!item.startDate) return null;
  if (!['monthly', 'weekly', 'yearly'].includes(item.periodType)) return null;
  const start = new Date(item.startDate + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start > today) return start;

  let occurrence = start;
  let guard = 0;
  while (guard < 2000) {
    const next = advanceOccurrence(occurrence, item.periodType);
    if (next > today) break;
    occurrence = next;
    guard++;
  }
  return occurrence.getTime() === today.getTime() ? occurrence : advanceOccurrence(occurrence, item.periodType);
}

// ---------- Windows notifications (due payments & reminders) ----------

// Main-process copy of the notification strings, in the user's UI language.
const NOTIFY_STRINGS = {
  en: { title: '⏰ Reminder', untitled: 'Note', payment: 'Payment', dueTomorrow: '{name} is due tomorrow.', dueInDays: '{name} is due in {days} days.' },
  tr: { title: '⏰ Hatırlatma', untitled: 'Not', payment: 'Ödeme', dueTomorrow: '{name} ödemesinin vadesi yarın.', dueInDays: '{name} ödemesinin vadesine {days} gün kaldı.' },
  de: { title: '⏰ Erinnerung', untitled: 'Notiz', payment: 'Zahlung', dueTomorrow: '{name} ist morgen fällig.', dueInDays: '{name} ist in {days} Tagen fällig.' },
  es: { title: '⏰ Recordatorio', untitled: 'Nota', payment: 'Pago', dueTomorrow: '{name} vence mañana.', dueInDays: '{name} vence en {days} días.' },
  fr: { title: '⏰ Rappel', untitled: 'Note', payment: 'Paiement', dueTomorrow: '{name} est dû demain.', dueInDays: '{name} est dû dans {days} jours.' },
  'pt-BR': { title: '⏰ Lembrete', untitled: 'Nota', payment: 'Pagamento', dueTomorrow: '{name} vence amanhã.', dueInDays: '{name} vence em {days} dias.' },
  ja: { title: '⏰ リマインダー', untitled: 'メモ', payment: '支払い', dueTomorrow: '{name} の支払期限は明日です。', dueInDays: '{name} の支払期限まであと {days} 日です。' },
  'zh-CN': { title: '⏰ 提醒', untitled: '笔记', payment: '付款', dueTomorrow: '{name} 明天到期。', dueInDays: '{name} 将在 {days} 天后到期。' },
  ru: { title: '⏰ Напоминание', untitled: 'Заметка', payment: 'Платёж', dueTomorrow: 'Срок оплаты «{name}» — завтра.', dueInDays: 'До оплаты «{name}» осталось дней: {days}.' },
};

function notifyStrings(language) {
  return NOTIFY_STRINGS[language] || NOTIFY_STRINGS.en;
}

// Strong references keep shown toasts alive until dismissed — otherwise
// they can be garbage-collected and their click handler silently lost.
const liveNotifications = new Set();

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openNoteInWindow(itemId) {
  showMainWindow();
  const send = () => mainWindow.webContents.send('note:open', itemId);
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

function snippet(text, max) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

function runNotificationChecks() {
  if (!Notification.isSupported()) return;
  const d = getData();
  const notified = readJson(notifiedPath, {});
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const strings = notifyStrings(getSettings().language);
  let dirty = false;

  const notify = (body, { title = 'FlowDesk+', onClick = showMainWindow } = {}) => {
    const n = new Notification({ title, body, icon: appIconImage() });
    const release = () => liveNotifications.delete(n);
    n.on('click', () => { release(); onClick(); });
    n.on('close', release);
    liveNotifications.add(n);
    n.show();
  };

  // ---- Payments: heads-up 1 and 3 days before the due date ----
  for (const it of d.items) {
    if (it.type !== 'payments' || it.paid) continue;
    const nextDue = computeNextDue(it);
    if (!nextDue) continue;
    const daysUntil = Math.round((nextDue - today) / (24 * 60 * 60 * 1000));
    if (daysUntil !== 1 && daysUntil !== 3) continue;
    const pushKey = `${it.id}:${nextDue.toISOString().slice(0, 10)}:${daysUntil}:push`;
    if (notified[pushKey]) continue;
    const name = it.name || strings.payment;
    notify((daysUntil === 1 ? strings.dueTomorrow : strings.dueInDays).replace('{name}', name).replace('{days}', daysUntil));
    notified[pushKey] = Date.now();
    dirty = true;
  }

  // ---- Reminders: fire once their date/time has arrived ----
  for (const it of d.items) {
    if (it.type === 'payments' || it.done || !it.reminderAt || new Date(it.reminderAt) > now) continue;
    // Keyed by the reminder's own timestamp, so editing it to a new time
    // makes it eligible to fire again.
    const pushKey = `${it.id}:${it.reminderAt}:note-push`;
    if (notified[pushKey]) continue;
    const heading = it.title || strings.untitled;
    const preview = snippet(it.description, 140);
    notify(preview ? `${heading}\n${preview}` : heading, {
      title: `FlowDesk+ — ${strings.title}`,
      onClick: () => openNoteInWindow(it.id),
    });
    notified[pushKey] = Date.now();
    dirty = true;
  }

  if (dirty) writeJson(notifiedPath, notified);
}

let mainWindow;
let tray;
let notifyInterval;
app.isQuitting = false;

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    show,
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: THEME_BACKGROUNDS[getSettings().theme] || THEME_BACKGROUNDS.dark,
    autoHideMenuBar: true,
    icon: appIcons().window,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('close', (event) => {
    if (app.isQuitting) return;
    const s = getSettings();
    if (s.minimizeToTray) {
      event.preventDefault();
      lockAndHide();
    }
  });
}

// Tray menu labels, in the UI language; rebuilt whenever it changes.
const TRAY_STRINGS = {
  en: { open: 'Open FlowDesk+', lock: 'Lock', quit: 'Quit' },
  tr: { open: 'FlowDesk+ Aç', lock: 'Kilitle', quit: 'Çıkış' },
  de: { open: 'FlowDesk+ öffnen', lock: 'Sperren', quit: 'Beenden' },
  es: { open: 'Abrir FlowDesk+', lock: 'Bloquear', quit: 'Salir' },
  fr: { open: 'Ouvrir FlowDesk+', lock: 'Verrouiller', quit: 'Quitter' },
  'pt-BR': { open: 'Abrir FlowDesk+', lock: 'Bloquear', quit: 'Sair' },
  ja: { open: 'FlowDesk+ を開く', lock: 'ロック', quit: '終了' },
  'zh-CN': { open: '打开 FlowDesk+', lock: '锁定', quit: '退出' },
  ru: { open: 'Открыть FlowDesk+', lock: 'Заблокировать', quit: 'Выход' },
};

function buildTrayMenu(language) {
  if (!tray) return;
  const s = TRAY_STRINGS[language] || TRAY_STRINGS.en;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: s.open, click: () => showMainWindow() },
    { label: s.lock, click: () => lockAndHide() },
    { type: 'separator' },
    {
      label: s.quit,
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  if (tray) return;
  tray = new Tray(process.platform === 'win32' ? appIcons().window : appIconImage().resize({ width: 16, height: 16 }));
  tray.setToolTip('FlowDesk+');
  buildTrayMenu(getSettings().language);
  tray.on('click', () => {
    if (!mainWindow) return createWindow();
    mainWindow.isVisible() ? lockAndHide() : showMainWindow();
  });
}

function logCrash(err) {
  try {
    fs.writeFileSync(
      path.join(app.getPath('exe'), '..', 'crash.log'),
      String((err && err.stack) || err) + '\n'
    );
  } catch {}
}

process.on('uncaughtException', logCrash);

// Reminders only fire while FlowDesk+ is running, so by default it starts
// with Windows, straight into the tray (--hidden) without opening a window.
const LAUNCH_HIDDEN_ARG = '--hidden';
const startedHidden = process.argv.includes(LAUNCH_HIDDEN_ARG);

function applyLaunchAtStartup(settings) {
  if (isDev || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.launchAtStartup,
      path: process.execPath,
      args: [LAUNCH_HIDDEN_ARG],
    });
  } catch (e) {
    logCrash(e);
  }
}

// A second launch (e.g. desktop shortcut while already in the tray) just
// brings the existing window forward instead of starting a duplicate that
// would double every reminder.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  migrateLegacyData();
  ensureDataDir();
  app.setAppUserModelId('com.devilt.flowdeskplus');
  createWindow({ show: !startedHidden });
  createTray();

  applyLaunchAtStartup(getSettings());

  // First check shortly after launch, then every 30 seconds for as long as
  // the process is alive (kept alive in the tray between window closes), so
  // a note reminder fires within half a minute of its set time. Each run
  // just reads two small JSON files.
  const runCheck = () => { try { runNotificationChecks(); } catch (e) { logCrash(e); } };
  setTimeout(runCheck, 5000);
  notifyInterval = setInterval(runCheck, 30 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
}).catch(logCrash);

app.on('before-quit', () => {
  app.isQuitting = true;
  if (notifyInterval) clearInterval(notifyInterval);
});

app.on('window-all-closed', () => {
  // With "minimize to tray" on, closing the window just hides it (see the
  // mainWindow 'close' handler), so this only fires when tray mode is off
  // or the user chose Quit from the tray menu — either way, exit normally.
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Auth & session lock ----------

// The data store is only reachable while the session is unlocked: from a
// correct password until the window is closed to the tray (or the app is
// locked). The renderer's lock screen is just the UI on top of this, so
// data cannot be read from a locked app even via devtools.
let sessionUnlocked = false;
let lockTimer = null;

function lockSession() {
  sessionUnlocked = false;
  clearTimeout(lockTimer);
  pendingRestore = null;
  pendingEncrypted = null;
}

// Like ipcMain.handle, but refuses while the session is locked.
function handleUnlocked(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!sessionUnlocked) throw new Error('LOCKED');
    return fn(event, ...args);
  });
}

// Closing to the tray hides the window and locks the app. The renderer
// first gets a moment to save unsaved notebook text, then confirms with
// session:lock; if it does not answer, the session locks anyway.
function lockAndHide() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  if (!sessionUnlocked) return;
  mainWindow.webContents.send('app:lock');
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockSession, 3000);
}

ipcMain.handle('session:lock', () => {
  lockSession();
  return { ok: true };
});


ipcMain.handle('auth:status', () => {
  const cfg = getConfig();
  return { hasPassword: !!cfg.passwordHash };
});

ipcMain.handle('auth:setup', (_e, password) => {
  if (!password || password.length < 4) {
    return { ok: false, error: 'Şifre en az 4 karakter olmalı.' };
  }
  const cfg = getConfig();
  if (cfg.passwordHash) {
    return { ok: false, error: 'Şifre zaten belirlenmiş.' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  saveConfig({ passwordHash, salt });
  sessionUnlocked = true;
  return { ok: true };
});

ipcMain.handle('auth:login', (_e, password) => {
  const cfg = getConfig();
  if (!cfg.passwordHash) return { ok: false, error: 'Şifre kurulmamış.' };
  const hash = hashPassword(password || '', cfg.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(cfg.passwordHash, 'hex');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) sessionUnlocked = true;
  return ok ? { ok: true } : { ok: false, error: 'Şifre yanlış.' };
});

handleUnlocked('auth:changePassword', (_e, { current, next }) => {
  const cfg = getConfig();
  if (!cfg.passwordHash) return { ok: false, error: 'Şifre kurulmamış.' };
  const currentHash = hashPassword(current || '', cfg.salt);
  const a = Buffer.from(currentHash, 'hex');
  const b = Buffer.from(cfg.passwordHash, 'hex');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return { ok: false, error: 'Mevcut şifre yanlış.' };
  if (!next || next.length < 4) return { ok: false, error: 'Yeni şifre en az 4 karakter olmalı.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(next, salt);
  saveConfig({ passwordHash, salt });
  return { ok: true };
});

// ---------- Settings ----------

ipcMain.handle('settings:get', () => {
  return getSettings();
});

ipcMain.handle('settings:update', (_e, patch) => {
  const s = { ...getSettings(), ...patch };
  if (!UI_THEMES.includes(s.theme)) s.theme = DEFAULT_SETTINGS.theme;
  saveSettings(s);
  if (patch && 'launchAtStartup' in patch) applyLaunchAtStartup(s);
  if (patch && 'language' in patch) buildTrayMenu(s.language);
  if (patch && 'theme' in patch && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(THEME_BACKGROUNDS[s.theme]);
  }
  return { ok: true, settings: s };
});

// ---------- Licensing ----------

ipcMain.handle('license:status', () => {
  return { ...computeLicenseStatus(), purchaseUrl: GUMROAD_PURCHASE_URL };
});

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('license:activate', async (_e, licenseKey) => {
  const key = (licenseKey || '').trim();
  if (!key) return { ok: false, error: 'EMPTY' };
  const result = await verifyGumroadLicense(key);
  if (!result.ok) return { ok: false, error: result.error || 'INVALID' };
  saveLicense({ key, status: 'licensed', trialStartedAt: getLicense().trialStartedAt, verifiedAt: Date.now() });
  return { ok: true, status: computeLicenseStatus() };
});

// ---------- Export (CSV / PDF) ----------

handleUnlocked('export:csv', async (_e, { content, suggestedName }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export CSV',
    defaultPath: suggestedName || 'flowdesk-plus-report.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, content, 'utf-8');
  return { ok: true, path: res.filePath };
});

handleUnlocked('export:pdf', async (_e, { html, suggestedName }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export PDF',
    defaultPath: suggestedName || 'flowdesk-plus-report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };

  const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    fs.writeFileSync(res.filePath, pdfBuffer);
    return { ok: true, path: res.filePath };
  } finally {
    printWin.destroy();
  }
});

// ---------- Data ----------

handleUnlocked('data:get', () => {
  return getData();
});

// ----- Themes -----

handleUnlocked('theme:create', (_e, { name, type }) => {
  const d = getData();
  const theme = {
    id: makeId(),
    name: (name || 'New Theme').trim(),
    type: type === 'payments' ? 'payments' : 'notes',
    order: nextOrder(d.themes),
    createdAt: Date.now(),
  };
  d.themes.push(theme);
  saveData(d);
  return theme;
});

handleUnlocked('theme:update', (_e, { id, name }) => {
  const d = getData();
  const t = d.themes.find((x) => x.id === id);
  if (!t) return { ok: false };
  if (typeof name === 'string' && name.trim()) t.name = name.trim();
  saveData(d);
  return { ok: true, theme: t };
});

handleUnlocked('theme:delete', (_e, { id }) => {
  const d = getData();
  d.themes = d.themes.filter((x) => x.id !== id);
  d.items = d.items.filter((x) => x.themeId !== id);
  saveData(d);
  return { ok: true };
});

handleUnlocked('theme:reorder', (_e, { orderedIds }) => {
  const d = getData();
  orderedIds.forEach((id, idx) => {
    const t = d.themes.find((x) => x.id === id);
    if (t) t.order = idx;
  });
  saveData(d);
  return { ok: true };
});

// ----- Items -----

handleUnlocked('item:create', (_e, payload) => {
  const d = getData();
  const siblings = d.items.filter((x) => x.themeId === payload.themeId);
  const item = {
    id: makeId(),
    createdAt: Date.now(),
    order: nextOrder(siblings),
    done: false,
    paid: false,
    ...payload,
  };
  d.items.push(item);
  saveData(d);
  return item;
});

handleUnlocked('item:update', (_e, { id, patch }) => {
  const d = getData();
  const it = d.items.find((x) => x.id === id);
  if (!it) return { ok: false };
  Object.assign(it, patch);
  saveData(d);
  return { ok: true, item: it };
});

handleUnlocked('item:delete', (_e, { id }) => {
  const d = getData();
  d.items = d.items.filter((x) => x.id !== id);
  saveData(d);
  return { ok: true };
});

handleUnlocked('item:reorder', (_e, { themeId, orderedIds }) => {
  const d = getData();
  orderedIds.forEach((id, idx) => {
    const it = d.items.find((x) => x.id === id && x.themeId === themeId);
    if (it) it.order = idx;
  });
  saveData(d);
  return { ok: true };
});

// ----- Notebook (standalone notepad notes) -----

handleUnlocked('notebook:create', (_e, { title, content } = {}) => {
  const d = getData();
  const now = Date.now();
  const note = { id: makeId(), title: String(title || ''), content: String(content || ''), createdAt: now, updatedAt: now };
  d.notebook.push(note);
  saveData(d);
  return note;
});

handleUnlocked('notebook:update', (_e, { id, patch } = {}) => {
  const d = getData();
  const note = d.notebook.find((n) => n.id === id);
  if (!note) return { ok: false };
  const title = typeof patch?.title === 'string' ? patch.title : note.title;
  const content = typeof patch?.content === 'string' ? patch.content : note.content;
  // Only a real change moves "last modified", like a file on disk.
  if (title !== note.title || content !== note.content) {
    Object.assign(note, { title, content, updatedAt: Date.now() });
    saveData(d);
  }
  return { ok: true, note };
});

handleUnlocked('notebook:delete', (_e, { id } = {}) => {
  const d = getData();
  d.notebook = d.notebook.filter((n) => n.id !== id);
  saveData(d);
  return { ok: true };
});

handleUnlocked('export:note', async (_e, { content, suggestedName, format } = {}) => {
  const isMd = format === 'md';
  const res = await dialog.showSaveDialog(mainWindow, {
    title: isMd ? 'Export Markdown' : 'Export Text',
    defaultPath: path.join(app.getPath('documents'), path.basename(String(suggestedName || (isMd ? 'note.md' : 'note.txt')))),
    filters: isMd
      ? [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }]
      : [{ name: 'Text', extensions: ['txt'] }, { name: 'Markdown', extensions: ['md'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  // Windows line endings so the file reads correctly in Notepad too.
  fs.writeFileSync(res.filePath, String(content || '').replace(/\r?\n/g, '\r\n'), 'utf-8');
  return { ok: true, path: res.filePath };
});

// ----- Full backup / restore -----
//
// A backup is one JSON file holding everything in data.json: themes,
// payments & subscriptions, reminders, categories and notebook notes.
// The password (config.json) and license are deliberately left out.

const BACKUP_FORMAT = 'flowdesk-backup';
const BACKUP_VERSION = 1;
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const backupsDir = path.join(dataDir, 'backups');
let pendingRestore = null; // validated data waiting for the user's confirmation
let pendingEncrypted = null; // an encrypted backup waiting for its password

// Encrypted backups (.flow): the plain backup JSON sealed with AES-256-GCM
// under a key derived from the user's backup password with scrypt. GCM's
// auth tag makes a wrong password (or a tampered file) fail cleanly.
const ENC_FORMAT = 'flowdesk-backup-encrypted';
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function encryptBackup(backup, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(backup), 'utf8'), cipher.final()]);
  return {
    format: ENC_FORMAT,
    version: 1,
    app: 'FlowDesk',
    exportedAt: backup.exportedAt,
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptBackup(env, password) {
  if (!env || env.cipher !== 'aes-256-gcm' || !env.kdf || env.kdf.name !== 'scrypt') throw new Error('NOT_BACKUP');
  const params = { N: Number(env.kdf.N), r: Number(env.kdf.r), p: Number(env.kdf.p), maxmem: SCRYPT.maxmem };
  if (!(params.N > 1 && params.N <= 1 << 20 && params.r > 0 && params.r <= 16 && params.p > 0 && params.p <= 4)) throw new Error('NOT_BACKUP');
  const key = crypto.scryptSync(String(password || ''), Buffer.from(env.kdf.salt, 'base64'), 32, params);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('BAD_PASSWORD');
  }
}

function restorePreview(raw, fileName) {
  const meta = (() => { try { return JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { return {}; } })();
  const { data, skipped } = parseBackup(raw);
  pendingRestore = { data };
  return {
    ok: true,
    fileName,
    exportedAt: meta.exportedAt || null,
    summary: summarizeData(data),
    current: summarizeData(getData()),
    skipped,
  };
}

function isSubscriptionItem(it) {
  return it.type === 'payments' && ['monthly', 'weekly', 'yearly'].includes(it.periodType);
}

function summarizeData(d) {
  const payments = d.items.filter((x) => x.type === 'payments');
  return {
    themes: d.themes.length,
    payments: payments.filter((x) => !isSubscriptionItem(x)).length,
    subscriptions: payments.filter(isSubscriptionItem).length,
    reminders: d.items.filter((x) => x.type !== 'payments').length,
    notes: d.notebook.length,
    categories: d.categories.length,
  };
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const hasId = (x) => isObj(x) && typeof x.id === 'string' && x.id.length > 0;

// Accepts a FlowDesk backup file, or a raw data.json copied by hand.
// Returns clean data, or throws with a short error code.
function parseBackup(raw) {
  let json;
  try {
    json = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    throw new Error('NOT_JSON');
  }
  const src = isObj(json) && json.format === BACKUP_FORMAT ? json.data : json;
  if (isObj(json) && json.format === BACKUP_FORMAT && Number(json.version) > BACKUP_VERSION) throw new Error('NEWER_VERSION');
  if (!isObj(src) || !Array.isArray(src.themes) || !Array.isArray(src.items)) throw new Error('NOT_BACKUP');

  const themes = src.themes.filter(hasId).map((t) => ({ ...t, type: t.type === 'payments' ? 'payments' : 'notes' }));
  const themeIds = new Set(themes.map((t) => t.id));
  // Items whose theme is missing would be invisible in the app; skip them.
  const items = src.items.filter((it) => hasId(it) && themeIds.has(it.themeId));
  const categories = (Array.isArray(src.categories) ? src.categories : []).filter((c) => hasId(c) && typeof c.name === 'string');
  const notebook = (Array.isArray(src.notebook) ? src.notebook : []).filter(hasId).map((n) => ({
    ...n,
    title: String(n.title || ''),
    content: String(n.content || ''),
    createdAt: Number(n.createdAt) || Date.now(),
    updatedAt: Number(n.updatedAt) || Number(n.createdAt) || Date.now(),
  }));
  return {
    data: { themes, items, categories, notebook },
    skipped: (src.items.length - items.length) + (src.themes.length - themes.length),
  };
}

function writeSafetyBackup(reason) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupsDir, `auto-${reason}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(buildBackup(getData()), null, 2), 'utf-8');
  // Keep only the 10 most recent automatic backups.
  const autos = fs.readdirSync(backupsDir).filter((f) => f.startsWith('auto-')).sort();
  autos.slice(0, Math.max(0, autos.length - 10)).forEach((f) => {
    try { fs.unlinkSync(path.join(backupsDir, f)); } catch {}
  });
  return file;
}

function buildBackup(d) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: 'FlowDesk',
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    summary: summarizeData(d),
    data: { themes: d.themes, items: d.items, categories: d.categories, notebook: d.notebook },
  };
}

// Restored reminders whose time has already passed must not all fire at
// once on the next check, so they are marked as notified up front.
function markPastRemindersNotified(items) {
  const notified = readJson(notifiedPath, {});
  const now = Date.now();
  items.forEach((it) => {
    if (it.type !== 'payments' && it.reminderAt && new Date(it.reminderAt).getTime() <= now) {
      notified[`${it.id}:${it.reminderAt}:note-push`] = now;
    }
  });
  writeJson(notifiedPath, notified);
}

// Backup-wins merge by id: matching records are replaced, new ones added.
function mergeById(current, incoming) {
  const map = new Map(current.map((x) => [x.id, x]));
  incoming.forEach((x) => map.set(x.id, x));
  return [...map.values()];
}

handleUnlocked('backup:export', async (_e, { format, password } = {}) => {
  const encrypted = format === 'flow';
  if (encrypted && String(password || '').length < 4) return { ok: false, error: 'WEAK_PASSWORD' };
  const d = getData();
  const day = new Date().toISOString().slice(0, 10);
  const ext = encrypted ? 'flow' : 'json';
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'FlowDesk',
    defaultPath: path.join(app.getPath('documents'), `FlowDesk-backup-${day}.${ext}`),
    filters: [encrypted ? { name: 'FlowDesk encrypted backup', extensions: ['flow'] } : { name: 'FlowDesk backup', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const backup = buildBackup(d);
  fs.writeFileSync(res.filePath, JSON.stringify(encrypted ? encryptBackup(backup, password) : backup, null, 2), 'utf-8');
  return { ok: true, path: res.filePath, encrypted, summary: summarizeData(d) };
});

handleUnlocked('backup:pick', async () => {
  pendingRestore = null;
  pendingEncrypted = null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'FlowDesk',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'FlowDesk backup', extensions: ['flow', 'json'] }],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const file = res.filePaths[0];
  try {
    if (fs.statSync(file).size > BACKUP_MAX_BYTES) throw new Error('TOO_LARGE');
    const raw = fs.readFileSync(file, 'utf-8');
    let meta = null;
    try { meta = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch {}
    if (meta && meta.format === ENC_FORMAT) {
      if (Number(meta.version) > 1) throw new Error('NEWER_VERSION');
      pendingEncrypted = { env: meta, fileName: path.basename(file) };
      return { ok: false, needsPassword: true, fileName: path.basename(file), exportedAt: meta.exportedAt || null };
    }
    return restorePreview(raw, path.basename(file));
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'NOT_BACKUP' };
  }
});

// Unlocks a picked .flow file; a wrong password keeps it pending for retry.
handleUnlocked('backup:decrypt', (_e, { password } = {}) => {
  if (!pendingEncrypted) return { ok: false, error: 'NOTHING_PENDING' };
  try {
    const raw = decryptBackup(pendingEncrypted.env, password);
    const preview = restorePreview(raw, pendingEncrypted.fileName);
    pendingEncrypted = null;
    return preview;
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'NOT_BACKUP' };
  }
});

handleUnlocked('backup:apply', (_e, { mode } = {}) => {
  if (!pendingRestore) return { ok: false, error: 'NOTHING_PENDING' };
  const incoming = pendingRestore.data;
  pendingRestore = null;
  const safetyFile = writeSafetyBackup('before-restore');
  let next;
  if (mode === 'merge') {
    const cur = getData();
    next = {
      themes: mergeById(cur.themes, incoming.themes),
      items: mergeById(cur.items, incoming.items),
      categories: mergeById(cur.categories, incoming.categories),
      notebook: mergeById(cur.notebook, incoming.notebook),
    };
  } else {
    next = incoming;
  }
  saveData(next);
  markPastRemindersNotified(incoming.items);
  return { ok: true, summary: summarizeData(next), safetyFile };
});

handleUnlocked('backup:cancel', () => {
  pendingRestore = null;
  pendingEncrypted = null;
  return { ok: true };
});

// ----- Payment categories -----

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

handleUnlocked('category:create', (_e, { name, color }) => {
  const d = getData();
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false };
  const existing = d.categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return { ok: true, category: existing };
  const category = { id: makeId(), name: trimmed, color: HEX_COLOR.test(color) ? color.toLowerCase() : null };
  d.categories.push(category);
  saveData(d);
  return { ok: true, category };
});

handleUnlocked('category:update', (_e, { id, patch }) => {
  const d = getData();
  const cat = d.categories.find((c) => c.id === id);
  if (!cat) return { ok: false };
  if (patch && HEX_COLOR.test(patch.color)) cat.color = patch.color.toLowerCase();
  saveData(d);
  return { ok: true, category: cat };
});

handleUnlocked('category:delete', (_e, { id }) => {
  const d = getData();
  d.categories = d.categories.filter((c) => c.id !== id);
  d.items.forEach((it) => {
    if (it.categoryId === id) it.categoryId = null;
  });
  saveData(d);
  return { ok: true };
});
