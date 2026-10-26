// Runs the real preview/app.js in Node with a minimal stand-in for the page, so every view's HTML can be

// built for any grimoire state quickly and without a browser. It exercises the code that turns data into

// page text (where malformed data would crash); it does not lay out or paint anything.

import { readFileSync } from 'node:fs';

import vm from 'node:vm';



function element() {

  const el = {

    _html: '', textContent: '', value: '', hidden: false, checked: true, open: false, dataset: {}, style: {}, files: [],

    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },

    focus() {}, select() {}, setAttribute() {}, getAttribute() { return null }, removeAttribute() {}, remove() {}, click() {}, appendChild() {},

    scrollIntoView() {}, addEventListener() {}, dispatchEvent() {},

    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },

    classList: { _s: new Set(), toggle(c) { if (this._s.has(c)) { this._s.delete(c); return false; } this._s.add(c); return true; }, contains(c) { return this._s.has(c); }, remove(c) { this._s.delete(c); }, add(c) { this._s.add(c); } }

  };

  return el;

}



export function loadApp() {

  const els = new Map();

  const listeners = { window: {}, document: {} };

  const on = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };

  const loc = { hash: '', pathname: '/', protocol: 'file:' };      // file: → the app starts in "not saving" mode

  const document = {

    querySelector: (sel) => { if (!els.has(sel)) els.set(sel, element()); return els.get(sel); },

    querySelectorAll: () => [], createElement: () => element(), addEventListener: on(listeners.document),

    body: element(), visibilityState: 'visible', activeElement: null

  };

  // In a browser `window` IS the global object; do the same here.

  const ctx = vm.createContext({ document, location: loc, history: { replaceState() {} }, navigator: {}, console,

    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; }, clearTimeout, URL, URLSearchParams,

    Blob: class {}, FileReader: class {}, fetch: () => Promise.reject(new Error('no network in tests')),

    HashChangeEvent: class {}, Event: class {}, KeyboardEvent: class {}, performance,

    addEventListener: on(listeners.window), matchMedia: () => ({ matches: true, addEventListener() {} }), scrollTo() {}, isSecureContext: false });

  ctx.window = ctx; ctx.globalThis = ctx;

  const window = ctx;

  for (const f of ['data.js', 'model.js', 'app.js']) vm.runInContext(readFileSync(new URL('../preview/' + f, import.meta.url), 'utf8'), ctx, { filename: f });

  const S = window.__grimoire;

  const main = document.querySelector('#main');

  return {

    S, Model: window.GrimoireModel,

    // Show a route; returns the page HTML, or throws if rendering escaped the app's own error handling.

    show(route) {

      loc.hash = route;

      (listeners.window.hashchange || []).forEach((fn) => fn());

      return main.innerHTML;

    },

    undo() { const b = { dataset: { action: 'undo' } }; (listeners.document.click || []).forEach((fn) => fn({ target: { closest: () => b }, preventDefault() {} })); },

    load(state) {

      ['entries', 'journal', 'drafts', 'undo', 'writer', 'seq', 'correspondences', 'templates'].forEach((k) => { S[k] = JSON.parse(JSON.stringify(state[k])); });

      Object.assign(S, { sel: null, followFor: null, relFor: null, corrEdit: null, importPreview: null, restoreAsk: null, phone: null, phonePair: null });

    }

  };

}

