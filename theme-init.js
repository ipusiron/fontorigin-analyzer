/**
 * theme-init - decide the theme before the first paint. Loaded synchronously in
 * <head>, right after style.css (not deferred: it must run before the body is drawn).
 *
 * style.css is light by default; dark mode is the "dark" class on <html> (:root.dark).
 * When this was decided in script.js at the end of <body>, the page was painted
 * light first and then switched to dark.
 *
 * The saved choice (localStorage "theme") wins; otherwise the OS setting is followed.
 * Blocked storage does not stop it. script.js reads the class to sync the button.
 */
(function (global) {
  'use strict';

  var saved = null;
  try { saved = global.localStorage.getItem('theme'); } catch (e) { /* blocked storage: follow the OS */ }

  var prefersDark = !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  var theme = (saved === 'light' || saved === 'dark') ? saved : (prefersDark ? 'dark' : 'light');

  if (theme === 'dark') global.document.documentElement.classList.add('dark');
})(typeof window !== 'undefined' ? window : globalThis);
