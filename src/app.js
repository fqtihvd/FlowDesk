'use strict';

/* -------------------------------------------------------------------
 * Browser-preview fallback: if this file is opened outside Electron
 * (no window.api from preload.js), fake the same API with
 * localStorage so the UI can still be exercised in a plain browser.
 * ------------------------------------------------------------------- */
if (!window.api) {
  const LS_DATA = '__preview_data__';
  const LS_CFG = '__preview_cfg__';
  const LS_SETTINGS = '__preview_settings__';
  const readLS = (k, fb) => JSON.parse(localStorage.getItem(k) || 'null') || fb;
  const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const id = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const nextOrder = (list) => (list.length ? Math.max(...list.map((x) => x.order ?? 0)) + 1 : 0);
  const emptyData = () => ({ themes: [], items: [], categories: [], notebook: [] });
  const readData = () => {
    const d = readLS(LS_DATA, emptyData());
    if (!Array.isArray(d.categories)) d.categories = [];
    if (!Array.isArray(d.notebook)) d.notebook = [];
    return d;
  };

  window.api = {
    async authStatus() {
      const cfg = readLS(LS_CFG, { passwordHash: null });
      return { hasPassword: !!cfg.passwordHash };
    },
    async authSetup(password) {
      if (!password || password.length < 4) return { ok: false, error: 'SHORT' };
      writeLS(LS_CFG, { passwordHash: password });
      return { ok: true };
    },
    async authLogin(password) {
      const cfg = readLS(LS_CFG, { passwordHash: null });
      return cfg.passwordHash === password ? { ok: true } : { ok: false, error: 'WRONG' };
    },
    async authChangePassword(current, next) {
      const cfg = readLS(LS_CFG, { passwordHash: null });
      if (cfg.passwordHash !== current) return { ok: false, error: 'CURRENT_WRONG' };
      writeLS(LS_CFG, { passwordHash: next });
      return { ok: true };
    },
    async getData() {
      return readData();
    },
    async createTheme(name, type) {
      const d = readData();
      const t = { id: id(), name: (name || 'New Theme').trim(), type: type === 'payments' ? 'payments' : 'notes', order: nextOrder(d.themes), createdAt: Date.now() };
      d.themes.push(t); writeLS(LS_DATA, d); return t;
    },
    async updateTheme(tid, name) {
      const d = readData();
      const t = d.themes.find((x) => x.id === tid);
      if (t && name && name.trim()) t.name = name.trim();
      writeLS(LS_DATA, d); return { ok: true, theme: t };
    },
    async deleteTheme(tid) {
      const d = readData();
      d.themes = d.themes.filter((x) => x.id !== tid);
      d.items = d.items.filter((x) => x.themeId !== tid);
      writeLS(LS_DATA, d); return { ok: true };
    },
    async reorderThemes(orderedIds) {
      const d = readData();
      orderedIds.forEach((tid, idx) => { const t = d.themes.find((x) => x.id === tid); if (t) t.order = idx; });
      writeLS(LS_DATA, d); return { ok: true };
    },
    async createItem(payload) {
      const d = readData();
      const siblings = d.items.filter((x) => x.themeId === payload.themeId);
      const it = { id: id(), createdAt: Date.now(), order: nextOrder(siblings), done: false, paid: false, ...payload };
      d.items.push(it); writeLS(LS_DATA, d); return it;
    },
    async updateItem(iid, patch) {
      const d = readData();
      const it = d.items.find((x) => x.id === iid);
      if (it) Object.assign(it, patch);
      writeLS(LS_DATA, d); return { ok: true, item: it };
    },
    async deleteItem(iid) {
      const d = readData();
      d.items = d.items.filter((x) => x.id !== iid);
      writeLS(LS_DATA, d); return { ok: true };
    },
    async reorderItems(themeId, orderedIds) {
      const d = readData();
      orderedIds.forEach((iid, idx) => { const it = d.items.find((x) => x.id === iid && x.themeId === themeId); if (it) it.order = idx; });
      writeLS(LS_DATA, d); return { ok: true };
    },
    async createCategory(name, color) {
      const d = readData();
      const trimmed = (name || '').trim();
      if (!trimmed) return { ok: false };
      const existing = d.categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) return { ok: true, category: existing };
      const category = { id: id(), name: trimmed, color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null };
      d.categories.push(category);
      writeLS(LS_DATA, d); return { ok: true, category };
    },
    async updateCategory(cid, patch) {
      const d = readData();
      const cat = d.categories.find((c) => c.id === cid);
      if (!cat) return { ok: false };
      if (patch && /^#[0-9a-f]{6}$/i.test(patch.color)) cat.color = patch.color.toLowerCase();
      writeLS(LS_DATA, d); return { ok: true, category: cat };
    },
    async deleteCategory(cid) {
      const d = readData();
      d.categories = d.categories.filter((c) => c.id !== cid);
      d.items.forEach((it) => { if (it.categoryId === cid) it.categoryId = null; });
      writeLS(LS_DATA, d); return { ok: true };
    },
    async getSettings() {
      const stored = readLS(LS_SETTINGS, {});
      return { language: 'en', currency: '$', minimizeToTray: true, theme: 'dark', ...stored };

    },
    async updateSettings(patch) {
      const s = { ...(await this.getSettings()), ...patch };
      writeLS(LS_SETTINGS, s);
      return { ok: true, settings: s };
    },

    async getLicenseStatus() {
      // Browser preview has no real Gumroad/main-process access — always
      // report a full trial so the UI can still be exercised.
      return { status: 'trial', daysLeft: 7, key: null, purchaseUrl: '#' };
    },
    async activateLicense() {
      return { ok: false, error: 'PREVIEW_MODE' };
    },
    async exportCsv(content, suggestedName) {
      const blob = new Blob([content], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = suggestedName || 'report.csv';
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, path: suggestedName };
    },
    async exportPdf() {
      return { ok: false, error: 'PREVIEW_MODE' };
    },
    async createNote({ title, content }) {
      const d = readData();
      const now = Date.now();
      const note = { id: id(), title: title || '', content: content || '', createdAt: now, updatedAt: now };
      d.notebook.push(note); writeLS(LS_DATA, d); return note;
    },
    async updateNote(nid, patch) {
      const d = readData();
      const note = d.notebook.find((n) => n.id === nid);
      if (!note) return { ok: false };
      if (note.title !== patch.title || note.content !== patch.content) {
        Object.assign(note, { title: patch.title, content: patch.content, updatedAt: Date.now() });
      }
      writeLS(LS_DATA, d); return { ok: true, note };
    },
    async deleteNote(nid) {
      const d = readData();
      d.notebook = d.notebook.filter((n) => n.id !== nid);
      writeLS(LS_DATA, d); return { ok: true };
    },
    async exportNote(content, suggestedName) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, path: suggestedName };
    },
    async exportBackup() {
      const d = readData();
      const blob = new Blob([JSON.stringify({ format: 'flowdesk-backup', version: 1, exportedAt: new Date().toISOString(), data: d }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'FlowDesk-backup.json'; a.click();
      URL.revokeObjectURL(url);
      return { ok: true, path: 'FlowDesk-backup.json' };
    },
    async pickBackup() {
      const file = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json';
        input.onchange = () => resolve(input.files[0] || null);
        input.click();
      });
      if (!file) return { ok: false, canceled: true };
      let json;
      try { json = JSON.parse(await file.text()); } catch { return { ok: false, error: 'NOT_JSON' }; }
      const src = json && json.format === 'flowdesk-backup' ? json.data : json;
      if (!src || !Array.isArray(src.themes) || !Array.isArray(src.items)) return { ok: false, error: 'NOT_BACKUP' };
      const data = { themes: src.themes, items: src.items, categories: src.categories || [], notebook: src.notebook || [] };
      window.__pendingRestore = data;
      const sum = (x) => ({ themes: x.themes.length, payments: x.items.filter((i) => i.type === 'payments' && !['monthly', 'weekly', 'yearly'].includes(i.periodType)).length, subscriptions: x.items.filter((i) => i.type === 'payments' && ['monthly', 'weekly', 'yearly'].includes(i.periodType)).length, reminders: x.items.filter((i) => i.type !== 'payments').length, notes: x.notebook.length, categories: x.categories.length });
      return { ok: true, fileName: file.name, exportedAt: json.exportedAt || null, summary: sum(data), current: sum(readData()), skipped: 0 };
    },
    async applyBackup(mode) {
      const inc = window.__pendingRestore;
      if (!inc) return { ok: false, error: 'NOTHING_PENDING' };
      window.__pendingRestore = null;
      const merge = (a, b) => { const m = new Map(a.map((x) => [x.id, x])); b.forEach((x) => m.set(x.id, x)); return [...m.values()]; };
      const cur = readData();
      const next = mode === 'merge'
        ? { themes: merge(cur.themes, inc.themes), items: merge(cur.items, inc.items), categories: merge(cur.categories, inc.categories), notebook: merge(cur.notebook, inc.notebook) }
        : inc;
      writeLS(LS_DATA, next);
      const subs = next.items.filter((i) => i.type === 'payments' && ['monthly', 'weekly', 'yearly'].includes(i.periodType)).length;
      return { ok: true, summary: { themes: next.themes.length, payments: next.items.filter((i) => i.type === 'payments').length - subs, subscriptions: subs, reminders: next.items.filter((i) => i.type !== 'payments').length, notes: next.notebook.length, categories: next.categories.length } };
    },
    async decryptBackup() {
      return { ok: false, error: 'BAD_PASSWORD' };
    },
    async lockSession() {
      return { ok: true };
    },
    async cancelBackup() {
      window.__pendingRestore = null;
      return { ok: true };
    },
    async openExternal(url) {
      window.open(url, '_blank');
      return { ok: true };
    },
  };
}

/* -------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------- */
const state = {
  data: { themes: [], items: [], categories: [], notebook: [] },
  settings: { language: window.i18n.DEFAULT_LANGUAGE, currency: window.i18n.DEFAULT_CURRENCY, minimizeToTray: true },
  currentThemeId: null,
  editingThemeId: null, // for modal-theme in edit mode
  editingItemId: null,  // for the notebook screen / modal-payment in edit mode
  pendingDelete: null,  // { type: 'theme'|'item'|'category', id }
  timeFilter: 'all',    // 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear'
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const t = (key, params) => window.i18n.t(key, params);
const formatMoney = (n) => window.i18n.formatMoney(n, state.settings.currency);
const formatDate = (d) => window.i18n.formatDate(d);
const formatDateTime = (d) => window.i18n.formatDateTime(d);

function showScreen(name) {
  ['screen-auth', 'screen-license', 'screen-home', 'screen-theme', 'screen-notebook', 'screen-notepad'].forEach((id) => {
    $('#' + id).classList.toggle('hidden', id !== name);
  });
}

function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }

/* -------------------------------------------------------------------
 * Time filter — filters payment items by their startDate for the home
 * dashboard and the payments list, without touching stored data.
 * ------------------------------------------------------------------- */
const TIME_FILTERS = ['all', 'thisMonth', 'lastMonth', 'last3Months', 'thisYear'];

function isInTimeRange(item, filter) {
  if (filter === 'all') return true;
  if (!item.startDate) return false;
  const d = new Date(item.startDate + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();

  if (filter === 'thisMonth') return d.getFullYear() === y && d.getMonth() === m;
  if (filter === 'lastMonth') {
    const lm = new Date(y, m - 1, 1);
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
  }
  if (filter === 'last3Months') {
    const start = new Date(y, m - 2, 1);
    const end = new Date(y, m + 1, 0);
    return d >= start && d <= end;
  }
  if (filter === 'thisYear') return d.getFullYear() === y;
  return true;
}

function populateTimeFilterSelect(select) {
  select.innerHTML = '';
  TIME_FILTERS.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = t(`timeFilter.${f}`);
    select.appendChild(opt);
  });
  select.value = state.timeFilter;
}

/* -------------------------------------------------------------------
 * Auth error mapping (main process returns short codes for the
 * browser-preview shim; the real Electron API returns Turkish-original
 * messages we no longer want to show verbatim, so we re-map by pattern).
 * ------------------------------------------------------------------- */
