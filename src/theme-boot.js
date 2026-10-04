'use strict';

/* -------------------------------------------------------------------
 * Runs in <head> before the stylesheet paints anything, so the app opens
 * straight in the saved theme (no flash of the default palette). The
 * same choice is also stored in settings.json by app.js, which stays the
 * source of truth and re-syncs this copy after login.
 * ------------------------------------------------------------------- */
(function () {
  var THEMES = ['dark', 'light', 'violet'];
  var theme = 'dark';
  try {
    var saved = localStorage.getItem('flowdesk.theme');
    if (THEMES.indexOf(saved) !== -1) theme = saved;
  } catch (e) {
    // Storage unavailable — fall back to the default theme.
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
