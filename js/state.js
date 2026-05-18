'use strict';

// ── App state ─────────────────────────────────────────────────────────────────
let state = {
  stocks:       [],
  crypto:       [],
  banks:        [],       // { name, currency, amount, rateToIDR, change24h }
  golds:        [],       // { name, grams, pricePerGram, change }
  properties:   [],       // { name, location, status, value, rent, snapshots:[] }
  manual:       [],       // legacy — kept for backward compat
  baseCurrency: 'IDR',   // display currency: IDR | USD | SGD | EUR | JPY | MYR | CNY
  baseLang:     null,    // null = auto-detect from browser on load
};

let goldData = null;  // cached gold price response from /gold
let fxData   = null;  // cached FX response from /fx

// ── Persistence ───────────────────────────────────────────────────────────────
(function loadState() {
  try {
    const saved = localStorage.getItem('nw-state-id');
    if (!saved) return;
    const parsed = JSON.parse(saved);
    // Merge: keep defaults for any keys missing in old saves (backward compat)
    state = Object.assign(state, parsed);
    // Guarantee all arrays exist even in old saves
    if (!state.banks)      state.banks      = [];
    if (!state.golds)      state.golds      = [];
    if (!state.properties) state.properties = [];
    if (!state.manual)     state.manual     = [];
    if (!state.stocks)     state.stocks     = [];
    if (!state.crypto)     state.crypto     = [];
  } catch (e) {
    console.warn('State load error:', e);
  }
})();

function save() {
  try {
    localStorage.setItem('nw-state-id', JSON.stringify(state));
  } catch (e) {}
}