function authErrorKey(rawError) {
  const map = {
    'Şifre en az 4 karakter olmalı.': 'auth.errorShort',
    'Şifre zaten belirlenmiş.': 'auth.errorAlreadySet',
    'Şifre kurulmamış.': 'auth.errorNotSet',
    'Şifre yanlış.': 'auth.errorWrong',
    'Mevcut şifre yanlış.': 'auth.errorCurrentWrong',
    'Yeni şifre en az 4 karakter olmalı.': 'auth.errorNewShort',
    SHORT: 'auth.errorShort',
    WRONG: 'auth.errorWrong',
    CURRENT_WRONG: 'auth.errorCurrentWrong',
  };
  return map[rawError] || 'auth.errorWrong';
}

/* -------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------- */
async function initAuth() {
  const { hasPassword } = await window.api.authStatus();
  const form = $('#auth-form');
  const pwd = $('#auth-password');
  const pwd2 = $('#auth-password-confirm');
  const subtitle = $('#auth-subtitle');
  const submit = $('#auth-submit');
  const errorEl = $('#auth-error');

  if (!hasPassword) {
    subtitle.textContent = t('auth.setupSubtitle');
    pwd.placeholder = t('auth.newPasswordPlaceholder');
    pwd2.classList.remove('hidden');
    submit.textContent = t('auth.setupSubmit');
  } else {
    subtitle.textContent = t('auth.loginSubtitle');
    pwd.placeholder = t('auth.passwordPlaceholder');
    pwd2.classList.add('hidden');
    submit.textContent = t('auth.loginSubmit');
  }
  errorEl.classList.add('hidden');
  pwd.value = '';
  pwd2.value = '';

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    if (!hasPassword) {
      if (pwd.value !== pwd2.value) {
        errorEl.textContent = t('auth.errorMismatch');
        errorEl.classList.remove('hidden');
        return;
      }
      const res = await window.api.authSetup(pwd.value);
      if (!res.ok) {
        errorEl.textContent = t(authErrorKey(res.error));
        errorEl.classList.remove('hidden');
        return;
      }
      await bootApp();
    } else {
      const res = await window.api.authLogin(pwd.value);
      if (!res.ok) {
        errorEl.textContent = t(authErrorKey(res.error));
        errorEl.classList.remove('hidden');
        return;
      }
      await bootApp();
    }
  };

  pwd.focus();
}

/* -------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------- */
async function loadSettingsAndLocale() {
  state.settings = await window.api.getSettings();
  await window.i18n.loadLocale(state.settings.language);
  window.i18n.applyStaticTranslations();
  populateSettingsModalOptions();
}

async function bootApp() {
  await loadSettingsAndLocale();
  state.data = await window.api.getData();
  await ensureCategoryColors();
  const shownLock = await maybeShowLicenseScreen();
  if (shownLock) return;
  showScreen('screen-home');
  renderHome();
  if (pendingNoteToOpen) {
    const itemId = pendingNoteToOpen;
    pendingNoteToOpen = null;
    openNoteById(itemId);
  }
}

async function refreshData() {
  state.data = await window.api.getData();
}

// Returns true if the license-lock screen was shown (trial expired, no
// valid key) — the caller should stop and not proceed to the home screen.
async function maybeShowLicenseScreen() {
  const info = await window.api.getLicenseStatus();
  updateTrialBanner(info);
  if (info.status === 'expired') {
    showScreen('screen-license');
    $('#license-key-input').value = '';
    $('#license-error').classList.add('hidden');
    return true;
  }
  return false;
}

function updateTrialBanner(info) {
  const banner = $('#trial-banner');
  if (info.status === 'trial') {
    banner.textContent = t('trialBanner.template', { days: info.daysLeft });
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

$('#trial-banner').onclick = (e) => {
  e.preventDefault();
  populateSettingsModalOptions();
  refreshLicenseSection();
  $('#settings-license-key').value = '';
  $('#settings-license-msg').className = 'hidden';
  openModal('modal-settings');
};

$('#license-activate-btn').onclick = async () => {
  const key = $('#license-key-input').value.trim();
  const errorEl = $('#license-error');
  errorEl.classList.add('hidden');
  if (!key) return;
  const res = await window.api.activateLicense(key);
  if (!res.ok) {
    errorEl.textContent = t('licenseLock.error');
    errorEl.classList.remove('hidden');
    return;
  }
  showScreen('screen-home');
  updateTrialBanner(res.status);
  renderHome();
};

$('#license-purchase-btn').onclick = async () => {
  const info = await window.api.getLicenseStatus();
  if (info.purchaseUrl) window.api.openExternal(info.purchaseUrl);
};

/* -------------------------------------------------------------------
 * Settings modal (language + currency)
 * ------------------------------------------------------------------- */
function populateSettingsModalOptions() {
  const langSelect = $('#settings-language');
  langSelect.innerHTML = '';
  window.i18n.SUPPORTED_LANGUAGES.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.name;
    langSelect.appendChild(opt);
  });
  langSelect.value = state.settings.language;

  const curSelect = $('#settings-currency');
  curSelect.innerHTML = '';
  window.i18n.SUPPORTED_CURRENCIES.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.symbol;
    opt.textContent = `${c.symbol} (${c.code})`;
    curSelect.appendChild(opt);
  });
  curSelect.value = state.settings.currency;

  $('#settings-tray').checked = state.settings.minimizeToTray !== false;
  $('#settings-startup').checked = state.settings.launchAtStartup !== false;

  renderThemeSwitches();
}


async function refreshLicenseSection() {
  const info = await window.api.getLicenseStatus();
  const statusEl = $('#settings-license-status');
  statusEl.className = 'license-status ' + info.status;
  if (info.status === 'dev') {
    statusEl.textContent = t('settingsModal.licenseStatusDev');
  } else if (info.status === 'licensed') {
    statusEl.textContent = t('settingsModal.licenseStatusLicensed');
  } else if (info.status === 'trial') {
    statusEl.textContent = t('settingsModal.licenseStatusTrial', { days: info.daysLeft });
  } else {
    statusEl.textContent = t('settingsModal.licenseStatusExpired');
  }
  const noKeyNeeded = info.status === 'licensed' || info.status === 'dev';
  $('#settings-license-key').classList.toggle('hidden', noKeyNeeded);
  $('#settings-license-activate').classList.toggle('hidden', noKeyNeeded);
  $('#settings-purchase-link').classList.toggle('hidden', noKeyNeeded);
  return info;
}

async function rerenderCurrentScreen() {
  if (state.currentThemeId) {
    renderThemeDetail();
  } else if (!$('#screen-home').classList.contains('hidden')) {
    renderHome();
  } else if (!$('#screen-notebook').classList.contains('hidden')) {
    renderNotebookList();
  }
}

$('#btn-settings').onclick = () => {
  populateSettingsModalOptions();
  refreshLicenseSection();
  $('#settings-license-key').value = '';
  $('#settings-license-msg').className = 'hidden';
  openModal('modal-settings');
};

$('#settings-language').addEventListener('change', async (e) => {
  const language = e.target.value;
  await window.api.updateSettings({ language });
  state.settings.language = language;
  await window.i18n.loadLocale(language);
  window.i18n.applyStaticTranslations();
  populateSettingsModalOptions();
  await rerenderCurrentScreen();
});

$('#settings-currency').addEventListener('change', async (e) => {
  const currency = e.target.value;
  await window.api.updateSettings({ currency });
  state.settings.currency = currency;
  await rerenderCurrentScreen();
});

$('#settings-tray').addEventListener('change', async (e) => {
  const minimizeToTray = e.target.checked;
  await window.api.updateSettings({ minimizeToTray });
  state.settings.minimizeToTray = minimizeToTray;
});

$('#settings-startup').addEventListener('change', async (e) => {
  const launchAtStartup = e.target.checked;
  await window.api.updateSettings({ launchAtStartup });
  state.settings.launchAtStartup = launchAtStartup;
});

$('#settings-license-activate').onclick = async () => {
  const key = $('#settings-license-key').value.trim();
  const msg = $('#settings-license-msg');
  if (!key) return;
  const res = await window.api.activateLicense(key);
  if (res.ok) {
    msg.textContent = t('settingsModal.licenseActivated');
    msg.className = 'success';
    $('#settings-license-key').value = '';
    await refreshLicenseSection();
    await maybeShowLicenseScreen();
  } else {
    msg.textContent = t('settingsModal.licenseInvalid');
    msg.className = 'error';
  }
};

$('#settings-purchase-link').onclick = async () => {
  const info = await window.api.getLicenseStatus();
  if (info.purchaseUrl) window.api.openExternal(info.purchaseUrl);
};

$('#home-time-filter').addEventListener('change', async (e) => {
  state.timeFilter = e.target.value;
  renderHome();
});

$('#theme-time-filter').addEventListener('change', async (e) => {
  state.timeFilter = e.target.value;
  renderThemeDetail();
});

$('#modal-settings-close').onclick = () => closeModal('modal-settings');

/* -------------------------------------------------------------------
 * Home screen — theme cards
 * ------------------------------------------------------------------- */
