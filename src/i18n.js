'use strict';

/* -------------------------------------------------------------------
 * FlowDesk+ — i18n & currency engine.
 * Locale strings live as JSON under src/locales/<code>.json; this file
 * loads them, exposes t(key, params) for lookups, and formats money
 * using both the selected UI language (number grouping/decimal style)
 * and the selected currency symbol (independent settings).
 * ------------------------------------------------------------------- */

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', numeric: 'en-US' },
  { code: 'tr', name: 'Türkçe', numeric: 'tr-TR' },
  { code: 'de', name: 'Deutsch', numeric: 'de-DE' },
  { code: 'es', name: 'Español', numeric: 'es-ES' },
  { code: 'fr', name: 'Français', numeric: 'fr-FR' },
  { code: 'pt-BR', name: 'Português (Brasil)', numeric: 'pt-BR' },
  { code: 'ja', name: '日本語', numeric: 'ja-JP' },
  { code: 'zh-CN', name: '简体中文', numeric: 'zh-CN' },
  { code: 'ru', name: 'Русский', numeric: 'ru-RU' },
];

const SUPPORTED_CURRENCIES = [
  { symbol: '$', code: 'USD', position: 'prefix' },
  { symbol: '€', code: 'EUR', position: 'prefix' },
  { symbol: '£', code: 'GBP', position: 'prefix' },
  { symbol: '₺', code: 'TRY', position: 'suffix' },
  { symbol: '¥', code: 'JPY', position: 'prefix' },
  { symbol: 'R$', code: 'BRL', position: 'prefix' },
  { symbol: '₽', code: 'RUB', position: 'suffix' },
];

const DEFAULT_LANGUAGE = 'en';
const DEFAULT_CURRENCY = '$';

const i18nState = {
  lang: DEFAULT_LANGUAGE,
  strings: {},
};

function langInfo(code) {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) || SUPPORTED_LANGUAGES[0];
}

function currencyInfo(symbol) {
  return SUPPORTED_CURRENCIES.find((c) => c.symbol === symbol) || SUPPORTED_CURRENCIES[0];
}

async function loadLocale(code) {
  const lang = langInfo(code).code;
  try {
    const res = await fetch(`locales/${lang}.json`);
    i18nState.strings = await res.json();
  } catch {
    i18nState.strings = {};
  }
  i18nState.lang = lang;
}

function translate(key, params) {
  let str = i18nState.strings[key];
  if (str === undefined) str = key;
  if (params) {
    Object.keys(params).forEach((k) => {
      str = str.replace(`{${k}}`, params[k]);
    });
  }
  return str;
}

// Walks the DOM applying data-i18n / data-i18n-placeholder / data-i18n-title
// attributes. Called once after each locale load.
function applyStaticTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((elx) => {
    elx.textContent = translate(elx.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((elx) => {
    elx.placeholder = translate(elx.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((elx) => {
    elx.title = translate(elx.dataset.i18nTitle);
  });
}

function formatMoneyImpl(amount, currencySymbol) {
  const info = currencyInfo(currencySymbol || DEFAULT_CURRENCY);
  const numericLocale = langInfo(i18nState.lang).numeric;
  const fractionDigits = info.code === 'JPY' ? 0 : 2;
  const formatted = (Number(amount) || 0).toLocaleString(numericLocale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return info.position === 'prefix' ? `${info.symbol}${formatted}` : `${formatted} ${info.symbol}`;
}

function formatDateImpl(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(langInfo(i18nState.lang).numeric);
}

function formatDateTimeImpl(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString(langInfo(i18nState.lang).numeric, { dateStyle: 'medium', timeStyle: 'short' });
}

window.i18n = {
  SUPPORTED_LANGUAGES,
  SUPPORTED_CURRENCIES,
  DEFAULT_LANGUAGE,
  DEFAULT_CURRENCY,
  loadLocale,
  t: translate,
  applyStaticTranslations,
  formatMoney: formatMoneyImpl,
  formatDate: formatDateImpl,
  formatDateTime: formatDateTimeImpl,
  get currentLang() { return i18nState.lang; },
};