function sortedThemes() {
  return [...state.data.themes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function themeStats(themeId) {
  const items = state.data.items.filter((x) => x.themeId === themeId);
  return items;
}

/* -------------------------------------------------------------------
 * Category colors — every category owns one color. The picker, the donut
 * chart and the payment badges all read it from the category, and two
 * categories can never hold the same (or a near-identical) color.
 * ------------------------------------------------------------------- */
// First 8 are the validated dark-surface series colors; the rest extend the
// palette. Pairwise RGB distance stays above COLOR_MIN_DISTANCE so every
// swatch is selectable in an empty workspace.
const CATEGORY_PALETTE = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
  '#2bb8c9', '#a3b81f', '#b45fd1', '#8f9aa8', '#c4703c', '#e08fb8', '#5a6fd6', '#6ec6a0',
];
const COLOR_MIN_DISTANCE = 30;
const DONUT_OTHER_COLOR = 'var(--series-other)';
const DONUT_MAX_SLICES = 7; // beyond this, the tail folds into "Other"

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

// The category (other than `excludeId`) whose color equals or is too close
// to `hex`, or null when the color is free to use.
function findColorConflict(hex, excludeId) {
  return state.data.categories.find(
    (c) => c.id !== excludeId && c.color && colorDistance(c.color, hex) < COLOR_MIN_DISTANCE
  ) || null;
}

// Next color not clashing with any category color or `extraUsed`. Uses the
// palette first, then walks the hue wheel (golden angle) over several
// saturation/lightness rings. If even that is exhausted (dozens of
// categories), returns the candidate farthest from everything already used.
function nextFreeColor(extraUsed = []) {
  const taken = [...state.data.categories.map((c) => c.color).filter(Boolean), ...extraUsed];
  const gap = (hex) => Math.min(...taken.map((u) => colorDistance(u, hex)), Infinity);
  const fromPalette = CATEGORY_PALETTE.find((hex) => gap(hex) >= COLOR_MIN_DISTANCE);
  if (fromPalette) return fromPalette;

  let best = null;
  let bestGap = -1;
  for (const [s, l] of [[0.6, 0.6], [0.75, 0.45], [0.5, 0.75], [0.4, 0.5], [0.85, 0.65]]) {
    for (let i = 0; i < 90; i++) {
      const hex = hslToHex((i * 137.508) % 360, s, l);
      const g = gap(hex);
      if (g >= COLOR_MIN_DISTANCE) return hex;
      if (g > bestGap) { best = hex; bestGap = g; }
    }
  }
  return best;
}

// Categories created before colors existed get one assigned once, in order.
async function ensureCategoryColors() {
  for (const cat of state.data.categories) {
    if (cat.color) continue;
    cat.color = nextFreeColor();
    await window.api.updateCategory(cat.id, { color: cat.color });
  }
}

function allPaymentItems() {
  return state.data.items.filter((x) => x.type === 'payments');
}

function categoryOf(item) {
  return state.data.categories.find((c) => c.id === item.categoryId) || null;
}

function categoryName(categoryId) {
  const cat = state.data.categories.find((c) => c.id === categoryId);
  return cat ? cat.name : null;
}

// Groups an item under its category (if it has one) so items sharing a
// category (e.g. "Subscriptions") merge into one slice; items without a
// category fall back to their own name, as before.
function expenseGroupKey(item) {
  return categoryName(item.categoryId) || (item.name || '').trim() || t('theme.unnamedItem');
}

function computeExpenseStats() {
  const payments = allPaymentItems().filter((x) => isInTimeRange(x, state.timeFilter));
  const monthly = payments.filter((x) => x.periodType === 'monthly').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const weekly = payments.filter((x) => x.periodType === 'weekly').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const total = payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const byName = new Map();
  payments.forEach((x) => {
    const key = expenseGroupKey(x);
    const entry = byName.get(key) || { amount: 0, color: null };
    entry.amount += Number(x.amount) || 0;
    entry.color = categoryOf(x)?.color || entry.color;
    byName.set(key, entry);
  });
  let groups = Array.from(byName, ([name, e]) => ({ name, amount: e.amount, color: e.color }))
    .filter((g) => g.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  if (groups.length > DONUT_MAX_SLICES) {
    const head = groups.slice(0, DONUT_MAX_SLICES - 1);
    const tailSum = groups.slice(DONUT_MAX_SLICES - 1).reduce((s, g) => s + g.amount, 0);
    groups = [...head, { name: t('theme.otherSlice'), amount: tailSum, isOther: true }];
  }

  // Category slices use their own color; uncategorized slices draw from the
  // palette, skipping every color a category already owns.
  const assigned = [];
  const slices = groups.map((g) => {
    let color = g.isOther ? DONUT_OTHER_COLOR : g.color;
    if (!color) {
      color = nextFreeColor(assigned);
      assigned.push(color);
    }
    return { ...g, pct: total > 0 ? (g.amount / total) * 100 : 0, color };
  });

  return { monthly, weekly, total, slices, hasPayments: payments.length > 0 };
}

/* -------------------------------------------------------------------
 * Number ticker — Motion Primitives-style: figures glide from their
 * previous value to the new one instead of snapping.
 * ------------------------------------------------------------------- */
const TICK_MS = 900;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function tickNumber(node, value, format = formatMoney) {
  const target = Number(value) || 0;
  const from = typeof node._tickValue === 'number' ? node._tickValue : 0;
  node._tickValue = target;
  cancelAnimationFrame(node._tickFrame);
  if (prefersReducedMotion.matches || from === target) {
    node.textContent = format(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / TICK_MS);
    const eased = 1 - Math.pow(1 - p, 4); // easeOutQuart: fast start, soft landing
    node.textContent = format(from + (target - from) * eased);
    if (p < 1) node._tickFrame = requestAnimationFrame(step);
  };
  node._tickFrame = requestAnimationFrame(step);
}

const formatCount = (n) => String(Math.round(n));

function isSubscription(item) {
  return item.type === 'payments' && ['monthly', 'weekly', 'yearly'].includes(item.periodType);
}

function renderDashboardTiles(stats) {
  const payments = allPaymentItems();
  tickNumber($('#stat-total'), stats.total);
  tickNumber($('#stat-monthly'), stats.monthly);
  tickNumber($('#stat-weekly'), stats.weekly);
  const inRange = payments.filter((x) => isInTimeRange(x, state.timeFilter));
  $('#stat-total-sub').textContent = t('home.paymentsCountTemplate', { count: inRange.length });

  const subs = payments.filter(isSubscription);
  tickNumber($('#stat-subs'), subs.length, formatCount);
  const subsMonthly = subs.reduce((s, x) => {
    const a = Number(x.amount) || 0;
    return s + (x.periodType === 'weekly' ? a * 52 / 12 : x.periodType === 'yearly' ? a / 12 : a);
  }, 0);
  $('#stat-subs-sub').textContent = subs.length ? t('home.perMonthTemplate', { amount: formatMoney(subsMonthly) }) : '';

  const notes = notebookNotes();
  tickNumber($('#stat-notes'), notes.length, formatCount);
  const latest = [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  $('#stat-notes-sub').textContent = latest ? (latest.title || t('notebook.untitled')) : '';

  renderUpcomingPayments();

  // Upcoming (and overdue, not yet done) reminders, soonest first.
  const list = $('#tile-reminders');
  list.innerHTML = '';
  const now = Date.now();
  const reminders = state.data.items
    .filter((x) => x.type !== 'payments' && !x.done && x.reminderAt)
    .sort((a, b) => new Date(a.reminderAt) - new Date(b.reminderAt))
    .slice(0, 4);
  if (!reminders.length) {
    list.appendChild(el('li', 'row-empty', t('home.noUpcomingReminders')));
  }
  reminders.forEach((item) => {
    const li = el('li');
    const overdue = new Date(item.reminderAt).getTime() < now;
    li.append(el('span', 'row-dot' + (overdue ? ' overdue' : '')), el('span', 'row-title', item.title || t('theme.unnamedItem')), el('span', 'row-when', formatDateTime(item.reminderAt)));
    li.onclick = () => openNoteById(item.id);
    list.appendChild(li);
  });
}

$('#tile-notebook').onclick = () => openNotebookList();

/* -------------------------------------------------------------------
 * Upcoming payments — every payment / subscription whose next due date
 * is today or within the next 3 days.
 * ------------------------------------------------------------------- */
const UPCOMING_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function nextDueDate(item) {
  if (isSubscription(item)) {
    const rec = computeRecurrence(item);
    if (!rec) return null;
    if (item.endDate && rec.nextDue > new Date(item.endDate + 'T23:59:59')) return null;
    return rec.nextDue;
  }
  // One-off / custom-range payments are due on their start date.
  if (!item.startDate) return null;
  const d = new Date(item.startDate + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function upcomingPayments() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return allPaymentItems()
    .map((item) => {
      const due = nextDueDate(item);
      if (!due) return null;
      const days = Math.round((due - today) / DAY_MS);
      if (days < 0 || days > UPCOMING_WINDOW_DAYS) return null;
      // A paid one-off is settled; a subscription's next cycle still comes up.
      if (item.paid && !isSubscription(item)) return null;
      return { item, due, days };
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days || (Number(b.item.amount) || 0) - (Number(a.item.amount) || 0));
}

function dueLabel(days) {
  if (days === 0) return t('home.dueToday');
  if (days === 1) return t('home.dueTomorrow');
  return t('home.dueInDays', { days });
}

function renderUpcomingPayments() {
  const list = $('#tile-upcoming');
  list.innerHTML = '';
  const rows = upcomingPayments();
  const total = rows.reduce((s, r) => s + (Number(r.item.amount) || 0), 0);
  $('#upcoming-summary').textContent = rows.length
    ? t('home.upcomingSummaryTemplate', { count: rows.length, total: formatMoney(total) })
    : '';
  if (!rows.length) {
    list.appendChild(el('li', 'row-empty', t('home.noUpcomingPayments')));
    return;
  }
  rows.forEach(({ item, due, days }) => {
    const li = el('li', 'upcoming-row');
    const urgency = days === 0 ? 'due-today' : days === 1 ? 'due-soon' : 'due-later';
    const text = el('div', 'row-text');
    text.append(
      el('span', 'row-title', item.name || t('theme.unnamedItem')),
      el('span', 'row-sub', [isSubscription(item) ? t('search.filter.subscriptions') : t('search.filter.payments'), categoryOf(item)?.name, formatDate(due)].filter(Boolean).join(' · '))
    );
    const right = el('div', 'row-right');
    right.append(el('span', 'row-amount', formatMoney(item.amount)), el('span', `due-chip ${urgency}`, dueLabel(days)));
    li.append(el('span', `row-dot ${urgency}`), text, right);
    li.title = `${item.name || ''} — ${formatDate(due)}`;
    li.onclick = () => openPaymentById(item.id);
    list.appendChild(li);
  });
}

function renderExpenseOverview() {
  populateTimeFilterSelect($('#home-time-filter'));
  const stats = computeExpenseStats();
  renderDashboardTiles(stats);

  const hasSlices = stats.slices.length > 0;
  $('#donut-wrap').classList.toggle('hidden', !hasSlices);
  $('#donut-empty').classList.toggle('hidden', hasSlices);
  tickNumber($('#donut-center-value'), stats.total);

  const svg = $('#donut-svg');
  const legend = $('#donut-legend');
  svg.innerHTML = '';
  legend.innerHTML = '';

  const cx = 100, cy = 100, r = 80, strokeWidth = 26;
  const circumference = 2 * Math.PI * r;
  const gap = stats.slices.length > 1 ? 3 : 0;

  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', cx);
  track.setAttribute('cy', cy);
  track.setAttribute('r', r);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--bg-elev-2)');
  track.setAttribute('stroke-width', strokeWidth);
  svg.appendChild(track);

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
  svg.appendChild(group);

  let cumulative = 0;
  stats.slices.forEach((slice, i) => {
    const rawLen = (slice.pct / 100) * circumference;
    const len = Math.max(rawLen - gap, 0);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', slice.color);
    circle.setAttribute('stroke-width', strokeWidth);
    circle.setAttribute('stroke-dasharray', `${len} ${circumference - len}`);
    circle.setAttribute('stroke-dashoffset', -cumulative);
    circle.dataset.index = i;
    group.appendChild(circle);
    cumulative += rawLen;

    const li = el('li');
    const swatch = el('span', 'swatch');
    swatch.style.background = slice.color;
    const name = el('span', 'legend-name', slice.name);
    name.title = slice.name;
    const amount = el('span', 'legend-amount', formatMoney(slice.amount));
    const pct = el('span', 'legend-pct', `${slice.pct.toFixed(1)}%`);
    li.append(swatch, name, amount, pct);
    li.addEventListener('mouseenter', () => {
      group.querySelectorAll('circle').forEach((c) => {
        c.style.opacity = Number(c.dataset.index) === i ? '1' : '0.35';
      });
    });
    li.addEventListener('mouseleave', () => {
      group.querySelectorAll('circle').forEach((c) => { c.style.opacity = '1'; });
    });
    legend.appendChild(li);
  });
}

function renderHome() {
  renderExpenseOverview();
  const grid = $('#theme-grid');
  grid.innerHTML = '';
  const themes = sortedThemes();
  $('#home-empty-hint').classList.toggle('hidden', themes.length > 0);

  themes.forEach((theme, idx) => {
    const card = el('div', 'theme-card');
    card.draggable = true;
    card.dataset.id = theme.id;

    const icon = el('div', 'theme-card-icon', theme.type === 'payments' ? '💳' : '⏰');
    const name = el('div', 'theme-card-name', theme.name);

    const items = themeStats(theme.id);
    let meta;
    if (theme.type === 'payments') {
      const total = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      meta = el('div', 'theme-card-meta', t('home.paymentsMetaTemplate', { count: items.length, total: formatMoney(total) }));
    } else {
      const doneCount = items.filter((x) => x.done).length;
      meta = el('div', 'theme-card-meta', t('home.notesMetaTemplate', { count: items.length, done: doneCount }));
    }

    const actions = el('div', 'theme-card-actions');
    const editBtn = el('button', 'icon-btn', '✏️');
    editBtn.title = t('home.renameTooltip');
    editBtn.onclick = (e) => { e.stopPropagation(); openThemeModal(theme); };
    const delBtn = el('button', 'icon-btn danger', '🗑️');
    delBtn.title = t('home.deleteTooltip');
    delBtn.onclick = (e) => { e.stopPropagation(); confirmDelete('theme', theme.id, t('home.deleteThemeConfirmTemplate', { name: theme.name })); };
    actions.append(editBtn, delBtn);

    const orderRow = el('div', 'theme-card-order');
    const upBtn = el('button', 'icon-btn', '↑');
    upBtn.title = t('home.moveUpTooltip');
    upBtn.disabled = idx === 0;
    upBtn.onclick = (e) => { e.stopPropagation(); moveTheme(theme.id, -1); };
    const downBtn = el('button', 'icon-btn', '↓');
    downBtn.title = t('home.moveDownTooltip');
    downBtn.disabled = idx === themes.length - 1;
    downBtn.onclick = (e) => { e.stopPropagation(); moveTheme(theme.id, 1); };
    orderRow.append(upBtn, downBtn);

    card.append(icon, name, meta, actions, orderRow);
    card.onclick = () => openTheme(theme.id);

    attachDrag(card, grid, '.theme-card', async (orderedIds) => {
      await window.api.reorderThemes(orderedIds);
      await refreshData();
      renderHome();
    });

    grid.appendChild(card);
  });

  // Same "add theme" shortcut as the top-right button, placed as a tile in
  // the grid itself so it sits in whatever empty space is next to the cards.
  const addTile = el('button', 'theme-card theme-add-tile');
  addTile.type = 'button';
  const addIcon = el('div', 'theme-card-icon', '➕');
  const addLabel = el('div', 'theme-card-name', t('home.newTheme'));
  addTile.append(addIcon, addLabel);
  addTile.onclick = () => openThemeModal(null);
  grid.appendChild(addTile);
}

async function moveTheme(themeId, dir) {
  const themes = sortedThemes();
  const idx = themes.findIndex((t) => t.id === themeId);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= themes.length) return;
  [themes[idx], themes[swapIdx]] = [themes[swapIdx], themes[idx]];
  await window.api.reorderThemes(themes.map((t) => t.id));
  await refreshData();
  renderHome();
}

/* -------------------------------------------------------------------
 * Theme modal (create / rename)
 * ------------------------------------------------------------------- */
function openThemeModal(theme) {
  state.editingThemeId = theme ? theme.id : null;
  $('#modal-theme-title').textContent = theme ? t('themeModal.renameTitle') : t('themeModal.newTitle');
  $('#modal-theme-name').value = theme ? theme.name : '';
  $('#modal-theme-type-wrap').classList.toggle('hidden', !!theme);
  if (!theme) {
    document.querySelector('input[name="theme-type"][value="notes"]').checked = true;
  }
  openModal('modal-theme');
  $('#modal-theme-name').focus();
}

$('#btn-new-theme').onclick = () => openThemeModal(null);
$('#modal-theme-cancel').onclick = () => closeModal('modal-theme');

$('#modal-theme-save').onclick = async () => {
  const name = $('#modal-theme-name').value.trim();
  if (!name) return;
  if (state.editingThemeId) {
    await window.api.updateTheme(state.editingThemeId, name);
  } else {
    const type = document.querySelector('input[name="theme-type"]:checked').value;
    await window.api.createTheme(name, type);
  }
  closeModal('modal-theme');
  await refreshData();
  renderHome();
};

/* -------------------------------------------------------------------
 * Theme detail screen
 * ------------------------------------------------------------------- */
function currentTheme() {
  return state.data.themes.find((t) => t.id === state.currentThemeId);
}

function sortedItems(themeId) {
  return state.data.items
    .filter((x) => x.themeId === themeId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function openTheme(themeId) {
  state.currentThemeId = themeId;
  showScreen('screen-theme');
  renderThemeDetail();
}

$('#btn-back-home').onclick = () => {
  state.currentThemeId = null;
  showScreen('screen-home');
  renderHome();
};

$('#btn-delete-theme').onclick = () => {
  const th = currentTheme();
  if (!th) return;
  confirmDelete('theme', th.id, t('home.deleteThemeConfirmTemplate', { name: th.name }));
};

// Inline rename on detail title
const themeTitleEl = $('#theme-title');
themeTitleEl.onclick = () => {
  const th = currentTheme();
  if (!th) return;
  themeTitleEl.contentEditable = 'true';
  themeTitleEl.focus();
  document.execCommand('selectAll', false, null);
};
themeTitleEl.addEventListener('blur', async () => {
  themeTitleEl.contentEditable = 'false';
  const th = currentTheme();
  if (!th) return;
  const newName = themeTitleEl.textContent.trim();
  if (newName && newName !== th.name) {
    await window.api.updateTheme(th.id, newName);
    await refreshData();
  }
  renderThemeDetail();
});
themeTitleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); themeTitleEl.blur(); }
  if (e.key === 'Escape') { e.preventDefault(); themeTitleEl.textContent = currentTheme().name; themeTitleEl.blur(); }
});

function periodLabel(item) {
  const map = {
    monthly: t('paymentModal.periodMonthly'),
    weekly: t('paymentModal.periodWeekly'),
    yearly: t('paymentModal.periodYearly'),
    custom: t('paymentModal.periodCustom'),
  };
  let label = map[item.periodType] || '';
  const range = [item.startDate ? formatDate(item.startDate) : null, item.endDate ? formatDate(item.endDate) : null]
    .filter(Boolean).join(' → ');
  if (range) label += (label ? ' · ' : '') + range;
  return label;
}

// Adds `months` calendar months to `date`, clamping the day to the target
// month's last day (e.g. 31 Jan + 1 month -> 28/29 Feb, not overflow to March).
function addMonthsClamped(date, months) {
  const day = date.getDate();
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setMonth(d.getMonth() + months);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInMonth));
  return d;
}

// Adds `years` years to `date`, clamping 29 Feb on a leap year down to 28
// Feb when the target year isn't one.
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

// For a recurring (monthly/weekly/yearly) payment, finds the upcoming due
// date and how many full cycles have actually COMPLETED as of today (i.e.
// how many occurrences already lie in the past, not counting one that's
// still ahead). Used only to *display* info/warning — never changes stored
// data.
function computeRecurrence(item) {
  if (!item.startDate) return null;
  if (!['monthly', 'weekly', 'yearly'].includes(item.periodType)) return null;
  const start = new Date(item.startDate + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const advance = (d) => advanceOccurrence(d, item.periodType);

  if (start > today) {
    return { nextDue: start, cycles: 0 };
  }

  // Walk forward while the *next* occurrence has already arrived (<= today).
  // `occurrence` ends up as the most recent due date that is <= today.
  let occurrence = start;
  let cycles = 0;
  let guard = 0;
  while (guard < 2000) {
    const next = advance(occurrence);
    if (next > today) break;
    occurrence = next;
    cycles++;
    guard++;
  }

  // If today itself is a due date, that's the one to show; otherwise the
  // next upcoming occurrence (still in the future) is the relevant one.
  const nextDue = occurrence.getTime() === today.getTime() ? occurrence : advance(occurrence);
  return { nextDue, cycles };
}

function renderThemeDetail() {
  const theme = currentTheme();
  if (!theme) return;
  themeTitleEl.textContent = theme.name;

  const isPayments = theme.type === 'payments';
  $('#payments-summary').classList.toggle('hidden', !isPayments);
  $('#theme-toolbar').classList.toggle('hidden', !isPayments);
  $('#btn-add-item').textContent = isPayments ? t('theme.addItemPayments') : t('theme.addItemNotes');
  $('#btn-manage-categories').classList.toggle('hidden', !isPayments);

  if (isPayments) populateTimeFilterSelect($('#theme-time-filter'));

  const allItems = sortedItems(theme.id);
  const items = isPayments ? allItems.filter((x) => isInTimeRange(x, state.timeFilter)) : allItems;
  $('#theme-empty-hint').classList.toggle('hidden', items.length > 0);

  if (isPayments) {
    const total = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const paid = items.filter((x) => x.paid).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    tickNumber($('#sum-total'), total);
    tickNumber($('#sum-paid'), paid);
    tickNumber($('#sum-unpaid'), total - paid);
  }

  const list = $('#item-list');
  list.innerHTML = '';

  items.forEach((item, idx) => {
    const card = el('div', 'item-card' + (isChecked(item) ? ' done' : ''));
    card.draggable = true;
    card.dataset.id = item.id;

    const handle = el('div', 'item-drag-handle', '⠿');

    const check = el('input', 'item-check');
    check.type = 'checkbox';
    check.checked = isChecked(item);
    check.title = isPayments ? t('theme.checkPaidTitle') : t('theme.checkDoneTitle');
    check.onchange = async () => {
      const patch = isPayments ? { paid: check.checked } : { done: check.checked };
      await window.api.updateItem(item.id, patch);
      await refreshData();
      renderThemeDetail();
    };

    const body = el('div', 'item-body');
    const titleRow = el('div', 'item-title-row');
    const titleText = isPayments ? item.name : item.title;
    const titleEl = el('span', 'item-title' + (isChecked(item) ? ' done' : ''), titleText || t('theme.unnamedItem'));
    titleRow.appendChild(titleEl);

    const recurrence = isPayments ? computeRecurrence(item) : null;

    if (isPayments) {
      const badge = el('span', 'badge ' + (item.paid ? 'paid' : 'unpaid'), item.paid ? t('theme.badgePaid') : t('theme.badgeUnpaid'));
      titleRow.appendChild(badge);

      if (recurrence && recurrence.cycles >= 1 && item.paid) {
        const warn = el('span', 'badge period-alert', t('theme.periodAlertBadge'));
        warn.title = t('theme.periodAlertTooltip');
        titleRow.appendChild(warn);
      }

      const cat = categoryOf(item);
      if (cat) {
        const chip = el('span', 'badge category-badge', cat.name);
        chip.style.setProperty('--chip', cat.color || '#565b6b');
        chip.title = `${t('theme.metaCategory')}: ${cat.name}`;
        titleRow.appendChild(chip);
      }
    }
    body.appendChild(titleRow);

    if (isPayments) {
      const meta = el('div', 'item-meta');
      const amount = el('span', null); amount.innerHTML = `${t('theme.metaAmount')}: <b>${formatMoney(item.amount)}</b>`;
      const method = el('span', null); method.innerHTML = `${t('theme.metaMethod')}: <b>${item.paymentMethod || t('theme.noValue')}</b>`;
      const period = el('span', null); period.innerHTML = `${t('theme.metaPeriod')}: <b>${periodLabel(item) || t('theme.noValue')}</b>`;
      meta.append(amount, method, period);
      if (recurrence) {
        const nextDue = el('span', null);
        nextDue.innerHTML = `${t('theme.metaNextDue')}: <b>${formatDate(recurrence.nextDue)}</b>`;
        meta.append(nextDue);
      }
      body.appendChild(meta);
    } else {
      body.classList.add('clickable');
      body.onclick = () => openNoteModal(item);
      if (item.description) body.appendChild(el('div', 'item-desc', item.description));
      if (item.reminderAt) {
        const meta = el('div', 'item-meta');
        const rem = el('span', null); rem.innerHTML = `${t('theme.metaReminder')}: <b>${formatDateTime(item.reminderAt)}</b>`;
        meta.appendChild(rem);
        body.appendChild(meta);
      }
    }

    const actions = el('div', 'item-actions');
    const actionsRow = el('div', 'item-actions-row');
    const editBtn = el('button', 'icon-btn', '✏️');
    editBtn.onclick = () => (isPayments ? openPaymentModal(item) : openNoteModal(item));
    const delBtn = el('button', 'icon-btn danger', '🗑️');
    delBtn.onclick = () => confirmDelete('item', item.id, t('theme.deleteItemConfirm'));
    actionsRow.append(editBtn, delBtn);

    const orderRow = el('div', 'item-order-row');
    const upBtn = el('button', 'icon-btn', '↑');
    upBtn.disabled = idx === 0;
    upBtn.onclick = () => moveItem(item.id, -1);
    const downBtn = el('button', 'icon-btn', '↓');
    downBtn.disabled = idx === items.length - 1;
    downBtn.onclick = () => moveItem(item.id, 1);
    orderRow.append(upBtn, downBtn);

    actions.append(actionsRow, orderRow);

    card.append(handle, check, body, actions);

    attachDrag(card, list, '.item-card', async (orderedIds) => {
      await window.api.reorderItems(theme.id, orderedIds);
      await refreshData();
      renderThemeDetail();
    });

    list.appendChild(card);
  });
}

function isChecked(item) {
  return item.type === 'payments' ? !!item.paid : !!item.done;
}

async function moveItem(itemId, dir) {
  const theme = currentTheme();
  const items = sortedItems(theme.id);
  const idx = items.findIndex((i) => i.id === itemId);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= items.length) return;
  [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
  await window.api.reorderItems(theme.id, items.map((i) => i.id));
  await refreshData();
  renderThemeDetail();
}

$('#btn-add-item').onclick = () => {
  const theme = currentTheme();
  if (!theme) return;
  if (theme.type === 'payments') openPaymentModal(null);
  else openNoteModal(null);
};

/* -------------------------------------------------------------------
 * Reminder modal — compact, date/time-focused short tasks
 * ------------------------------------------------------------------- */
function toLocalInputValue(iso) {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function openNoteModal(item) {
  state.editingItemId = item ? item.id : null;
  $('#modal-note-title').textContent = item ? t('noteModal.editTitle') : t('noteModal.newTitle');
  $('#note-title').value = item ? item.title || '' : '';
  $('#note-desc').value = item ? item.description || '' : '';
  $('#note-remind').value = item && item.reminderAt ? toLocalInputValue(item.reminderAt) : '';
  openModal('modal-note');
  $('#note-title').focus();
}

$('#modal-note-cancel').onclick = () => closeModal('modal-note');
$('#note-remind-clear').onclick = () => { $('#note-remind').value = ''; };
$('#note-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#modal-note-save').click(); }
});

$('#modal-note-save').onclick = async () => {
  const title = $('#note-title').value.trim();
  if (!title) { $('#note-title').focus(); return; }
  const payload = {
    title,
    description: $('#note-desc').value.trim(),
    reminderAt: $('#note-remind').value ? new Date($('#note-remind').value).toISOString() : null,
  };
  if (state.editingItemId) {
    await window.api.updateItem(state.editingItemId, payload);
  } else {
    await window.api.createItem({ themeId: state.currentThemeId, type: 'notes', ...payload });
  }
  closeModal('modal-note');
  await refreshData();
  renderThemeDetail();
};

// Opened from a clicked Windows reminder notification (see main.js).
let pendingNoteToOpen = null;

async function openNoteById(itemId) {
  const item = state.data.items.find((x) => x.id === itemId);
  if (!item) return;
  if (notepad.open) await leaveNotepadEditor({ toList: false });
  state.currentThemeId = item.themeId;
  showScreen('screen-theme');
  renderThemeDetail();
  openNoteModal(item);
}

if (window.api.onOpenNote) {
  window.api.onOpenNote(async (itemId) => {
    const loggedIn = ['screen-home', 'screen-theme', 'screen-notebook', 'screen-notepad']
      .some((id) => !$('#' + id).classList.contains('hidden'));
    if (!loggedIn) { pendingNoteToOpen = itemId; return; }
    await refreshData();
    openNoteById(itemId);
  });
}

/* -------------------------------------------------------------------
 * Main tabs: Themes | Notebook
 * ------------------------------------------------------------------- */
function goHome() {
  state.currentThemeId = null;
  showScreen('screen-home');
  renderHome();
}

document.querySelectorAll('.main-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'notebook') openNotebookList();
    else goHome();
  });
});

/* -------------------------------------------------------------------
 * Notebook — standalone notepad module (Explorer-style list + editor)
 * ------------------------------------------------------------------- */
const AUTOSAVE_DELAY_MS = 1500;

const notepad = {
  open: false,        // editor screen showing
  editingId: null,    // null = new, not yet saved
  dirty: false,
  saving: null,       // in-flight save promise, so saves never overlap
  autosaveTimer: null,
  query: '',
  sortKey: 'updatedAt',
  sortDir: 'desc',
};

function notebookNotes() {
  return state.data.notebook || [];
}

function openNotebookList() {
  state.currentThemeId = null;
  showScreen('screen-notebook');
  renderNotebookList();
}

// Appends `text` to `parent`, wrapping case-insensitive matches of `query`
// in <mark>. Built from text nodes, so note content is never parsed as HTML.
function appendHighlighted(parent, text, query) {
  if (!query) { parent.appendChild(document.createTextNode(text)); return; }
  const lower = text.toLocaleLowerCase();
  let from = 0;
  let at = lower.indexOf(query, from);
  while (at !== -1) {
    if (at > from) parent.appendChild(document.createTextNode(text.slice(from, at)));
    parent.appendChild(el('mark', null, text.slice(at, at + query.length)));
    from = at + query.length;
    at = lower.indexOf(query, from);
  }
  if (from < text.length) parent.appendChild(document.createTextNode(text.slice(from)));
}

// One-line preview; when the search hits the body, centre it on the match.
function previewText(content, query) {
  const flat = (content || '').replace(/\s+/g, ' ').trim();
  if (!query) return flat.slice(0, 200);
  const at = flat.toLocaleLowerCase().indexOf(query);
  if (at <= 40) return flat.slice(0, 200);
  return '…' + flat.slice(at - 30, at + 170);
}

function renderNotebookList() {
  const query = notepad.query.trim().toLocaleLowerCase();
  const all = notebookNotes();
  const notes = all.filter((n) => !query
    || (n.title || '').toLocaleLowerCase().includes(query)
    || (n.content || '').toLocaleLowerCase().includes(query));

  const { sortKey, sortDir } = notepad;
  const dir = sortDir === 'asc' ? 1 : -1;
  notes.sort((a, b) => {
    if (sortKey === 'title') {
      return dir * (a.title || '').localeCompare(b.title || '', window.i18n.currentLang, { sensitivity: 'base', numeric: true });
    }
    return dir * ((a[sortKey] || 0) - (b[sortKey] || 0));
  });

  document.querySelectorAll('.notebook-table th[data-sort]').forEach((th) => {
    const active = th.dataset.sort === sortKey;
    th.classList.toggle('sorted', active);
    th.querySelector('.sort-arrow').textContent = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
  });

  $('#notebook-count').textContent = query
    ? t('notebook.searchCountTemplate', { count: notes.length, total: all.length })
    : t('notebook.countTemplate', { count: all.length });

  const empty = $('#notebook-empty');
  empty.classList.toggle('hidden', notes.length > 0);
  empty.textContent = all.length === 0 ? t('notebook.empty') : t('notebook.noResults');
  $('.notebook-table').classList.toggle('hidden', notes.length === 0);

  const tbody = $('#notebook-tbody');
  tbody.innerHTML = '';
  notes.forEach((note) => {
    const tr = el('tr', 'notebook-row');
    tr.onclick = () => openNotepadEditor(note);

    const titleTd = el('td');
    const titleEl = el('div', 'pad-row-title' + (note.title ? '' : ' untitled'));
    appendHighlighted(titleEl, note.title || t('notebook.untitled'), note.title ? query : '');
    titleEl.title = note.title || '';
    const preview = previewText(note.content, query);
    titleTd.appendChild(titleEl);
    if (preview) {
      const prevEl = el('div', 'pad-row-preview');
      appendHighlighted(prevEl, preview, query);
      titleTd.appendChild(prevEl);
    }

    const createdTd = el('td', 'date-cell', formatDateTime(note.createdAt));
    const updatedTd = el('td', 'date-cell', formatDateTime(note.updatedAt || note.createdAt));

    const actionsTd = el('td');
    const delBtn = el('button', 'icon-btn danger', '🗑️');
    delBtn.title = t('notebook.deleteTooltip');
    delBtn.onclick = (e) => { e.stopPropagation(); confirmDelete('notebook', note.id, t('notebook.deleteConfirm')); };
    actionsTd.appendChild(delBtn);

    tr.append(titleTd, createdTd, updatedTd, actionsTd);
    tbody.appendChild(tr);
  });
}

$('#notebook-search').addEventListener('input', (e) => {
  notepad.query = e.target.value;
  renderNotebookList();
});

document.querySelectorAll('.notebook-table th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (notepad.sortKey === key) {
      notepad.sortDir = notepad.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      notepad.sortKey = key;
      notepad.sortDir = key === 'title' ? 'asc' : 'desc';
    }
    renderNotebookList();
  });
});

$('#btn-new-pad').onclick = () => openNotepadEditor(null);

// ----- Editor -----

function currentPadNote() {
  return notebookNotes().find((n) => n.id === notepad.editingId) || null;
}

function openNotepadEditor(note) {
  notepad.editingId = note ? note.id : null;
  $('#pad-title').value = note ? note.title || '' : '';
  $('#pad-content').value = note ? note.content || '' : '';
  $('#pad-delete').classList.toggle('hidden', !note);
  $('#pad-export-menu').classList.add('hidden');
  notepad.open = true;
  notepad.dirty = false;
  updatePadCounter();
  updatePadStamps();
  setPadSaveState(note ? 'saved' : '');
  showScreen('screen-notepad');
  const content = $('#pad-content');
  content.scrollTop = 0;
  if (note) {
    content.focus();
    content.setSelectionRange(content.value.length, content.value.length);
  } else {
    $('#pad-title').focus();
  }
}

function updatePadCounter() {
  const text = $('#pad-content').value;
  const words = (text.match(/\S+/g) || []).length;
  $('#pad-counter').textContent = t('notebook.counterTemplate', { words, chars: text.length });
}

function updatePadStamps() {
  const note = currentPadNote();
  $('#pad-stamps').textContent = note
    ? `${t('notebook.colCreated')}: ${formatDateTime(note.createdAt)} · ${t('notebook.colModified')}: ${formatDateTime(note.updatedAt || note.createdAt)}`
    : '';
}

function setPadSaveState(kind) {
  const label = { saved: t('notebook.stateSaved'), dirty: t('notebook.stateDirty'), saving: t('notebook.stateSaving') }[kind] || '';
  $('#pad-save-state').textContent = label;
}

// Untitled notes get their first line as a title, so you can just start
// writing without stopping to name the note.
function padTitleFromInputs() {
  const title = $('#pad-title').value.trim();
  if (title) return title;
  const firstLine = ($('#pad-content').value.split('\n').find((l) => l.trim()) || '').trim();
  return firstLine.length > 60 ? firstLine.slice(0, 60).trimEnd() + '…' : firstLine;
}

function padSnapshot() {
  return $('#pad-title').value + '\u0000' + $('#pad-content').value;
}

async function saveNotepad() {
  while (notepad.saving) await notepad.saving;
  if (!notepad.open) return false;
  const title = padTitleFromInputs();
  const content = $('#pad-content').value.replace(/\s+$/, '');
  if (!notepad.editingId && !title && !content) return false;
  // Snapshot so edits typed while the save is in flight stay "dirty".
  const snapshot = padSnapshot();

  setPadSaveState('saving');
  notepad.saving = (async () => {
    if (notepad.editingId) {
      await window.api.updateNote(notepad.editingId, { title, content });
    } else {
      const created = await window.api.createNote({ title, content });
      notepad.editingId = created.id;
      $('#pad-delete').classList.remove('hidden');
    }
    await refreshData();
  })();
  try {
    await notepad.saving;
  } finally {
    notepad.saving = null;
  }
  notepad.dirty = padSnapshot() !== snapshot;
  setPadSaveState(notepad.dirty ? 'dirty' : 'saved');
  updatePadStamps();
  return true;
}

function markPadDirty() {
  notepad.dirty = true;
  setPadSaveState('dirty');
  clearTimeout(notepad.autosaveTimer);
  notepad.autosaveTimer = setTimeout(() => {
    if (notepad.open && notepad.dirty) saveNotepad().catch(() => setPadSaveState('dirty'));
  }, AUTOSAVE_DELAY_MS);
}

async function leaveNotepadEditor({ toList = true } = {}) {
  clearTimeout(notepad.autosaveTimer);
  if (notepad.dirty) await saveNotepad();
  notepad.open = false;
  notepad.dirty = false;
  notepad.editingId = null;
  $('#pad-export-menu').classList.add('hidden');
  if (toList) openNotebookList();
}

$('#pad-content').addEventListener('input', () => { updatePadCounter(); markPadDirty(); });
$('#pad-title').addEventListener('input', markPadDirty);
$('#pad-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#pad-content').focus(); }
});

$('#pad-save').onclick = async () => {
  clearTimeout(notepad.autosaveTimer);
  const saved = await saveNotepad();
  if (!saved) $('#pad-content').focus();
};

$('#pad-back').onclick = () => leaveNotepadEditor();

$('#pad-delete').onclick = () => {
  if (notepad.editingId) confirmDelete('notebook', notepad.editingId, t('notebook.deleteConfirm'));
};

// ----- Export (.txt / .md) -----

function safeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  return cleaned || t('notebook.untitled').replace(/[()]/g, '') || 'note';
}

function buildExportContent(format) {
  // Only an explicitly typed title becomes a heading; a title derived from
  // the first line is already the first line of the text.
  const typedTitle = $('#pad-title').value.trim();
  const body = $('#pad-content').value.replace(/\s+$/, '');
  if (format === 'md') return (typedTitle ? `# ${typedTitle}\n\n` : '') + body + '\n';
  return (typedTitle ? `${typedTitle}\n\n` : '') + body + '\n';
}

$('#pad-export').onclick = (e) => {
  e.stopPropagation();
  $('#pad-export-menu').classList.toggle('hidden');
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.export-wrap')) $('#pad-export-menu').classList.add('hidden');
});

$('#pad-export-menu').querySelectorAll('button[data-format]').forEach((btn) => {
  btn.onclick = async () => {
    $('#pad-export-menu').classList.add('hidden');
    const format = btn.dataset.format;
    const name = `${safeFileName(padTitleFromInputs())}.${format}`;
    const res = await window.api.exportNote(buildExportContent(format), name, format);
    if (res && res.ok) toast(t('notebook.exported', { path: res.path || name }));
  };
});

// ----- Keyboard shortcuts -----

document.addEventListener('keydown', (e) => {
  const confirmOpen = !$('#modal-confirm').classList.contains('hidden');
  if (notepad.open) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      $('#pad-save').click();
    } else if (e.key === 'Escape' && !confirmOpen) {
      e.preventDefault();
      if (!$('#pad-export-menu').classList.contains('hidden')) $('#pad-export-menu').classList.add('hidden');
      else leaveNotepadEditor();
    }
  } else if (!$('#screen-notebook').classList.contains('hidden') && !confirmOpen) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#notebook-search').focus();
      $('#notebook-search').select();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openNotepadEditor(null);
    }
  }
});

/* -------------------------------------------------------------------
 * Payment modal
 * ------------------------------------------------------------------- */
function populatePaymentCategorySelect(selectedId) {
  const select = $('#pay-category');
  select.innerHTML = `<option value="">${t('paymentModal.categoryNone')}</option>`;
  state.data.categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  });
  select.value = selectedId || '';
}

function applyPaymentModalStrings() {
  $('#pay-amount-label').textContent = `${t('paymentModal.amountLabel')} (${state.settings.currency})`;
  $('#pay-method-opt-card').value = t('paymentModal.methodCard');
  $('#pay-method-opt-transfer').value = t('paymentModal.methodTransfer');
  $('#pay-method-opt-cash').value = t('paymentModal.methodCash');
  $('#pay-method-opt-autopay').value = t('paymentModal.methodAutopay');
}

function openPaymentModal(item) {
  state.editingItemId = item ? item.id : null;
  applyPaymentModalStrings();
  $('#modal-payment-title').textContent = item ? t('paymentModal.editTitle') : t('paymentModal.newTitle');
  $('#pay-name').value = item ? item.name || '' : '';
  $('#pay-amount').value = item ? item.amount ?? '' : '';
  $('#pay-method').value = item ? item.paymentMethod || '' : '';
  populatePaymentCategorySelect(item ? item.categoryId : null);
  $('#pay-start').value = item && item.startDate ? item.startDate.slice(0, 10) : '';
  $('#pay-end').value = item && item.endDate ? item.endDate.slice(0, 10) : '';
  const period = item ? item.periodType || 'monthly' : 'monthly';
  document.querySelector(`input[name="pay-period"][value="${period}"]`).checked = true;
  openModal('modal-payment');
  $('#pay-name').focus();
}

$('#modal-payment-cancel').onclick = () => closeModal('modal-payment');

$('#modal-payment-save').onclick = async () => {
  const name = $('#pay-name').value.trim();
  if (!name) return;
  const payload = {
    name,
    amount: parseFloat($('#pay-amount').value) || 0,
    paymentMethod: $('#pay-method').value.trim(),
    categoryId: $('#pay-category').value || null,
    periodType: document.querySelector('input[name="pay-period"]:checked').value,
    startDate: $('#pay-start').value || null,
    endDate: $('#pay-end').value || null,
  };
  if (state.editingItemId) {
    await window.api.updateItem(state.editingItemId, payload);
  } else {
    await window.api.createItem({ themeId: state.currentThemeId, type: 'payments', ...payload });
  }
  closeModal('modal-payment');
  await refreshData();
  renderThemeDetail();
};

/* -------------------------------------------------------------------
 * Payment category manager
 * ------------------------------------------------------------------- */
// Which category's color panel is expanded, and the last color-conflict
// message to show inside it.
const colorUi = { openId: null, error: null };

async function applyCategoryColor(cat, hex) {
  const conflict = findColorConflict(hex, cat.id);
  if (conflict) {
    colorUi.error = { id: cat.id, message: t('categoryModal.colorConflict', { name: conflict.name }) };
    renderCategoryList(); // re-render restores the picker to the saved color
    return;
  }
  colorUi.error = null;
  await window.api.updateCategory(cat.id, { color: hex });
  await refreshData();
  renderCategoryList();
  await rerenderCurrentScreen(); // donut chart + payment badges update immediately
}

function buildColorPanel(cat) {
  const panel = el('div', 'color-panel');
  const grid = el('div', 'swatch-grid');

  CATEGORY_PALETTE.forEach((hex) => {
    const conflict = findColorConflict(hex, cat.id);
    const sw = el('button', 'swatch-btn' + (hex === cat.color ? ' selected' : ''));
    sw.type = 'button';
    sw.style.background = hex;
    sw.disabled = !!conflict;
    sw.title = conflict ? t('categoryModal.colorUsed', { name: conflict.name }) : hex;
    if (!conflict) sw.onclick = () => applyCategoryColor(cat, hex);
    grid.appendChild(sw);
  });

  const custom = el('label', 'swatch-btn swatch-custom');
  custom.title = t('categoryModal.customColor');
  const input = document.createElement('input');
  input.type = 'color';
  input.value = cat.color || '#7c8cff';
  input.addEventListener('change', () => applyCategoryColor(cat, input.value));
  custom.appendChild(input);
  grid.appendChild(custom);

  panel.appendChild(grid);
  if (colorUi.error && colorUi.error.id === cat.id) {
    panel.appendChild(el('p', 'error color-error', colorUi.error.message));
  }
  return panel;
}

function renderCategoryList() {
  const list = $('#category-list');
  list.innerHTML = '';
  const categories = state.data.categories;
  $('#category-empty-hint').classList.toggle('hidden', categories.length > 0);
  categories.forEach((cat) => {
    const li = el('li', 'category-item');
    const row = el('div', 'category-row');

    const dot = el('button', 'color-dot');
    dot.type = 'button';
    dot.style.background = cat.color || '#565b6b';
    dot.title = t('categoryModal.colorTooltip');
    dot.onclick = () => {
      colorUi.openId = colorUi.openId === cat.id ? null : cat.id;
      colorUi.error = null;
      renderCategoryList();
    };

    const name = el('span', 'category-name', cat.name);
    const delBtn = el('button', 'icon-btn danger', '🗑️');
    delBtn.title = t('categoryModal.deleteTooltip');
    delBtn.onclick = () => confirmDelete(
      'category',
      cat.id,
      t('categoryModal.deleteConfirmTemplate', { name: cat.name })
    );
    row.append(dot, name, delBtn);
    li.appendChild(row);
    if (colorUi.openId === cat.id) li.appendChild(buildColorPanel(cat));
    list.appendChild(li);
  });
}

function openCategoriesModal() {
  colorUi.openId = null;
  colorUi.error = null;
  renderCategoryList();
  openModal('modal-categories');
  $('#new-category-name').focus();
}

$('#btn-manage-categories').onclick = openCategoriesModal;
$('#btn-home-categories').onclick = openCategoriesModal;
$('#pay-manage-categories').onclick = openCategoriesModal;

$('#modal-categories-close').onclick = () => {
  closeModal('modal-categories');
  populatePaymentCategorySelect($('#pay-category').value);
};

async function addCategoryFromInput() {
  const input = $('#new-category-name');
  const name = input.value.trim();
  if (!name) return;
  await window.api.createCategory(name, nextFreeColor());
  input.value = '';
  await refreshData();
  renderCategoryList();
  await rerenderCurrentScreen();
}

$('#btn-add-category').onclick = addCategoryFromInput;
$('#new-category-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addCategoryFromInput(); }
});

/* -------------------------------------------------------------------
 * Export report (CSV / PDF) — exports all payment items across every
 * payments theme, respecting the home dashboard's active time filter.
 * ------------------------------------------------------------------- */
function toast(message) {
  const existing = document.querySelector('.pfd-toast');
  if (existing) existing.remove();
  const div = el('div', 'pfd-toast', message);
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function buildReportRows() {
  const themesById = new Map(state.data.themes.map((th) => [th.id, th]));
  return allPaymentItems()
    .filter((x) => isInTimeRange(x, state.timeFilter))
    .map((it) => ({
      theme: themesById.get(it.themeId)?.name || '',
      name: it.name || '',
      category: categoryName(it.categoryId) || '',
      amount: Number(it.amount) || 0,
      method: it.paymentMethod || '',
      period: periodLabel(it),
      status: it.paid ? t('theme.badgePaid') : t('theme.badgeUnpaid'),
      startDate: it.startDate ? formatDate(it.startDate) : '',
    }));
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildReportCsv(rows) {
  const headers = [
    t('report.colTheme'), t('report.colName'), t('report.colCategory'),
    `${t('report.colAmount')} (${state.settings.currency})`, t('report.colMethod'),
    t('report.colPeriod'), t('report.colStatus'), t('report.colStartDate'),
  ];
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach((r) => {
    lines.push([r.theme, r.name, r.category, r.amount.toFixed(2), r.method, r.period, r.status, r.startDate]
      .map(csvEscape).join(','));
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  lines.push('');
  lines.push([t('report.totalLabel'), '', '', total.toFixed(2)].map(csvEscape).join(','));
  return lines.join('\r\n');
}

function buildReportHtml(rows) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const rowsHtml = rows.map((r) => `
    <tr>
      <td>${r.theme}</td><td>${r.name}</td><td>${r.category}</td>
      <td class="num">${formatMoney(r.amount)}</td><td>${r.method}</td>
      <td>${r.period}</td><td>${r.status}</td><td>${r.startDate}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f2f2f5; }
    td.num { text-align: right; }
    tfoot td { font-weight: bold; border-top: 2px solid #333; }
  </style></head><body>
    <h1>${t('report.title')}</h1>
    <div class="meta">${t('report.generatedOn', { date: formatDateTime(new Date().toISOString()) })}</div>
    <table>
      <thead><tr>
        <th>${t('report.colTheme')}</th><th>${t('report.colName')}</th><th>${t('report.colCategory')}</th>
        <th>${t('report.colAmount')}</th><th>${t('report.colMethod')}</th>
        <th>${t('report.colPeriod')}</th><th>${t('report.colStatus')}</th><th>${t('report.colStartDate')}</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td colspan="3">${t('report.totalLabel')}</td><td class="num">${formatMoney(total)}</td><td colspan="4"></td></tr></tfoot>
    </table>
  </body></html>`;
}

$('#btn-export-csv').onclick = async () => {
  const rows = buildReportRows();
  const res = await window.api.exportCsv(buildReportCsv(rows), 'flowdesk-plus-report.csv');
  if (res.ok) toast(t('export.doneMessage', { path: res.path || '' }));
};

$('#btn-export-pdf').onclick = async () => {
  const rows = buildReportRows();
  const res = await window.api.exportPdf(buildReportHtml(rows), 'flowdesk-plus-report.pdf');
  if (res.ok) toast(t('export.doneMessage', { path: res.path || '' }));
  else if (res.error === 'PREVIEW_MODE') toast('PDF export requires the desktop app.');
};

/* -------------------------------------------------------------------
 * Confirm delete modal
 * ------------------------------------------------------------------- */
function confirmDelete(type, id, text) {
  state.pendingDelete = { type, id };
  $('#confirm-text').textContent = text;
  openModal('modal-confirm');
}

$('#confirm-cancel').onclick = () => { state.pendingDelete = null; closeModal('modal-confirm'); };

$('#confirm-ok').onclick = async () => {
  const pending = state.pendingDelete;
  if (!pending) return;
  closeModal('modal-confirm');
  if (pending.type === 'theme') {
    await window.api.deleteTheme(pending.id);
    await refreshData();
    if (state.currentThemeId === pending.id) {
      state.currentThemeId = null;
      showScreen('screen-home');
    }
    renderHome();
  } else if (pending.type === 'notebook') {
    await window.api.deleteNote(pending.id);
    await refreshData();
    if (notepad.open && notepad.editingId === pending.id) {
      clearTimeout(notepad.autosaveTimer);
      notepad.dirty = false;
      await leaveNotepadEditor();
    } else {
      renderNotebookList();
    }
  } else if (pending.type === 'category') {
    await window.api.deleteCategory(pending.id);
    await refreshData();
    renderCategoryList();
    populatePaymentCategorySelect($('#pay-category').value);
    await rerenderCurrentScreen();
  } else {
    await window.api.deleteItem(pending.id);
    await refreshData();
    renderThemeDetail();
  }
  state.pendingDelete = null;
};

/* -------------------------------------------------------------------
 * Change password modal
 * ------------------------------------------------------------------- */
$('#btn-change-password').onclick = () => {
  $('#pwd-current').value = '';
  $('#pwd-new').value = '';
  $('#pwd-new-confirm').value = '';
  $('#pwd-error').classList.add('hidden');
  openModal('modal-password');
};
$('#modal-password-cancel').onclick = () => closeModal('modal-password');

$('#modal-password-save').onclick = async () => {
  const current = $('#pwd-current').value;
  const next = $('#pwd-new').value;
  const confirmVal = $('#pwd-new-confirm').value;
  const errorEl = $('#pwd-error');
  errorEl.classList.add('hidden');
  if (next !== confirmVal) {
    errorEl.textContent = t('passwordModal.mismatchError');
    errorEl.classList.remove('hidden');
    return;
  }
  const res = await window.api.authChangePassword(current, next);
  if (!res.ok) {
    errorEl.textContent = t(authErrorKey(res.error));
    errorEl.classList.remove('hidden');
    return;
  }
  closeModal('modal-password');
};

/* -------------------------------------------------------------------
 * Generic HTML5 drag & drop reorder helper
 * ------------------------------------------------------------------- */
function attachDrag(cardEl, containerEl, selector, onDrop) {
  cardEl.addEventListener('dragstart', (e) => {
    cardEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardEl.dataset.id);
  });

  cardEl.addEventListener('dragend', async () => {
    cardEl.classList.remove('dragging');
    containerEl.querySelectorAll(selector).forEach((c) => c.classList.remove('drag-over'));
    const orderedIds = Array.from(containerEl.querySelectorAll(selector)).map((c) => c.dataset.id);
    await onDrop(orderedIds);
  });

  cardEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = containerEl.querySelector('.dragging');
    if (!dragging || dragging === cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    const isGrid = containerEl.classList.contains('theme-grid');
    let before;
    if (isGrid) {
      before = e.clientX < rect.left + rect.width / 2;
    } else {
      before = e.clientY < rect.top + rect.height / 2;
    }
    containerEl.querySelectorAll(selector).forEach((c) => c.classList.remove('drag-over'));
    cardEl.classList.add('drag-over');
    if (before) {
      containerEl.insertBefore(dragging, cardEl);
    } else {
      containerEl.insertBefore(dragging, cardEl.nextSibling);
    }
  });

  cardEl.addEventListener('drop', (e) => {
    e.preventDefault();
  });
}

/* -------------------------------------------------------------------
 * Modal overlay click-to-close (only when clicking the dark backdrop)
 * ------------------------------------------------------------------- */
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

/* -------------------------------------------------------------------
 * Backup & restore — one JSON file with every theme, payment,
 * subscription, reminder, category and notebook note.
 * ------------------------------------------------------------------- */
const BACKUP_ROWS = ['themes', 'payments', 'subscriptions', 'reminders', 'notes', 'categories'];

function showBackupMsg(text, kind) {
  const msg = $('#backup-msg');
  msg.textContent = text;
  msg.className = kind || '';
}

function backupErrorText(code) {
  const known = ['NOT_JSON', 'NOT_BACKUP', 'NEWER_VERSION', 'TOO_LARGE', 'BAD_PASSWORD', 'WEAK_PASSWORD', 'MISMATCH'];
  return t(`backup.error.${known.includes(code) ? code : 'NOT_BACKUP'}`);
}

// ----- Export: choose encrypted .flow (default) or plain .json -----

function selectedBackupFormat() {
  return document.querySelector('input[name="backup-format"]:checked').value;
}

function syncBackupFormatUi() {
  $('#backup-password-fields').classList.toggle('hidden', selectedBackupFormat() !== 'flow');
  $('#backup-export-error').classList.add('hidden');
}

document.querySelectorAll('input[name="backup-format"]').forEach((r) => r.addEventListener('change', syncBackupFormatUi));

$('#btn-backup-export').onclick = () => {
  showBackupMsg('', 'hidden');
  document.querySelector('input[name="backup-format"][value="flow"]').checked = true;
  $('#backup-password').value = '';
  $('#backup-password-confirm').value = '';
  syncBackupFormatUi();
  openModal('modal-backup-export');
  $('#backup-password').focus();
};

$('#backup-export-cancel').onclick = () => closeModal('modal-backup-export');

$('#backup-export-confirm').onclick = async () => {
  const format = selectedBackupFormat();
  const password = $('#backup-password').value;
  const errorEl = $('#backup-export-error');
  const fail = (code) => { errorEl.textContent = backupErrorText(code); errorEl.classList.remove('hidden'); };
  if (format === 'flow') {
    if (password.length < 4) return fail('WEAK_PASSWORD');
    if (password !== $('#backup-password-confirm').value) return fail('MISMATCH');
  }
  const res = await window.api.exportBackup({ format, password: format === 'flow' ? password : undefined });
  if (res && res.canceled) return;
  if (!res || !res.ok) return fail(res && res.error);
  closeModal('modal-backup-export');
  $('#backup-password').value = '';
  $('#backup-password-confirm').value = '';
  showBackupMsg(t(res.encrypted ? 'backup.exportedEncrypted' : 'backup.exported', { path: res.path || '' }), 'success');
};

$('#backup-password-confirm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#backup-export-confirm').click(); }
});

// ----- Import: pick a file; encrypted ones ask for their password first -----

function showRestorePreview(res) {
  $('#restore-file').textContent = res.exportedAt
    ? t('backup.fileWithDate', { file: res.fileName, date: formatDateTime(res.exportedAt) })
    : res.fileName;
  const tbody = $('#restore-tbody');
  tbody.innerHTML = '';
  BACKUP_ROWS.forEach((k) => {
    const tr = el('tr');
    tr.append(el('td', null, t(`backup.row.${k}`)), el('td', 'num', String(res.summary[k] || 0)), el('td', 'num muted', String(res.current[k] || 0)));
    tbody.appendChild(tr);
  });
  $('#restore-skipped').textContent = res.skipped ? t('backup.skippedTemplate', { count: res.skipped }) : '';
  $('#restore-skipped').classList.toggle('hidden', !res.skipped);
  document.querySelector('input[name="restore-mode"][value="replace"]').checked = true;
  openModal('modal-restore');
}

$('#btn-backup-import').onclick = async () => {
  showBackupMsg('', 'hidden');
  const res = await window.api.pickBackup();
  if (!res || res.canceled) return;
  if (res.needsPassword) {
    $('#backup-unlock-file').textContent = res.exportedAt
      ? t('backup.fileWithDate', { file: res.fileName, date: formatDateTime(res.exportedAt) })
      : res.fileName;
    $('#backup-unlock-password').value = '';
    $('#backup-unlock-error').classList.add('hidden');
    openModal('modal-backup-password');
    $('#backup-unlock-password').focus();
    return;
  }
  if (!res.ok) { showBackupMsg(backupErrorText(res.error), 'error'); return; }
  showRestorePreview(res);
};

$('#backup-unlock-cancel').onclick = () => {
  window.api.cancelBackup();
  $('#backup-unlock-password').value = '';
  closeModal('modal-backup-password');
};

$('#backup-unlock-confirm').onclick = async () => {
  const res = await window.api.decryptBackup($('#backup-unlock-password').value);
  if (!res || !res.ok) {
    if (res && res.error === 'BAD_PASSWORD') {
      $('#backup-unlock-error').textContent = backupErrorText('BAD_PASSWORD');
      $('#backup-unlock-error').classList.remove('hidden');
      $('#backup-unlock-password').select();
      return;
    }
    closeModal('modal-backup-password');
    showBackupMsg(backupErrorText(res && res.error), 'error');
    return;
  }
  $('#backup-unlock-password').value = '';
  closeModal('modal-backup-password');
  showRestorePreview(res);
};

$('#backup-unlock-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#backup-unlock-confirm').click(); }
});

$('#restore-cancel').onclick = () => {
  window.api.cancelBackup();
  closeModal('modal-restore');
};

$('#restore-confirm').onclick = async () => {
  const mode = document.querySelector('input[name="restore-mode"]:checked').value;
  const res = await window.api.applyBackup(mode);
  closeModal('modal-restore');
  if (!res || !res.ok) { showBackupMsg(backupErrorText(res && res.error), 'error'); return; }
  // An open notebook editor would otherwise save stale text over the restore.
  if (notepad.open) { clearTimeout(notepad.autosaveTimer); notepad.dirty = false; notepad.open = false; notepad.editingId = null; }
  await refreshData();
  await ensureCategoryColors();
  state.currentThemeId = null;
  closeModal('modal-settings');
  showScreen('screen-home');
  renderHome();
  const s = res.summary;
  toast(t('backup.restored', { themes: s.themes, items: s.payments + s.subscriptions + s.reminders, notes: s.notes }));
};

/* -------------------------------------------------------------------
 * Appearance — Light / Dark / Devilt Violet
 * settings.json is the source of truth; localStorage mirrors it so
 * theme-boot.js can paint the right palette before the app has loaded.
 * ------------------------------------------------------------------- */
const UI_THEMES = [
  { id: 'light', icon: '☀️' },
  { id: 'dark', icon: '🌙' },
  { id: 'violet', icon: '✦' },
];
const THEME_STORAGE_KEY = 'flowdesk.theme';

function activeUiTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function applyUiTheme(themeId, { persist = true } = {}) {
  if (!UI_THEMES.some((x) => x.id === themeId)) themeId = 'dark';
  document.documentElement.setAttribute('data-theme', themeId);
  try { localStorage.setItem(THEME_STORAGE_KEY, themeId); } catch {}
  renderThemeSwitches();
  if (persist && state.settings.theme !== themeId) {
    state.settings.theme = themeId;
    window.api.updateSettings({ theme: themeId });
  }
}

function renderThemeSwitches() {
  const current = activeUiTheme();
  document.querySelectorAll('.theme-switch').forEach((wrap) => {
    wrap.innerHTML = '';
    UI_THEMES.forEach((th) => {
      const b = el('button', current === th.id ? 'active' : '', th.icon);
      b.type = 'button';
      b.title = t(`appearance.${th.id}`);
      b.setAttribute('aria-pressed', String(current === th.id));
      b.onclick = () => applyUiTheme(th.id);
      wrap.appendChild(b);
    });
  });

  const cards = $('#settings-theme-cards');
  if (!cards) return;
  cards.innerHTML = '';
  UI_THEMES.forEach((th) => {
    const b = el('button', 'theme-card-option' + (current === th.id ? ' active' : ''));
    b.type = 'button';
    const preview = el('div', `theme-preview ${th.id}`);
    preview.append(el('span'), el('span'), el('span'));
    b.append(preview, el('span', null, t(`appearance.${th.id}`)));
    b.onclick = () => applyUiTheme(th.id);
    cards.appendChild(b);
  });
}

/* -------------------------------------------------------------------
 * Global search — command palette (Ctrl+K) across notes, payments,
 * subscriptions and reminders.
 * ------------------------------------------------------------------- */
const SEARCH_FILTERS = ['all', 'notes', 'payments', 'subscriptions', 'reminders'];
const SEARCH_ICONS = { notes: '📓', payments: '💳', subscriptions: '🔁', reminders: '⏰' };
const cmdk = { filter: 'all', results: [], selected: 0 };

function themeNameOf(item) {
  const th = state.data.themes.find((x) => x.id === item.themeId);
  return th ? th.name : '';
}

function buildSearchIndex() {
  const entries = [];
  notebookNotes().forEach((note) => {
    entries.push({
      kind: 'notes',
      title: note.title || t('notebook.untitled'),
      sub: (note.content || '').replace(/\s+/g, ' ').trim(),
      meta: formatDateTime(note.updatedAt || note.createdAt),
      haystack: `${note.title || ''} ${note.content || ''}`,
      recency: note.updatedAt || note.createdAt || 0,
      open: () => openNotepadEditor(notebookNotes().find((n) => n.id === note.id)),
    });
  });
  state.data.items.forEach((item) => {
    if (item.type === 'payments') {
      const sub = isSubscription(item);
      const cat = categoryOf(item);
      const rec = sub ? computeRecurrence(item) : null;
      const parts = [themeNameOf(item), cat && cat.name, periodLabel(item), rec && `${t('theme.metaNextDue')}: ${formatDate(rec.nextDue)}`];
      entries.push({
        kind: sub ? 'subscriptions' : 'payments',
        title: item.name || t('theme.unnamedItem'),
        sub: parts.filter(Boolean).join(' · '),
        meta: formatMoney(item.amount),
        haystack: `${item.name || ''} ${parts.filter(Boolean).join(' ')} ${item.paymentMethod || ''} ${item.amount ?? ''}`,
        recency: item.createdAt || 0,
        open: () => openPaymentById(item.id),
      });
    } else {
      entries.push({
        kind: 'reminders',
        title: item.title || t('theme.unnamedItem'),
        sub: [themeNameOf(item), (item.description || '').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · '),
        meta: item.reminderAt ? formatDateTime(item.reminderAt) : '',
        haystack: `${item.title || ''} ${item.description || ''} ${themeNameOf(item)}`,
        recency: item.reminderAt ? new Date(item.reminderAt).getTime() : item.createdAt || 0,
        open: () => openNoteById(item.id),
      });
    }
  });
  return entries;
}

function openPaymentById(itemId) {
  const item = state.data.items.find((x) => x.id === itemId);
  if (!item) return;
  state.currentThemeId = item.themeId;
  showScreen('screen-theme');
  renderThemeDetail();
  openPaymentModal(item);
}

// Every whitespace-separated term must appear; title hits rank first.
function searchEntries(query) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const all = buildSearchIndex();
  if (!terms.length) return all.sort((a, b) => b.recency - a.recency);
  return all
    .map((e) => {
      const hay = e.haystack.toLocaleLowerCase();
      if (!terms.every((term) => hay.includes(term))) return null;
      const title = e.title.toLocaleLowerCase();
      const score = (title.startsWith(terms[0]) ? 0 : title.includes(terms[0]) ? 1 : 2);
      return { e, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || b.e.recency - a.e.recency)
    .map((x) => x.e);
}

function isCmdkOpen() {
  return !$('#modal-cmdk').classList.contains('hidden');
}

function openCmdk(initialQuery = '') {
  cmdk.filter = 'all';
  cmdk.selected = 0;
  const input = $('#cmdk-input');
  input.value = initialQuery;
  openModal('modal-cmdk');
  renderCmdk();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function closeCmdk() {
  closeModal('modal-cmdk');
}

function renderCmdk() {
  const query = $('#cmdk-input').value.trim();
  const hlQuery = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)[0] || '';
  const matches = searchEntries(query);

  // Filter chips with live match counts.
  const counts = { all: matches.length };
  SEARCH_FILTERS.slice(1).forEach((k) => { counts[k] = matches.filter((m) => m.kind === k).length; });
  const chips = $('#cmdk-filters');
  chips.innerHTML = '';
  SEARCH_FILTERS.forEach((k) => {
    const chip = el('button', 'cmdk-chip' + (cmdk.filter === k ? ' active' : ''));
    chip.type = 'button';
    chip.append(document.createTextNode(t(`search.filter.${k}`)), el('span', 'chip-count', String(counts[k])));
    chip.onclick = () => { cmdk.filter = k; cmdk.selected = 0; renderCmdk(); $('#cmdk-input').focus(); };
    chips.appendChild(chip);
  });

  // Grouped results: a few per group under "All", more under one filter.
  // Groups are ordered by their best-ranked hit, so a title match leads.
  const firstHit = (kind) => { const i = matches.findIndex((m) => m.kind === kind); return i < 0 ? Infinity : i; };
  const groups = cmdk.filter === 'all'
    ? SEARCH_FILTERS.slice(1).sort((a, b) => (query ? firstHit(a) - firstHit(b) : 0))
    : [cmdk.filter];
  const perGroup = cmdk.filter === 'all' ? (query ? 6 : 3) : 40;
  cmdk.results = [];
  const box = $('#cmdk-results');
  box.innerHTML = '';
  groups.forEach((kind) => {
    const list = matches.filter((m) => m.kind === kind).slice(0, perGroup);
    if (!list.length) return;
    box.appendChild(el('div', 'cmdk-group-label', t(`search.filter.${kind}`)));
    list.forEach((entry) => {
      const index = cmdk.results.length;
      cmdk.results.push(entry);
      const row = el('div', 'cmdk-item');
      row.dataset.index = index;
      const text = el('div', 'cmdk-item-text');
      const title = el('div', 'cmdk-item-title');
      appendHighlighted(title, entry.title, hlQuery);
      text.appendChild(title);
      if (entry.sub) {
        const sub = el('div', 'cmdk-item-sub');
        appendHighlighted(sub, previewText(entry.sub, hlQuery), hlQuery);
        text.appendChild(sub);
      }
      row.append(el('div', 'cmdk-item-icon', SEARCH_ICONS[kind]), text, el('div', 'cmdk-item-meta', entry.meta || ''));
      row.addEventListener('mousemove', () => { if (cmdk.selected !== index) { cmdk.selected = index; paintCmdkSelection(); } });
      row.addEventListener('click', () => runCmdkEntry(index));
      box.appendChild(row);
    });
  });

  if (!cmdk.results.length) {
    box.appendChild(el('div', 'cmdk-empty', query ? t('search.noResults') : t('search.emptyState')));
  }
  cmdk.selected = Math.min(cmdk.selected, Math.max(0, cmdk.results.length - 1));
  paintCmdkSelection();
}

function paintCmdkSelection() {
  $('#cmdk-results').querySelectorAll('.cmdk-item').forEach((row) => {
    const on = Number(row.dataset.index) === cmdk.selected;
    row.classList.toggle('selected', on);
    if (on) row.scrollIntoView({ block: 'nearest' });
  });
}

async function runCmdkEntry(index) {
  const entry = cmdk.results[index];
  if (!entry) return;
  closeCmdk();
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((m) => m.classList.add('hidden'));
  if (notepad.open) await leaveNotepadEditor({ toList: false });
  entry.open();
}

$('#cmdk-input').addEventListener('input', () => { cmdk.selected = 0; renderCmdk(); });
// The top-bar search fields hand off to the palette (which searches all
// four categories at once) as soon as they are focused or typed into.
document.querySelectorAll('.cmdk-inline').forEach((field) => {
  const handOff = () => {
    const text = field.value;
    field.value = '';
    field.blur();
    openCmdk(text);
  };
  field.addEventListener('focus', handOff);
  field.addEventListener('input', handOff);
});

function isLoggedInScreen() {
  return ['screen-home', 'screen-theme', 'screen-notebook', 'screen-notepad']
    .some((id) => !$('#' + id).classList.contains('hidden'));
}

// Capture phase: runs before the screen-level shortcuts, so Esc/Enter in
// the palette never also leave the notebook editor underneath it.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (!isLoggedInScreen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isCmdkOpen()) closeCmdk(); else openCmdk();
    return;
  }
  if (!isCmdkOpen()) return;
  const n = cmdk.results.length;
  if (e.key === 'Escape') {
    closeCmdk();
  } else if (e.key === 'ArrowDown') {
    if (n) { cmdk.selected = (cmdk.selected + 1) % n; paintCmdkSelection(); }
  } else if (e.key === 'ArrowUp') {
    if (n) { cmdk.selected = (cmdk.selected - 1 + n) % n; paintCmdkSelection(); }
  } else if (e.key === 'Enter') {
    runCmdkEntry(cmdk.selected);
  } else if (e.key === 'Tab') {
    const i = SEARCH_FILTERS.indexOf(cmdk.filter);
    cmdk.filter = SEARCH_FILTERS[(i + (e.shiftKey ? SEARCH_FILTERS.length - 1 : 1)) % SEARCH_FILTERS.length];
    cmdk.selected = 0;
    renderCmdk();
  } else {
    return; // let typing reach the input
  }
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// assets/logo-mark.png is the Devilt Interactive logo; if the
// file is ever missing, hide the broken-image icon and keep the text.
document.querySelectorAll('.brand-logo').forEach((img) => {
  const hide = () => img.classList.add('hidden');
  img.addEventListener('error', hide);
  if (img.complete && img.naturalWidth === 0) hide();
});

/* -------------------------------------------------------------------
 * Session lock — when the window is closed to the tray, main asks us to
 * lock: save any unsaved notebook text, wipe everything on screen, confirm
 * the lock (main then refuses all data access) and show the password
 * screen, so reopening the app always asks for the master password.
 * ------------------------------------------------------------------- */
const EMPTY_DATA = () => ({ themes: [], items: [], categories: [], notebook: [] });
let locking = false;

async function lockApp() {
  if (locking) return;
  locking = true;
  try {
    if (notepad.open) {
      clearTimeout(notepad.autosaveTimer);
      try { if (notepad.dirty) await saveNotepad(); } catch {}
    }
    notepad.open = false;
    notepad.dirty = false;
    notepad.editingId = null;
    clearTimeout(notepad.autosaveTimer);

    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    window.api.cancelBackup && window.api.cancelBackup().catch(() => {});

    // Drop the data from memory and from every rendered view and form.
    state.data = EMPTY_DATA();
    state.currentThemeId = null;
    state.editingItemId = null;
    state.editingThemeId = null;
    state.pendingDelete = null;
    ['#theme-grid', '#item-list', '#notebook-tbody', '#tile-upcoming', '#tile-reminders', '#donut-legend', '#donut-svg', '#cmdk-results', '#restore-tbody']
      .forEach((sel) => { const n = $(sel); if (n) n.innerHTML = ''; });
    document.querySelectorAll('input[type=text], input[type=search], input[type=password], input[type=number], textarea')
      .forEach((input) => { input.value = ''; });
    notepad.query = '';
  } finally {
    await window.api.lockSession().catch(() => {});
    showScreen('screen-auth');
    await initAuth();
    locking = false;
  }
}

if (window.api.onLock) window.api.onLock(() => { lockApp(); });

/* -------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------- */
async function init() {
  state.settings = await window.api.getSettings();
  // settings.json wins; a theme picked before this build only lived locally.
  const savedTheme = UI_THEMES.some((x) => x.id === state.settings.theme) ? state.settings.theme : activeUiTheme();
  applyUiTheme(savedTheme, { persist: savedTheme !== state.settings.theme });
  await window.i18n.loadLocale(state.settings.language);
  window.i18n.applyStaticTranslations();
  populateSettingsModalOptions();
  await initAuth();
}

init();
