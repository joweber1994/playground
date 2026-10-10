(function () {
  'use strict';

  var meals = window.WochenzettelMeals;
  var catalog = window.WochenzettelOffers;
  var shop = window.WochenzettelShop;
  var syncApi = window.WochenzettelSync;
  var barcodeApi = window.WochenzettelBarcode;
  var eanScan = window.WochenzettelEan;
  var tickerApi = window.WochenzettelTicker;
  if (!meals || !catalog || !shop || !barcodeApi || !eanScan || !catalog.stores || !catalog.stores.length) return;

  var STORAGE_KEY = 'wochenzettel-v1';
  var LEGACY_STORAGE_KEY = 'wochenessen-v1';
  var state = meals.freshState(new Date());
  state.storeIds = [catalog.stores[0].id];
  state.categoryId = 'alle';
  state.extras = {};
  state.lines = [];
  state.checked = [];
  state.extraAmounts = {};
  state.checkMeta = {};
  state.skipped = [];
  state.skippedLog = {};
  state.pantryLog = {};
  state.claims = [];
  state.staples = [];
  state.recipes = [];
  state.overrides = [];
  state.inventory = [];
  state.inventorySet = false;
  state.evenings = [];
  state.weekRev = 0;
  state.storeRev = 0;
  state.pickedRev = 0;
  var view = { planItems: [] };
  var recipeDraft = [];
  var editSession = null;
  var hadSaved = false;
  var userEdited = false;
  var suppressPush = false;
  var session = null;
  var syncStatus = 'local';
  var localUpdatedAt = 0;
  var editHistory = shop.emptyHistory();
  var clearArmed = false;
  var clearTimer = null;
  var renameId = null;
  var focusRename = false;
  var scanning = false;
  var scanPaused = false;
  var scanBusy = false;
  var scanStream = null;
  var scanTimer = 0;
  var scanDetector = null;
  var scanAbort = null;
  var scanGen = 0;
  var heldCode = '';
  var heldClearAt = 0;
  var pendingCode = '';
  var tickerState = tickerApi ? tickerApi.blank() : { items: [] };

  var els = {
    weekLine: document.getElementById('week-line'),
    week: document.getElementById('week-note'),
    stores: document.getElementById('stores'),
    combo: document.getElementById('combo'),
    unavailable: document.getElementById('unavailable'),
    storeNote: document.getElementById('store-note'),
    prospekte: document.getElementById('prospekte'),
    categories: document.getElementById('offer-categories'),
    matched: document.getElementById('matched'),
    offerScroll: document.getElementById('offer-scroll'),
    extraWrap: document.getElementById('extra-store-wrap'),
    extraStore: document.getElementById('extra-store'),
    form: document.getElementById('offer-form'),
    text: document.getElementById('offer-text'),
    note: document.getElementById('offer-note'),
    inventoryForm: document.getElementById('inventory-form'),
    inventoryText: document.getElementById('inventory-text'),
    inventoryAmount: document.getElementById('inventory-amount'),
    inventoryNote: document.getElementById('inventory-note'),
    inventoryEmpty: document.getElementById('inventory-empty'),
    inventory: document.getElementById('inventory'),
    scanOpen: document.getElementById('scan-open'),
    scanner: document.getElementById('scanner'),
    scannerVideo: document.getElementById('scanner-video'),
    scannerCanvas: document.getElementById('scanner-canvas'),
    scannerStatus: document.getElementById('scanner-status'),
    scannerNameForm: document.getElementById('scanner-name-form'),
    scannerNameHint: document.getElementById('scanner-name-hint'),
    scannerName: document.getElementById('scanner-name'),
    ideas: document.getElementById('ideas'),
    storePicks: document.getElementById('store-picks'),
    shopHeading: document.getElementById('shop-heading'),
    shopProgress: document.getElementById('shop-progress'),
    shopForm: document.getElementById('shop-form'),
    shopText: document.getElementById('shop-text'),
    shopAmount: document.getElementById('shop-amount'),
    shopNote: document.getElementById('shop-note'),
    shopEmpty: document.getElementById('shop-empty'),
    shop: document.getElementById('shop-list'),
    displayName: document.getElementById('display-name'),
    copyList: document.getElementById('copy-list'),
    finishTrip: document.getElementById('finish-trip'),
    undoBtn: document.getElementById('undo'),
    redoBtn: document.getElementById('redo'),
    clearList: document.getElementById('clear-list'),
    claims: document.getElementById('claims'),
    evenings: document.getElementById('evenings'),
    recipeForm: document.getElementById('recipe-form'),
    recipeTitle: document.getElementById('recipe-title'),
    recipeIngredient: document.getElementById('recipe-ingredient'),
    recipeAmount: document.getElementById('recipe-amount'),
    recipeAdd: document.getElementById('recipe-add'),
    recipeIngredients: document.getElementById('recipe-ingredients'),
    recipeNote: document.getElementById('recipe-note'),
    stapleForm: document.getElementById('staple-form'),
    stapleText: document.getElementById('staple-text'),
    stapleAmount: document.getElementById('staple-amount'),
    stapleNote: document.getElementById('staple-note'),
    staples: document.getElementById('staples'),
    sync: document.getElementById('sync-status'),
    sheet: document.getElementById('sheet'),
    sheetForm: document.getElementById('sheet-form'),
    sheetBody: document.getElementById('sheet-body'),
    sheetError: document.getElementById('sheet-error'),
    sheetSubmit: document.getElementById('sheet-submit'),
    tickerBanner: document.getElementById('ticker-banner'),
    tickerForm: document.getElementById('ticker-form'),
    tickerText: document.getElementById('ticker-text'),
    tickerNote: document.getElementById('ticker-note'),
    tickerEmpty: document.getElementById('ticker-empty'),
    tickerList: document.getElementById('ticker-list'),
    connectivity: document.getElementById('connectivity'),
    live: document.getElementById('live'),
    content: document.querySelector('.content'),
    tabs: document.getElementById('tabs')
  };

  var TAB_IDS = ['einkauf', 'angebote', 'gerichte', 'vorrat'];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function announce(message) {
    if (els.live) els.live.textContent = message;
  }

  function tabButton(id) {
    return document.getElementById('tab-' + id);
  }

  function tabPanel(id) {
    return document.getElementById('panel-' + id);
  }

  function activeTab() {
    var current = TAB_IDS[0];
    TAB_IDS.forEach(function (id) {
      var button = tabButton(id);
      if (button && button.getAttribute('aria-selected') === 'true') current = id;
    });
    return current;
  }

  function selectTab(id) {
    disarmClear();
    if (TAB_IDS.indexOf(id) === -1) id = TAB_IDS[0];
    TAB_IDS.forEach(function (tabId) {
      var on = tabId === id;
      var button = tabButton(tabId);
      var panel = tabPanel(tabId);
      if (!button || !panel) return;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
      if (on) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    });
    if (els.content) els.content.scrollTop = 0;
  }

  function focusTab(id) {
    var button = tabButton(id);
    if (button) button.focus();
  }

  function moveTab(delta) {
    var index = TAB_IDS.indexOf(activeTab());
    if (index < 0) index = 0;
    var next = (index + delta + TAB_IDS.length) % TAB_IDS.length;
    selectTab(TAB_IDS[next]);
    focusTab(TAB_IDS[next]);
  }

  function dateParts(iso) {
    var parts = String(iso || '').split('-');
    if (parts.length !== 3) return null;
    return { year: parts[0], month: Number(parts[1]), day: Number(parts[2]) };
  }

  function deDate(iso) {
    var parts = dateParts(iso);
    if (!parts) return String(iso || '');
    return parts.day + '.' + parts.month + '.' + parts.year;
  }

  function deDay(iso) {
    var parts = dateParts(iso);
    if (!parts) return String(iso || '');
    return parts.day + '.' + parts.month + '.';
  }

  function endOfDay(iso) {
    var parts = dateParts(iso);
    if (!parts) return null;
    return new Date(Number(parts.year), parts.month - 1, parts.day, 23, 59, 59);
  }

  function storeById(id) {
    var stores = catalog.stores;
    for (var i = 0; i < stores.length; i += 1) {
      if (stores[i].id === id) return stores[i];
    }
    return null;
  }

  function joinNames(names) {
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' und ' + names[1];
    return names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1];
  }

  function orderedIds(ids) {
    var wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    return catalog.stores.filter(function (store) { return wanted[store.id]; }).map(function (store) { return store.id; });
  }

  function selectedStores() {
    return orderedIds(state.storeIds).map(storeById);
  }

  function extrasFor(storeId) {
    var list = state.extras && state.extras[storeId];
    return Array.isArray(list) ? list : [];
  }

  function loadTicker() {
    if (!tickerApi) return { items: [] };
    var raw = null;
    var legacyKey = '';
    try {
      raw = localStorage.getItem(tickerApi.STORAGE_KEY);
      if (!raw) {
        var keys = tickerApi.LEGACY_KEYS || [];
        for (var i = 0; i < keys.length; i += 1) {
          raw = localStorage.getItem(keys[i]);
          if (raw) {
            legacyKey = keys[i];
            break;
          }
        }
      }
    } catch (error) {
      raw = null;
    }
    var next = tickerApi.blank();
    if (raw) {
      try { next = tickerApi.normalize(JSON.parse(raw)); } catch (error) { next = tickerApi.blank(); }
    }
    if (legacyKey) {
      tickerState = next;
      saveTicker();
      try { localStorage.removeItem(legacyKey); } catch (error) { /* bleibt sonst ungelesen */ }
    }
    return next;
  }

  function saveTicker() {
    if (!tickerApi) return false;
    try {
      localStorage.setItem(tickerApi.STORAGE_KEY, JSON.stringify(tickerState));
      return true;
    } catch (error) {
      return false;
    }
  }

  function hitText(hit) {
    var parts = [];
    if (hit.storeName) parts.push(hit.storeName);
    parts.push(hit.name);
    if (hit.amount) parts.push(hit.amount);
    if (hit.price) parts.push(hit.price);
    return parts.join(' · ');
  }

  function tickerStores() {
    return catalog.stores.map(function (store) {
      return { id: store.id, name: store.name, offers: offersFor(store) };
    });
  }

  function renderTicker() {
    if (!els.tickerList || !tickerApi) return;
    var rows = tickerApi.reminders(tickerState, tickerStores());
    var ready = rows.filter(function (row) { return row.hits.length > 0; });
    var status = '';
    if (rows.length && !ready.length) status = 'Diese Woche keiner der gemerkten Artikel im Angebot.';
    else if (ready.length === 1) status = ready[0].query + ' ist im Angebot.';
    else if (ready.length > 1) status = ready.map(function (row) { return row.query; }).join(', ') + ' sind im Angebot.';
    if (els.tickerNote) els.tickerNote.textContent = status;
    if (els.tickerBanner) {
      els.tickerBanner.hidden = ready.length === 0;
      els.tickerBanner.textContent = status;
    }
    if (els.tickerEmpty) els.tickerEmpty.hidden = rows.length > 0;
    els.tickerList.hidden = rows.length === 0;
    els.tickerList.innerHTML = rows.map(function (row) {
      var hits = '';
      if (row.hits.length) {
        hits = row.hits.slice(0, 4).map(function (hit) {
          return '<p class="ticker-hit">' + escapeHtml(hitText(hit)) + '</p>';
        }).join('');
        if (row.hits.length > 4) {
          var extra = row.hits.length - 4;
          hits += '<p class="ticker-miss">' + (extra === 1 ? 'und 1 weiteres' : 'und ' + extra + ' weitere') + '</p>';
        }
      } else {
        hits = '<p class="ticker-miss">Diese Woche nicht im Angebot.</p>';
      }
      return '<li class="ticker-card' + (row.hits.length ? ' is-hit' : '') + '">' +
        '<div class="ticker-top"><p class="ticker-query">' + escapeHtml(row.query) + '</p>' +
        '<button type="button" class="ticker-remove" data-ticker-remove="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml(row.query + ' vom Ticker nehmen') + '">Entfernen</button></div>' +
        hits + '</li>';
    }).join('');
  }

  function offersFor(store) {
    if (!store) return [];
    return (store.offers || []).concat(extrasFor(store.id).map(function (name) {
      return { name: name, price: '', amount: '', extra: true };
    }));
  }

  function ingredientIds(store) {
    return meals.idsFromOffers(offersFor(store));
  }

  function unionIds(stores) {
    var found = [];
    (stores || []).forEach(function (store) {
      ingredientIds(store).forEach(function (id) {
        if (found.indexOf(id) === -1) found.push(id);
      });
    });
    return found;
  }

  function mealCount(store) {
    return meals.suggest(ingredientIds(store), state.pantry, null, state.overrides).length;
  }

  function bestStoreId(pantry, overrides) {
    var best = catalog.stores[0];
    var bestCount = -1;
    catalog.stores.forEach(function (store) {
      var count = meals.suggest(meals.idsFromOffers(store.offers || []), pantry, null, overrides || state.overrides).length;
      if (count > bestCount) {
        bestCount = count;
        best = store;
      }
    });
    return best.id;
  }

  function cleanExtras(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      if (!storeById(key) || !Array.isArray(raw[key])) return;
      var names = [];
      raw[key].forEach(function (item) {
        var name = String(item || '').trim();
        if (!name || name.length > 80) return;
        if (names.length >= 40) return;
        names.push(name);
      });
      if (names.length) out[key] = names;
    });
    return out;
  }

  function readStorage() {
    try {
      var current = localStorage.getItem(STORAGE_KEY);
      if (current) return current;
      return localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function load() {
    var raw = readStorage();
    var saved = null;
    if (raw) {
      try { saved = JSON.parse(raw); } catch (error) { saved = null; }
    }
    var loaded = meals.normalizeState(saved, new Date());
    var next = loaded.state;
    var storedShop = shop.shopFromSaved(saved, loaded.weekChanged);
    next.extras = loaded.weekChanged ? {} : cleanExtras(saved && saved.extras);
    next.lines = storedShop.lines;
    next.checked = storedShop.checked;
    next.extraAmounts = storedShop.extraAmounts;
    next.checkMeta = storedShop.checkMeta;
    next.skipped = storedShop.skipped;
    next.claims = storedShop.claims;
    next.staples = storedShop.staples;
    next.recipes = meals.cleanCustomRecipes(saved && saved.recipes);
    next.overrides = meals.cleanOverrides(saved && saved.overrides);
    next.inventory = meals.ensureInventory(saved, next.pantry);
    next.inventorySet = true;
    next.pantry = meals.coveredIds(next.inventory);
    next.evenings = loaded.weekChanged ? [] : meals.cleanEvenings(saved && saved.evenings);
    next.pantryLog = shop.cleanFlagLog(saved && saved.pantryLog);
    next.skippedLog = loaded.weekChanged ? {} : shop.cleanFlagLog(saved && saved.skippedLog);
    next.weekRev = loaded.weekChanged ? Date.now() : revOf(saved && saved.weekRev);
    next.storeRev = revOf(saved && saved.storeRev);
    next.pickedRev = loaded.weekChanged ? Date.now() : revOf(saved && saved.pickedRev);
    if (saved && Array.isArray(saved.storeIds)) {
      next.storeIds = orderedIds(saved.storeIds.filter(function (id) { return storeById(id); }));
    } else if (saved && storeById(saved.storeId)) {
      next.storeIds = [saved.storeId];
    } else {
      next.storeIds = [bestStoreId(next.pantry, next.overrides)];
    }
    next.categoryId = meals.offerCategoryById(saved && saved.categoryId).id;
    return { state: next, weekChanged: loaded.weekChanged };
  }

  function revOf(value) {
    var rev = Number(value);
    if (!Number.isFinite(rev) || rev < 0) return 0;
    return Math.floor(rev);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* Private mode can reject storage; the page still works for this visit. */
    }
  }

  function save() {
    userEdited = true;
    persist();
    if (!suppressPush && session) session.noteLocalEdit();
  }

  function historyView() {
    return {
      lines: state.lines,
      checked: state.checked,
      checkMeta: state.checkMeta,
      skipped: state.skipped,
      skippedLog: state.skippedLog,
      extraAmounts: state.extraAmounts,
      picked: state.picked,
      pickedRev: state.pickedRev,
      evenings: state.evenings,
      pantry: state.pantry,
      pantryLog: state.pantryLog,
      claims: state.claims,
      staples: state.staples,
      inventory: state.inventory,
      overrides: state.overrides
    };
  }

  function syncHistoryButtons() {
    if (els.undoBtn) els.undoBtn.disabled = !editHistory.undo.length;
    if (els.redoBtn) els.redoBtn.disabled = !editHistory.redo.length;
  }

  function disarmClear() {
    clearArmed = false;
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    if (els.clearList) {
      els.clearList.textContent = 'Leeren';
      els.clearList.classList.remove('is-armed');
    }
  }

  function armClear() {
    clearArmed = true;
    if (els.clearList) {
      els.clearList.textContent = 'Wirklich leeren?';
      els.clearList.classList.add('is-armed');
    }
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(disarmClear, 4000);
    announce('Nochmal tippen, dann wird die Liste geleert.');
  }

  function remember() {
    editHistory = shop.pushHistory(editHistory, historyView());
    syncHistoryButtons();
    disarmClear();
  }

  function applySnapshot(next) {
    state.lines = next.lines;
    state.checked = next.checked;
    state.checkMeta = next.checkMeta;
    state.skipped = next.skipped;
    state.skippedLog = next.skippedLog;
    state.extraAmounts = next.extraAmounts;
    state.picked = next.picked;
    state.pickedRev = next.pickedRev;
    state.evenings = next.evenings;
    state.pantry = next.pantry;
    state.pantryLog = next.pantryLog;
    state.claims = next.claims;
    state.staples = next.staples;
    state.inventory = next.inventory || [];
    state.overrides = next.overrides || [];
    state.inventorySet = true;
    if (els.inventoryNote) els.inventoryNote.textContent = '';
    save();
    render();
  }

  function undoEdit() {
    var result = shop.undoHistory(editHistory, historyView());
    editHistory = result.history;
    syncHistoryButtons();
    disarmClear();
    if (!result.state) return;
    applySnapshot(result.state);
    els.shopNote.textContent = 'Rückgängig.';
    if (els.note) els.note.textContent = '';
    announce(els.shopNote.textContent);
  }

  function redoEdit() {
    var result = shop.redoHistory(editHistory, historyView());
    editHistory = result.history;
    syncHistoryButtons();
    disarmClear();
    if (!result.state) return;
    applySnapshot(result.state);
    els.shopNote.textContent = 'Wiederholt.';
    if (els.note) els.note.textContent = '';
    announce(els.shopNote.textContent);
  }

  function listBusy() {
    if (shop.aliveLines(state.lines).length) return true;
    if ((state.checked || []).length) return true;
    if ((state.skipped || []).length) return true;
    if (state.picked && state.picked.length) return true;
    if (state.extraAmounts && Object.keys(state.extraAmounts).length) return true;
    var pending = false;
    (state.evenings || []).forEach(function (row) {
      if (row && (row.recipeId || row.cook)) pending = true;
    });
    return pending;
  }

  function clearShoppingList() {
    if (!listBusy()) {
      disarmClear();
      els.shopNote.textContent = 'Die Liste ist schon leer.';
      announce(els.shopNote.textContent);
      return;
    }
    if (!clearArmed) {
      armClear();
      return;
    }
    remember();
    var cleared = shop.clearList(historyView(), Date.now());
    state.lines = cleared.lines;
    state.checked = cleared.checked;
    state.checkMeta = cleared.checkMeta;
    state.skipped = cleared.skipped;
    state.skippedLog = cleared.skippedLog;
    state.extraAmounts = cleared.extraAmounts;
    state.picked = cleared.picked;
    state.pickedRev = cleared.pickedRev;
    state.evenings = cleared.evenings;
    save();
    render();
    els.shopNote.textContent = 'Liste geleert.';
    announce(els.shopNote.textContent);
  }

  function displayName() {
    return shop.clipPerson(els.displayName ? els.displayName.value : '');
  }

  function touchPantry(id, on) {
    state.pantryLog[id] = { on: !!on, rev: Date.now() };
  }

  function publishPantry() {
    var covered = meals.coveredIds(state.inventory);
    var prev = {};
    (state.pantry || []).forEach(function (id) { prev[id] = true; });
    var next = {};
    covered.forEach(function (id) { next[id] = true; });
    Object.keys(prev).forEach(function (id) {
      if (!next[id]) touchPantry(id, false);
    });
    covered.forEach(function (id) {
      if (!prev[id]) touchPantry(id, true);
    });
    state.pantry = covered;
  }

  function suggestions() {
    return meals.suggest(unionIds(selectedStores()), state.pantry, state.recipes, state.overrides);
  }

  function sources() {
    return selectedStores().map(function (store) {
      return {
        id: store.id,
        name: store.name,
        offers: ingredientIds(store)
      };
    });
  }

  function formatPrice(price) {
    var text = String(price == null ? '' : price).trim();
    if (!text) return '';
    if (/^\d+\.\d+$/.test(text) || /^\d+$/.test(text)) return text.replace('.', ',') + ' €';
    return text;
  }

  function plural(count, one, many) {
    return (count === 1 ? '1 ' + one : count + ' ' + many);
  }

  function renderWeek() {
    els.weekLine.textContent = 'Gelesen am ' + deDate(catalog.extractedAt) + ', gültig ' + deDay(catalog.validFrom) + ' bis ' + deDate(catalog.validUntil) + '.';
  }

  function renderUnavailable() {
    var list = catalog.unavailable || [];
    if (!list.length) {
      els.unavailable.textContent = '';
      return;
    }
    var names = list.map(function (item) { return item.name; });
    var sentence = names[0];
    if (names.length === 2) sentence = names[0] + ' und ' + names[1];
    if (names.length > 2) sentence = names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1];
    els.unavailable.textContent = sentence + (names.length === 1 ? ' lässt sich nicht auslesen.' : ' lassen sich nicht auslesen.');
  }

  function renderStores() {
    var selected = selectedStores();
    els.stores.innerHTML = catalog.stores.map(function (store) {
      var pressed = state.storeIds.indexOf(store.id) !== -1;
      return '<button type="button" class="store-card" data-store="' + store.id + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' +
        '<span class="store-name">' + escapeHtml(store.name) + '</span>' +
        '<span class="store-count">' + plural(offersFor(store).length, 'Artikel', 'Artikel') + '</span>' +
        '<span class="store-count">' + plural(mealCount(store), 'Gericht', 'Gerichte') + '</span>' +
        '</button>';
    }).join('');
    if (!selected.length) {
      els.combo.textContent = 'Noch kein Supermarkt ausgewählt.';
      return;
    }
    if (selected.length === 1) {
      els.combo.textContent = '';
      return;
    }
    var count = meals.suggest(unionIds(selected), state.pantry, null, state.overrides).length;
    els.combo.textContent = joinNames(selected.map(function (store) { return store.name; })) + ' zusammen: ' + plural(count, 'Gericht', 'Gerichte') + '.';
  }

  function sortedIngredientIds(ids) {
    var order = {};
    meals.GROUPS.forEach(function (group, index) { order[group.id] = index; });
    return ids.slice().sort(function (a, b) {
      var left = meals.ingredient(a);
      var right = meals.ingredient(b);
      var groupDelta = (left ? order[left.group] : 99) - (right ? order[right.group] : 99);
      if (groupDelta) return groupDelta;
      return (left ? left.name : a).localeCompare(right ? right.name : b, 'de');
    });
  }

  function renderMatched(ids) {
    if (!ids.length) {
      els.matched.hidden = true;
      els.matched.innerHTML = '';
      return;
    }
    els.matched.hidden = false;
    els.matched.innerHTML = sortedIngredientIds(ids).map(function (id) {
      var item = meals.ingredient(id);
      return '<span class="chip is-static">' + escapeHtml(item ? item.name : id) + '</span>';
    }).join('');
  }

  function combinedRows(stores) {
    var rows = [];
    stores.forEach(function (store) {
      offersFor(store).forEach(function (offer) {
        rows.push({
          name: offer.name,
          price: offer.price,
          amount: offer.amount,
          extra: offer.extra,
          storeName: store.name,
          storeId: store.id
        });
      });
    });
    return rows.sort(function (a, b) {
      var leftHit = meals.matchOfferText(a.name).length ? 0 : 1;
      var rightHit = meals.matchOfferText(b.name).length ? 0 : 1;
      if (leftHit !== rightHit) return leftHit - rightHit;
      return String(a.name).localeCompare(String(b.name), 'de');
    });
  }

  function categoryCounts(rows) {
    var counts = {};
    meals.OFFER_CATEGORIES.forEach(function (cat) { counts[cat.id] = 0; });
    counts.alle = rows.length;
    rows.forEach(function (row) {
      var id = meals.offerCategory(row.name);
      if (typeof counts[id] !== 'number') id = 'sonstiges';
      counts[id] += 1;
    });
    return counts;
  }

  function renderCategories(rows) {
    var counts = categoryCounts(rows);
    if (state.categoryId !== 'alle' && !counts[state.categoryId]) state.categoryId = 'alle';
    els.categories.innerHTML = meals.OFFER_CATEGORIES.filter(function (cat) {
      return cat.id === 'alle' || counts[cat.id] > 0;
    }).map(function (cat) {
      var on = cat.id === state.categoryId;
      return '<button type="button" class="chip" data-category="' + cat.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        escapeHtml(cat.label + ' ' + counts[cat.id]) + '</button>';
    }).join('');
  }

  function renderOfferList(stores) {
    view.planItems = currentPlanItems();
    var rows = combinedRows(stores);
    renderCategories(rows);
    if (state.categoryId !== 'alle') {
      rows = rows.filter(function (row) { return meals.offerCategory(row.name) === state.categoryId; });
    }
    if (!combinedRows(stores).length) {
      els.offerScroll.innerHTML = '<p class="empty offer-empty">In diesen Prospekten stehen keine Lebensmittel.</p>';
      return;
    }
    if (!rows.length) {
      els.offerScroll.innerHTML = '<p class="empty offer-empty">In dieser Kategorie ist nichts reduziert.</p>';
      return;
    }
    var showStore = stores.length > 1;
    els.offerScroll.innerHTML = rows.map(function (offer) {
      var hit = meals.matchOfferText(offer.name).length > 0;
      var meta = [showStore ? offer.storeName : '', formatPrice(offer.price), offer.amount].filter(function (part) { return part; }).join(' · ');
      var listed = shop.offerListed(state.lines, view.planItems, offer.storeId, offer.name);
      return '<div class="offer-row' + (hit ? ' is-hit' : '') + '">' +
        '<div class="offer-main">' +
        '<span class="offer-name">' + escapeHtml(offer.name) +
        (offer.extra ? ' <span class="offer-extra">ergänzt</span>' : '') + '</span>' +
        (meta ? '<span class="offer-meta">' + escapeHtml(meta) + '</span>' : '') +
        '</div>' +
        '<button type="button" class="offer-add" data-offer-add="1" data-store="' + escapeHtml(offer.storeId) + '" data-name="' + escapeHtml(offer.name) + '" data-price="' + escapeHtml(offer.price || '') + '" data-amount="' + escapeHtml(offer.amount || '') + '" aria-pressed="' + (listed ? 'true' : 'false') + '">' +
        (listed ? 'Auf der Liste' : 'Auf die Liste') + '</button></div>';
    }).join('');
  }

  function renderStoreDetail() {
    var stores = selectedStores();
    if (!stores.length) {
      els.storeNote.textContent = 'Wähl mindestens einen Supermarkt. Die Angebote werden zusammengezählt.';
      els.prospekte.innerHTML = '';
      els.categories.innerHTML = '';
      renderMatched([]);
      els.offerScroll.innerHTML = '<p class="empty offer-empty">Noch kein Prospekt ausgewählt.</p>';
      return;
    }
    var note = stores.length > 1
      ? 'Zusammengezählt: ' + joinNames(stores.map(function (store) { return store.name; })) + '.'
      : (stores[0].note || '');
    stores.forEach(function (store) {
      if (stores.length > 1 && store.note) note += ' ' + store.name + ': ' + store.note;
      if (store.otherCount) {
        note += (note ? ' ' : '') + (stores.length > 1 ? store.name + ': ' : '') + store.otherCount + ' weitere Artikel aus Haushalt, Mode und Ähnlichem stehen nicht in der Liste.';
      }
    });
    els.storeNote.textContent = note;
    els.prospekte.innerHTML = stores.map(function (store) {
      return '<a class="prospekt" href="' + escapeHtml(store.source || '#') + '" target="_blank" rel="noopener noreferrer">Prospekt von ' + escapeHtml(store.name) + ' öffnen</a>';
    }).join('');
    renderMatched(unionIds(stores));
    renderOfferList(stores);
  }

  function renderChoice() {
    els.storePicks.innerHTML = catalog.stores.map(function (store) {
      var pressed = state.storeIds.indexOf(store.id) !== -1;
      return '<button type="button" class="store-pick" data-store="' + store.id + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' + escapeHtml(store.name) + '</button>';
    }).join('');
    var stores = selectedStores();
    var previous = els.extraStore.value;
    els.extraWrap.hidden = stores.length < 2;
    els.extraStore.innerHTML = stores.map(function (store) {
      return '<option value="' + store.id + '">' + escapeHtml(store.name) + '</option>';
    }).join('');
    if (stores.some(function (store) { return store.id === previous; })) els.extraStore.value = previous;
  }

  function inventoryDetail(item) {
    var units = item.units > 0 ? String(item.units) : '';
    var amount = item.amount || '';
    if (units && amount) return units + ' · ' + amount;
    return units || amount;
  }

  function renderInventory() {
    if (!els.inventory) return;
    var rows = (state.inventory || []).filter(function (item) { return !item.deleted; });
    if (renameId && !rows.some(function (item) { return item.id === renameId; })) renameId = null;
    if (els.inventoryEmpty) els.inventoryEmpty.hidden = rows.length > 0;
    els.inventory.innerHTML = rows.map(function (item) {
      if (item.id === renameId) {
        return '<li class="stock-card"><form class="rename-form" data-rename-form="' + escapeHtml(item.id) + '">' +
          '<label class="field grow"><span class="sr-only">Name</span>' +
          '<input type="text" maxlength="80" value="' + escapeHtml(item.name) + '" enterkeyhint="done" autocomplete="off"></label>' +
          '<button type="submit">Sichern</button>' +
          '<button type="button" data-rename-cancel>Abbrechen</button></form></li>';
      }
      var detail = inventoryDetail(item);
      return '<li class="stock-card"><div class="stock-main"><span class="shop-name">' + escapeHtml(item.name) + '</span>' +
        '<div class="stock-step">' +
        '<button type="button" class="stock-step-btn" data-inventory-step="-1" data-inventory-id="' + escapeHtml(item.id) + '" aria-label="Menge ' + escapeHtml(item.name) + ' verringern">−</button>' +
        '<span class="stock-qty">' + escapeHtml(detail || '') + '</span>' +
        '<button type="button" class="stock-step-btn" data-inventory-step="1" data-inventory-id="' + escapeHtml(item.id) + '" aria-label="Menge ' + escapeHtml(item.name) + ' erhöhen">+</button>' +
        '</div></div><div class="stock-actions">' +
        '<button type="button" class="shop-remove" data-inventory-rename="' + escapeHtml(item.id) + '">Ändern</button>' +
        '<button type="button" class="shop-remove" data-inventory-remove="' + escapeHtml(item.id) + '">Entfernen</button></div></li>';
    }).join('');
    if (focusRename) {
      focusRename = false;
      var input = els.inventory.querySelector('[data-rename-form] input');
      if (input) input.focus();
    }
  }

  function ingredientOptions(selected) {
    return meals.INGREDIENTS.map(function (item) {
      return '<option value="' + item.id + '"' + (item.id === selected ? ' selected' : '') + '>' + escapeHtml(item.name) + '</option>';
    }).join('');
  }

  function editFormHtml() {
    if (!editSession) return '';
    var items = editSession.ingredients.map(function (item, index) {
      var info = meals.ingredient(item.id);
      var label = (info ? info.name : item.id) + (item.amount ? ' ' + item.amount : '');
      return '<li><span>' + escapeHtml(label) + '</span>' +
        '<button type="button" class="shop-skip" data-edit-drop="' + index + '">Weg</button></li>';
    }).join('');
    return '<form class="recipe-form meal-edit" data-edit-form data-edit-id="' + escapeHtml(editSession.id) + '">' +
      '<label class="field"><span class="sr-only">Name des Gerichts</span>' +
      '<input data-edit-title type="text" maxlength="80" value="' + escapeHtml(editSession.title) + '" placeholder="Name des Gerichts"></label>' +
      '<div class="recipe-add">' +
      '<label class="field grow"><span class="sr-only">Zutat</span><select data-edit-ingredient>' + ingredientOptions(editSession.ingredientId) + '</select></label>' +
      '<label class="field recipe-qty"><span class="sr-only">Menge der Zutat</span>' +
      '<input data-edit-amount type="text" maxlength="40" placeholder="Menge" value="' + escapeHtml(editSession.amount || '') + '"></label>' +
      '<button type="button" data-edit-add>Zutat</button></div>' +
      '<ul class="recipe-ingredients">' + items + '</ul>' +
      '<label class="field"><span class="sr-only">Kochschritte</span>' +
      '<textarea data-edit-steps rows="4" placeholder="Schritte, eine Zeile pro Schritt">' + escapeHtml(editSession.stepsText || '') + '</textarea></label>' +
      '<p class="hint" data-edit-note>' + escapeHtml(editSession.note || '') + '</p>' +
      '<div class="meal-edit-actions"><button type="submit">Sichern</button>' +
      '<button type="button" data-edit-cancel>Abbrechen</button></div></form>';
  }

  function readEditorFields() {
    if (!editSession || !els.ideas) return;
    var form = els.ideas.querySelector('[data-edit-form]');
    if (!form || form.getAttribute('data-edit-id') !== editSession.id) return;
    var title = els.ideas.querySelector('[data-edit-title]');
    var steps = els.ideas.querySelector('[data-edit-steps]');
    var amount = els.ideas.querySelector('[data-edit-amount]');
    var ingredient = els.ideas.querySelector('[data-edit-ingredient]');
    if (title) editSession.title = title.value;
    if (steps) editSession.stepsText = steps.value;
    if (amount) editSession.amount = amount.value;
    if (ingredient) editSession.ingredientId = ingredient.value;
  }

  function openEditor(id) {
    var recipe = null;
    suggestions().forEach(function (item) {
      if (item.id === id) recipe = item;
    });
    if (!recipe) return;
    editSession = {
      id: recipe.id,
      custom: !!recipe.custom,
      title: recipe.title,
      minutes: recipe.minutes || 20,
      ingredients: (recipe.ingredients || []).map(function (item) {
        return { id: item.id, amount: item.amount || '1' };
      }),
      stepsText: (recipe.steps || []).join('\n'),
      amount: '',
      ingredientId: meals.INGREDIENTS[0] ? meals.INGREDIENTS[0].id : '',
      note: ''
    };
    renderIdeas();
    var title = els.ideas.querySelector('[data-edit-title]');
    if (title) title.focus();
  }

  function closeEditor() {
    editSession = null;
    renderIdeas();
  }

  function addEditIngredient() {
    readEditorFields();
    var id = editSession.ingredientId;
    if (!id || !meals.ingredient(id)) return;
    var amount = shop.fold(editSession.amount) || '1';
    if (amount.length > 40) {
      editSession.note = 'Die Menge ist zu lang.';
      renderIdeas();
      return;
    }
    var next = editSession.ingredients.filter(function (item) { return item.id !== id; });
    next.push({ id: id, amount: amount });
    editSession.ingredients = next;
    editSession.amount = '';
    editSession.note = '';
    renderIdeas();
    var field = els.ideas.querySelector('[data-edit-amount]');
    if (field) field.focus();
  }

  function saveEditor(event) {
    if (event) event.preventDefault();
    if (!editSession) return;
    readEditorFields();
    var title = shop.fold(editSession.title);
    if (!title) {
      editSession.note = 'Trag einen Namen ein.';
      renderIdeas();
      return;
    }
    if (!editSession.ingredients.length) {
      editSession.note = 'Mindestens eine Zutat.';
      renderIdeas();
      return;
    }
    var steps = String(editSession.stepsText || '').split(/\n/).map(function (line) {
      return shop.fold(line);
    }).filter(function (line) { return !!line; });
    if (steps.length > 8 || steps.some(function (line) { return line.length > 240; })) {
      editSession.note = 'Ein Schritt ist zu lang.';
      renderIdeas();
      return;
    }
    var ingredients = editSession.ingredients.map(function (item) {
      return { id: item.id, amount: item.amount || '1' };
    });
    if (editSession.custom) {
      var nextRecipes = state.recipes.map(function (recipe) {
        if (recipe.id !== editSession.id) return recipe;
        return Object.assign({}, recipe, {
          title: title,
          steps: steps,
          ingredients: ingredients,
          rev: Date.now(),
          deleted: false
        });
      });
      var cleaned = meals.cleanCustomRecipes(nextRecipes);
      var kept = cleaned.some(function (recipe) { return recipe.id === editSession.id && !recipe.deleted; });
      if (!kept) {
        editSession.note = 'Das Gericht ließ sich nicht sichern.';
        renderIdeas();
        return;
      }
      remember();
      state.recipes = cleaned;
    } else {
      var saved = meals.saveOverride(state.overrides, {
        id: editSession.id,
        title: title,
        minutes: editSession.minutes,
        steps: steps,
        ingredients: ingredients,
        rev: Date.now(),
        deleted: false
      });
      if (!saved.ok) {
        editSession.note = 'Das Gericht ließ sich nicht sichern.';
        renderIdeas();
        return;
      }
      remember();
      state.overrides = saved.overrides;
    }
    editSession = null;
    save();
    render();
    announce(title + ' ist gespeichert. Das Rezept bleibt am Gericht.');
  }

  function resetGenerated(id) {
    remember();
    state.overrides = meals.resetOverride(state.overrides, id, Date.now());
    if (editSession && editSession.id === id) editSession = null;
    save();
    render();
    announce('Wieder das ursprüngliche Rezept.');
  }

  function renderIdeas() {
    var list = suggestions();
    var chosen = meals.chosenIds(list, state.picked);
    if (!selectedStores().length && !list.some(function (recipe) { return recipe.custom; })) {
      els.ideas.innerHTML = '<p class="empty">Wähl mindestens einen Supermarkt. Die Angebote werden zusammengezählt.</p>';
      return;
    }
    if (!list.length) {
      els.ideas.innerHTML = '<p class="empty">Aus diesen Angeboten lässt sich keins der Gerichte kochen.</p>';
      return;
    }
    els.ideas.innerHTML = list.map(function (recipe) {
      var on = chosen.indexOf(recipe.id) !== -1;
      var several = selectedStores().length > 1;
      var hits = recipe.hits.map(function (item) {
        var label = item.name;
        if (several) {
          var places = selectedStores().filter(function (store) {
            return ingredientIds(store).indexOf(item.id) !== -1;
          }).map(function (store) { return store.name; });
          if (places.length) label += ' (' + places.join(', ') + ')';
        }
        return escapeHtml(label);
      }).join(', ');
      var missing = recipe.missing.length
        ? 'Dazu: ' + recipe.missing.map(function (item) {
          return escapeHtml(item.name + ' ' + item.amount);
        }).join(', ')
        : 'Nichts extra kaufen';
      var steps = (recipe.steps || []).map(function (step) {
        return '<li>' + escapeHtml(step) + '</li>';
      }).join('');
      var editing = editSession && editSession.id === recipe.id;
      var actionButtons = (editing ? '' : '<button type="button" class="shop-skip" data-edit-recipe="' + escapeHtml(recipe.id) + '">Bearbeiten</button>') +
        (!recipe.custom && recipe.edited ? '<button type="button" class="shop-skip" data-reset-recipe="' + escapeHtml(recipe.id) + '">Zurücksetzen</button>' : '') +
        (recipe.custom ? '<button type="button" class="shop-skip" data-drop-recipe="' + escapeHtml(recipe.id) + '">Gericht löschen</button>' : '');
      var actions = actionButtons ? '<div class="meal-actions">' + actionButtons + '</div>' : '';
      return '<article class="meal">' +
        '<div class="meal-top"><h3>' + escapeHtml(recipe.title) + (recipe.custom ? ' <span class="offer-extra">eigen</span>' : '') + '</h3>' +
        '<p class="meta">' + recipe.minutes + ' Min · ' + plural(recipe.hits.length, 'Angebot', 'Angebote') + '</p></div>' +
        '<p class="hits">Im Angebot: ' + hits + '</p>' +
        '<p class="missing">' + missing + '</p>' +
        (steps ? '<details class="meal-steps"><summary>Zubereitung</summary><ol class="steps">' + steps + '</ol></details>' : '') +
        (editing ? editFormHtml() : '') +
        '<div class="meal-bar">' + actions +
        '<button type="button" class="pick" data-pick="' + recipe.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        (on ? 'Auf der Einkaufsliste' : 'Auf die Einkaufsliste') + '</button></div></article>';
    }).join('');
  }

  function visiblePlan() {
    var list = suggestions();
    if (!list.length || !meals.chosenIds(list, state.picked).length) return { offers: [], missing: [] };
    return shop.withoutSkipped(meals.shopPlan(list, state.picked, sources()), state.skipped);
  }

  function currentPlanItems() {
    var plan = visiblePlan();
    var items = [];
    plan.offers.forEach(function (group) {
      group.items.forEach(function (item) { items.push(item); });
    });
    plan.missing.forEach(function (item) { items.push(item); });
    return items;
  }

  function isChecked(key) {
    return state.checked.indexOf(key) !== -1;
  }

  function planAmounts(item) {
    var amounts = (item.amounts || []).slice();
    var extra = state.extraAmounts[item.id] || [];
    extra.forEach(function (amount) {
      if (amounts.indexOf(amount) === -1) amounts.push(amount);
    });
    return amounts;
  }

  function checkButton(opts) {
    var on = isChecked(opts.key);
    var parts = [];
    if (opts.amounts && opts.amounts.length) parts.push(opts.amounts.join(' · '));
    if (opts.price) parts.push(formatPrice(opts.price));
    if (opts.storeName) parts.push(opts.storeName);
    var mealsLine = opts.meals && opts.meals.length
      ? '<span class="shop-meals">für ' + escapeHtml(opts.meals.join(', ')) + '</span>'
      : '';
    var who = whoLine(opts.key, opts.addedBy);
    return '<button type="button" class="shop-item' + (on ? ' is-checked' : '') + '" data-check="' + escapeHtml(opts.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="shop-tick" aria-hidden="true"></span>' +
      '<span class="shop-copy">' +
      '<span class="shop-name">' + escapeHtml(opts.name) + '</span>' +
      (parts.length ? '<span class="shop-amount">' + escapeHtml(parts.join(' · ')) + '</span>' : '') +
      mealsLine +
      who +
      '</span></button>';
  }

  function whoLine(key, addedBy) {
    var meta = state.checkMeta && state.checkMeta[key];
    if (isChecked(key) && meta && meta.by) return '<span class="shop-meals">abgehakt von ' + escapeHtml(meta.by) + '</span>';
    if (addedBy) return '<span class="shop-meals">von ' + escapeHtml(addedBy) + '</span>';
    return '';
  }

  function planRow(item) {
    return '<li class="shop-row">' + checkButton({
      key: shop.planCheckKey(item.id),
      name: item.name,
      amounts: planAmounts(item),
      meals: item.meals
    }) + '<button type="button" class="shop-skip" data-skip="' + escapeHtml(item.id) + '">Weglassen</button></li>';
  }

  function lineRow(line, showStore) {
    return '<li class="shop-row">' + checkButton({
      key: shop.lineCheckKey(line.id),
      name: line.name,
      amounts: line.amounts,
      price: line.price,
      storeName: showStore ? line.storeName : '',
      meals: null,
      addedBy: line.addedBy
    }) + '<button type="button" class="shop-remove" data-remove="' + escapeHtml(line.id) + '">Entfernen</button></li>';
  }

  function shopMessage(result, name) {
    if (!result.ok && result.reason === 'empty') return 'Trag einen Artikelnamen ein.';
    if (!result.ok && result.reason === 'long') return 'Der Name ist zu lang.';
    if (!result.ok && result.reason === 'amount') return 'Die Menge ist zu lang.';
    if (result.removed) return name + ' ist von der Liste.';
    if (result.merged) return 'Menge ergänzt: ' + name + '.';
    if (result.already) return 'Steht schon auf der Liste.';
    return name + ' steht auf der Liste.';
  }

  function commitShop(result) {
    if (!result.ok) return result;
    if (result.created) {
      var draft = result.draft;
      state.lines = state.lines.concat([{
        id: shop.nextLineId(state.lines),
        name: draft.name,
        amounts: draft.amounts.slice(),
        price: draft.price || '',
        storeId: draft.storeId || '',
        storeName: draft.storeName || '',
        addedBy: displayName(),
        rev: Date.now(),
        deleted: false
      }]);
      return result;
    }
    if (result.lines) {
      var now = Date.now();
      state.lines = result.lines.map(function (line) {
        if (result.lineId && line.id === result.lineId) {
          var next = Object.assign({}, line, { rev: now });
          if (!result.removed) next.addedBy = line.addedBy || displayName();
          return next;
        }
        return line;
      });
      if (result.removed && result.lineId) {
        var removeKey = shop.lineCheckKey(result.lineId);
        state.checked = state.checked.filter(function (key) { return key !== removeKey; });
        state.checkMeta[removeKey] = { on: false, by: displayName(), rev: now };
      }
    }
    if (result.extraAmounts) state.extraAmounts = result.extraAmounts;
    return result;
  }

  function noteShop(result, name) {
    var changed = !!(result && result.ok && (result.created || result.merged || result.enriched || result.removed));
    if (changed) remember();
    commitShop(result);
    els.shopNote.textContent = shopMessage(result, name);
    announce(els.shopNote.textContent);
    if (!result.ok) return;
    save();
    render();
  }

  function emptyShopMessage(stores, list) {
    if (!stores.length) return 'Wähl mindestens einen Supermarkt. Eigene Artikel kannst du trotzdem eintragen.';
    if (!list.length) return 'Aus diesen Angeboten lässt sich keins der Gerichte kochen.';
    if (!meals.chosenIds(list, state.picked).length) return 'Kein Gericht auf der Liste.';
    return 'Für die ausgewählten Gerichte ist alles da.';
  }

  function claimSuffix(storeId) {
    if (!storeId || String(storeId).indexOf('+') !== -1) return '';
    var claim = shop.claimFor(state.claims, storeId);
    if (!claim || !claim.by) return '';
    return ' · ' + claim.by;
  }

  function foreignClaim(storeId) {
    var claim = shop.claimFor(state.claims, storeId);
    if (!claim || !claim.by) return null;
    if (claim.by === displayName() && displayName()) return null;
    return claim;
  }

  function renderShop() {
    var stores = selectedStores();
    els.shopHeading.textContent = stores.length ? 'Einkauf bei ' + joinNames(stores.map(function (store) { return store.name; })) : 'Einkaufsliste';
    view.planItems = currentPlanItems();
    var list = suggestions();
    var plan = view.planItems.length ? visiblePlan() : { offers: [], missing: [] };

    var consumed = {};
    var html = '';
    var total = 0;
    var done = 0;
    var cart = [];

    function place(openHtml, cartHtml, checked) {
      total += 1;
      if (checked) {
        done += 1;
        cart.push(cartHtml);
        return '';
      }
      return openHtml;
    }

    plan.offers.forEach(function (group) {
      var chunk = '';
      group.items.forEach(function (item) {
        var row = planRow(item);
        chunk += place(row, row, isChecked(shop.planCheckKey(item.id)));
      });
      shop.aliveLines(state.lines).forEach(function (line) {
        if (consumed[line.id] || line.storeName !== group.label) return;
        consumed[line.id] = true;
        chunk += place(lineRow(line, false), lineRow(line, true), isChecked(shop.lineCheckKey(line.id)));
      });
      if (chunk) html += '<li class="shop-label">' + escapeHtml(group.label + claimSuffix(group.id)) + '</li>' + chunk;
    });

    if (plan.missing.length) {
      var missingChunk = '';
      plan.missing.forEach(function (item) {
        var row = planRow(item);
        missingChunk += place(row, row, isChecked(shop.planCheckKey(item.id)));
      });
      if (missingChunk) html += '<li class="shop-label">Noch kaufen</li>' + missingChunk;
    }

    var customLabels = [];
    var customMap = {};
    shop.aliveLines(state.lines).forEach(function (line) {
      if (consumed[line.id]) return;
      var label = line.storeName || 'Selbst eingetragen';
      if (!customMap[label]) {
        customMap[label] = [];
        customLabels.push(label);
      }
      customMap[label].push(line);
    });
    customLabels.sort(function (a, b) {
      if (a === 'Selbst eingetragen') return 1;
      if (b === 'Selbst eingetragen') return -1;
      return a.localeCompare(b, 'de');
    });
    customLabels.forEach(function (label) {
      var chunk = '';
      customMap[label].forEach(function (line) {
        chunk += place(lineRow(line, false), lineRow(line, true), isChecked(shop.lineCheckKey(line.id)));
      });
      if (chunk) html += '<li class="shop-label">' + escapeHtml(label) + '</li>' + chunk;
    });

    if (cart.length) html += '<li class="shop-label">Im Wagen</li>' + cart.join('');
    var skippedHtml = (state.skipped || []).map(function (id) {
      var item = meals.ingredient(id);
      if (!item) return '';
      return '<li class="shop-row"><span class="shop-name">' + escapeHtml(item.name) + '</span><button type="button" class="shop-skip" data-skip="' + escapeHtml(id) + '">Wieder dazu</button></li>';
    }).join('');
    if (skippedHtml) html += '<li class="shop-label">Weggelassen</li>' + skippedHtml;
    if (els.shopProgress) els.shopProgress.textContent = total ? (done + ' von ' + total + ' im Wagen') : '';
    if (!total && !skippedHtml) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = emptyShopMessage(stores, list);
      return;
    }
    els.shopEmpty.hidden = true;
    els.shop.innerHTML = html;
  }

  function render() {
    readEditorFields();
    renderTicker();
    renderStores();
    renderStoreDetail();
    renderChoice();
    renderInventory();
    renderIdeas();
    renderEvenings();
    renderStaples();
    renderClaims();
    renderShop();
  }

  function renderClaims() {
    if (!els.claims) return;
    var mine = displayName();
    els.claims.innerHTML = selectedStores().map(function (store) {
      var claim = shop.claimFor(state.claims, store.id);
      var owned = claim && mine && claim.by === mine;
      var label = !claim ? store.name + ' übernehmen' : (owned ? store.name + ' ist deins' : store.name + ' · ' + (claim.by || 'belegt'));
      return '<button type="button" class="claim-btn" data-claim="' + escapeHtml(store.id) + '" aria-pressed="' + (claim ? 'true' : 'false') + '">' + escapeHtml(label) + '</button>';
    }).join('');
  }

  function eveningRow(day) {
    var row = null;
    (state.evenings || []).forEach(function (item) {
      if (item.day === day) row = item;
    });
    return row;
  }

  function renderEvenings() {
    if (!els.evenings) return;
    var list = suggestions();
    var chosen = meals.chosenIds(list, state.picked);
    var options = list.filter(function (recipe) { return chosen.indexOf(recipe.id) !== -1; });
    els.evenings.innerHTML = meals.DAYS.map(function (day) {
      var row = eveningRow(day.id);
      var recipeId = row ? row.recipeId : '';
      var cook = row ? row.cook : '';
      var opts = '<option value="">Kein Gericht</option>' + options.map(function (recipe) {
        return '<option value="' + escapeHtml(recipe.id) + '"' + (recipe.id === recipeId ? ' selected' : '') + '>' + escapeHtml(recipe.title) + '</option>';
      }).join('');
      return '<div class="evening">' +
        '<span class="evening-day">' + escapeHtml(day.label) + '</span>' +
        '<select data-evening="' + day.id + '" aria-label="' + escapeHtml(day.label) + '">' + opts + '</select>' +
        '<input data-cook="' + day.id + '" value="' + escapeHtml(cook) + '" placeholder="Wer kocht" maxlength="24" aria-label="Wer kocht am ' + escapeHtml(day.label) + '">' +
        '</div>';
    }).join('');
  }

  function renderRecipeDraft() {
    if (!els.recipeIngredients) return;
    els.recipeIngredients.innerHTML = recipeDraft.map(function (item, index) {
      var info = meals.ingredient(item.id);
      return '<li><span>' + escapeHtml((info ? info.name : item.id) + ' ' + item.amount) + '</span>' +
        '<button type="button" class="shop-skip" data-draft="' + index + '">Weg</button></li>';
    }).join('');
  }

  function renderStaples() {
    if (!els.staples) return;
    var rows = (state.staples || []).filter(function (item) { return !item.deleted; });
    els.staples.innerHTML = rows.map(function (item) {
      return '<li class="shop-row"><span class="shop-copy"><span class="shop-name">' + escapeHtml(item.name) + '</span>' +
        (item.amount ? '<span class="shop-amount">' + escapeHtml(item.amount) + '</span>' : '') +
        '</span><button type="button" class="shop-skip" data-staple-add="' + escapeHtml(item.id) + '">Auf die Liste</button>' +
        '<button type="button" class="shop-remove" data-staple-remove="' + escapeHtml(item.id) + '">Entfernen</button></li>';
    }).join('');
  }

  function toggleStore(id) {
    var store = storeById(id);
    if (!store) return;
    var next = state.storeIds.slice();
    var at = next.indexOf(id);
    if (at === -1) next.push(id);
    else next.splice(at, 1);
    state.storeIds = orderedIds(next);
    state.storeRev = Date.now();
    state.picked = null;
    state.pickedRev = Date.now();
    if (els.note) els.note.textContent = '';
    if (els.shopNote) els.shopNote.textContent = '';
    save();
    render();
    if (els.offerScroll) els.offerScroll.scrollTop = 0;
    announce(at === -1 ? store.name + ' dazugenommen' : store.name + ' abgewählt');
  }

  function isLocalFile() {
    return window.location.protocol === 'file:';
  }

  function updateConnectivity() {
    var node = els.connectivity;
    node.classList.remove('is-ready', 'is-offline');
    if (isLocalFile()) {
      node.classList.add('is-ready');
      node.textContent = 'Auf diesem Gerät';
      return;
    }
    if (!navigator.onLine) {
      node.classList.add('is-offline');
      node.textContent = 'Offline';
      return;
    }
    if (!('serviceWorker' in navigator) || navigator.serviceWorker.controller) {
      node.classList.add('is-ready');
      node.textContent = 'Offline-bereit';
      return;
    }
    node.textContent = 'Speichert…';
  }

  function registerServiceWorker() {
    if (isLocalFile() || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js', {
      scope: './',
      updateViaCache: 'none'
    }).catch(function (error) {
      console.error('Service Worker konnte nicht registriert werden.', error);
    });
    var ownUrl = new URL('./service-worker.js', window.location.href).href;
    var current = navigator.serviceWorker.controller;
    var hadOwnController = !!(current && current.scriptURL === ownUrl);
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      updateConnectivity();
      var next = navigator.serviceWorker.controller;
      if (!next || next.scriptURL !== ownUrl) return;
      if (!hadOwnController) {
        hadOwnController = true;
        return;
      }
      window.location.reload();
    });
    navigator.serviceWorker.ready.then(updateConnectivity).catch(function () {});
  }

  function readStored(key) {
    try { return localStorage.getItem(key) || ''; } catch (error) { return ''; }
  }

  function writeStored(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (error) { /* Speicher voll oder gesperrt */ }
  }

  function fallbackCopy(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (error) { /* Clipboard bleibt leer */ }
    document.body.removeChild(area);
    done();
  }

  function shoppingGroups() {
    var plan = visiblePlan();
    var groups = [];
    var consumed = {};
    function detail(amounts, price) {
      var parts = [];
      if (amounts && amounts.length) parts.push(amounts.join(' · '));
      if (price) parts.push(formatPrice(price));
      return parts.join(' · ');
    }
    plan.offers.forEach(function (group) {
      var items = group.items.map(function (item) {
        return { name: item.name, detail: detail(planAmounts(item)), checked: isChecked(shop.planCheckKey(item.id)) };
      });
      shop.aliveLines(state.lines).forEach(function (line) {
        if (consumed[line.id] || line.storeName !== group.label) return;
        consumed[line.id] = true;
        items.push({ name: line.name, detail: detail(line.amounts, line.price), checked: isChecked(shop.lineCheckKey(line.id)) });
      });
      if (items.length) groups.push({ label: group.label, items: items });
    });
    if (plan.missing.length) {
      groups.push({
        label: 'Noch kaufen',
        items: plan.missing.map(function (item) {
          return { name: item.name, detail: detail(planAmounts(item)), checked: isChecked(shop.planCheckKey(item.id)) };
        })
      });
    }
    var loose = [];
    shop.aliveLines(state.lines).forEach(function (line) {
      if (consumed[line.id]) return;
      loose.push({ name: line.name, detail: detail(line.amounts, line.price), checked: isChecked(shop.lineCheckKey(line.id)) });
    });
    if (loose.length) groups.push({ label: 'Selbst eingetragen', items: loose });
    return groups;
  }

  function setEvening(day, patch) {
    var current = eveningRow(day) || { day: day, recipeId: '', cook: '', rev: 0 };
    var next = {
      day: day,
      recipeId: patch.recipeId != null ? patch.recipeId : current.recipeId,
      cook: patch.cook != null ? shop.clipPerson(patch.cook) : current.cook,
      rev: Date.now()
    };
    var list = (state.evenings || []).filter(function (item) { return item.day !== day; });
    list.push(next);
    state.evenings = meals.cleanEvenings(list);
    save();
  }

  function exportStand() {
    return {
      weekKey: state.weekKey,
      weekRev: state.weekRev || 0,
      marketId: state.marketId,
      storeIds: (state.storeIds || []).slice(),
      storeRev: state.storeRev || 0,
      pantry: (state.pantry || []).slice(),
      pantryLog: state.pantryLog || {},
      picked: state.picked,
      pickedRev: state.pickedRev || 0,
      skipped: state.skipped || [],
      skippedLog: state.skippedLog || {},
      extras: state.extras || {},
      lines: state.lines || [],
      checkMeta: state.checkMeta || {},
      checked: state.checked || [],
      extraAmounts: state.extraAmounts || {},
      claims: state.claims || [],
      evenings: state.evenings || [],
      recipes: state.recipes || [],
      overrides: state.overrides || [],
      inventory: state.inventory || [],
      inventorySet: !!state.inventorySet,
      staples: state.staples || []
    };
  }

  function applyStand(stand) {
    if (!stand || typeof stand !== 'object') return false;
    state.weekKey = stand.weekKey || state.weekKey;
    state.weekRev = revOf(stand.weekRev);
    if (stand.marketId) state.marketId = meals.marketById(stand.marketId).id;
    if (Array.isArray(stand.storeIds)) {
      state.storeIds = orderedIds(stand.storeIds.filter(function (id) { return storeById(id); }));
    }
    state.storeRev = revOf(stand.storeRev);
    var pantryIds = meals.pantryIngredients().map(function (item) { return item.id; });
    state.pantry = Array.isArray(stand.pantry) ? stand.pantry.filter(function (id) { return pantryIds.indexOf(id) !== -1; }) : state.pantry;
    state.pantryLog = shop.cleanFlagLog(stand.pantryLog);
    state.picked = stand.picked == null ? null : stand.picked.slice();
    state.pickedRev = revOf(stand.pickedRev);
    state.skipped = shop.cleanSkipped(stand.skipped);
    state.skippedLog = shop.cleanFlagLog(stand.skippedLog);
    state.extras = cleanExtras(stand.extras);
    state.lines = shop.cleanLines(stand.lines);
    state.checkMeta = shop.cleanCheckMeta(stand.checkMeta);
    state.checked = shop.cleanChecked(stand.checked);
    state.extraAmounts = shop.cleanExtraAmounts(stand.extraAmounts);
    state.claims = shop.cleanClaims(stand.claims);
    state.evenings = meals.cleanEvenings(stand.evenings);
    state.recipes = meals.cleanCustomRecipes(stand.recipes);
    state.overrides = meals.cleanOverrides(stand.overrides);
    if (stand.inventorySet === true || (Array.isArray(stand.inventory) && stand.inventory.length)) {
      state.inventory = meals.cleanInventory(stand.inventory);
      state.inventorySet = true;
    }
    if (state.inventorySet) {
      state.inventory = meals.absorbIds(state.inventory, state.pantry, Date.now());
      state.pantry = meals.coveredIds(state.inventory);
    }
    state.staples = shop.cleanStaples(stand.staples);
    return true;
  }

  var sheetState = { onSubmit: null };

  function showSheetError(message) {
    if (!els.sheetError) return;
    els.sheetError.hidden = false;
    els.sheetError.textContent = message;
  }

  function closeSheet() {
    if (!els.sheet) return;
    els.sheet.hidden = true;
    sheetState.onSubmit = null;
  }

  function renderSyncStatus() {
    if (!els.sync) return;
    var labels = {
      local: 'Nur dieses Gerät',
      connecting: 'Verbinden…',
      live: 'Gemeinsam verbunden',
      saving: 'Wird übertragen…',
      offline: 'Gemeinsam, gerade offline',
      reconnecting: 'Erneut verbinden…',
      error: 'Verbindung fehlgeschlagen',
      denied: 'Firebase verweigert den Zugriff',
      invalid: 'Gemeinsamer Stand unlesbar',
      rejected: 'Firebase hat den Stand abgelehnt'
    };
    els.sync.textContent = labels[syncStatus] || labels.local;
    els.sync.classList.toggle('is-live', syncStatus === 'live' || syncStatus === 'saving');
    els.sync.classList.toggle('is-bad', syncStatus === 'error' || syncStatus === 'denied' || syncStatus === 'invalid' || syncStatus === 'rejected');
  }

  function setSyncStatus(name) {
    syncStatus = name;
    renderSyncStatus();
  }

  function stopSession() {
    if (session) session.close();
    session = null;
  }

  function adoptRemote(remote) {
    if (!remote) return false;
    var before = JSON.stringify(exportStand());
    if (applyStand(remote.state) === false) return false;
    if (JSON.stringify(exportStand()) !== before) {
      editHistory = shop.emptyHistory();
      syncHistoryButtons();
    }
    suppressPush = true;
    persist();
    suppressPush = false;
    localUpdatedAt = remote.updatedAt || 0;
    if (syncApi) writeStored(syncApi.UPDATED_KEY, String(localUpdatedAt));
    render();
    return true;
  }

  function startSession() {
    stopSession();
    if (!syncApi) {
      setSyncStatus('local');
      return;
    }
    var url = readStored(syncApi.URL_KEY);
    var id = readStored(syncApi.HOUSEHOLD_KEY);
    if (!url || !id) {
      setSyncStatus('local');
      return;
    }
    var storedUpdatedAt = Number(readStored(syncApi.UPDATED_KEY));
    if (isFinite(storedUpdatedAt)) localUpdatedAt = storedUpdatedAt;
    session = syncApi.createSession({
      databaseURL: url,
      householdId: id,
      getSnapshot: function () {
        return {
          state: exportStand(),
          updatedAt: localUpdatedAt,
          untouched: !hadSaved && !userEdited
        };
      },
      setUpdatedAt: function (value) {
        localUpdatedAt = value;
        writeStored(syncApi.UPDATED_KEY, String(value));
      },
      adopt: adoptRemote,
      merge: function (local, remote) { return syncApi.mergeStands(local, remote); },
      onStatus: setSyncStatus,
      fetch: window.fetch.bind(window),
      EventSource: window.EventSource,
      now: function () { return Date.now(); }
    });
  }

  function openSyncSheet() {
    if (!syncApi || !els.sheet) return;
    var connected = !!(readStored(syncApi.URL_KEY) && readStored(syncApi.HOUSEHOLD_KEY));
    els.sheetBody.textContent = '';
    var intro = document.createElement('p');
    intro.className = 'sheet-copy';
    intro.textContent = 'Beide Handys tragen dieselbe Datenbank-Adresse und dasselbe Kennwort ein. Zeilen, Mengen und Haken werden zusammengeführt, nicht überschrieben.';
    var rulesHint = document.createElement('p');
    rulesHint.className = 'sheet-copy';
    rulesHint.textContent = 'In Firebase unter Rules den Text unten veröffentlichen. Chore Wars und der Wochenzettel teilen sich die Adresse, liegen aber in getrennten Pfaden.';
    var rules = document.createElement('textarea');
    rules.className = 'rules-box';
    rules.readOnly = true;
    rules.value = syncApi.RULES_TEXT;
    rules.setAttribute('aria-label', 'Firebase-Regeln');
    var url = document.createElement('input');
    url.name = 'databaseUrl';
    url.type = 'url';
    url.value = readStored(syncApi.URL_KEY);
    url.placeholder = 'https://name.firebaseio.com';
    url.autocomplete = 'off';
    var secret = document.createElement('input');
    secret.name = 'secret';
    secret.type = 'text';
    secret.maxLength = syncApi.SECRET_MAX;
    secret.placeholder = 'Mindestens 8 Zeichen, auf beiden Geräten gleich';
    secret.autocomplete = 'off';
    secret.value = readStored(syncApi.SECRET_KEY);
    secret.addEventListener('input', function () {
      writeStored(syncApi.SECRET_KEY, secret.value);
    });
    els.sheetBody.append(intro, rulesHint, rules, url, secret);
    if (connected) {
      var disconnect = document.createElement('button');
      disconnect.type = 'button';
      disconnect.className = 'sheet-choice';
      disconnect.textContent = 'Verbindung trennen';
      disconnect.addEventListener('click', function () {
        stopSession();
        writeStored(syncApi.HOUSEHOLD_KEY, '');
        setSyncStatus('local');
        closeSheet();
        announce('Nur noch dieses Gerät.');
      });
      els.sheetBody.append(disconnect);
    }
    els.sheetError.hidden = true;
    els.sheet.hidden = false;
    url.focus();
    sheetState.onSubmit = function () {
      var urlResult = syncApi.normalizeDatabaseUrl(url.value);
      if (!urlResult.ok) return urlResult.error;
      var secretResult = syncApi.readSecret(secret.value);
      if (!secretResult.ok) return secretResult.error;
      writeStored(syncApi.SECRET_KEY, secretResult.value);
      els.sheetSubmit.disabled = true;
      syncApi.householdId(secretResult.value).then(function (household) {
        writeStored(syncApi.URL_KEY, urlResult.value);
        writeStored(syncApi.HOUSEHOLD_KEY, household);
        els.sheetSubmit.disabled = false;
        closeSheet();
        announce('Verbinden…');
        startSession();
      }).catch(function () {
        els.sheetSubmit.disabled = false;
        showSheetError('Das Kennwort konnte nicht verarbeitet werden.');
      });
      return 'stay';
    };
  }

  function cameraMessage(error) {
    if (!window.isSecureContext) return 'Scannen braucht eine sichere Verbindung.';
    var name = error && error.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'Die Kamera ist blockiert. Erlaube den Zugriff, dann geht das Scannen.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Keine Kamera gefunden.';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
      return 'Die Kamera ist gerade belegt.';
    }
    return 'Die Kamera lässt sich nicht öffnen.';
  }

  function setScanStatus(message) {
    if (els.scannerStatus) els.scannerStatus.textContent = message;
  }

  function hideNamePrompt() {
    pendingCode = '';
    scanPaused = false;
    if (els.scannerNameForm) els.scannerNameForm.hidden = true;
    if (els.scannerName) els.scannerName.value = '';
  }

  function stopScanner() {
    scanGen += 1;
    scanning = false;
    scanPaused = false;
    scanBusy = false;
    heldCode = '';
    heldClearAt = 0;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = 0;
    }
    if (scanAbort) {
      scanAbort.abort();
      scanAbort = null;
    }
    if (scanStream) {
      scanStream.getTracks().forEach(function (track) { track.stop(); });
      scanStream = null;
    }
    if (els.scannerVideo) {
      els.scannerVideo.pause();
      els.scannerVideo.srcObject = null;
    }
  }

  function closeScanner() {
    stopScanner();
    hideNamePrompt();
    if (els.scanner) els.scanner.hidden = true;
  }

  function scanNote(result) {
    if (result.units > 1) return result.name + ', jetzt ' + result.units + '.';
    return result.name + ' ist im Vorrat.';
  }

  function commitScan(code, name) {
    var result = barcodeApi.addScanned(state.inventory, code, name, Date.now());
    if (!result.ok) {
      var problem = result.reason === 'long' ? 'Das ist zu lang.' : 'Trag einen Namen ein.';
      setScanStatus(problem);
      if (els.inventoryNote) els.inventoryNote.textContent = problem;
      return false;
    }
    remember();
    state.inventory = meals.cleanInventory(result.inventory);
    state.inventorySet = true;
    publishPantry();
    save();
    render();
    var note = scanNote(result);
    if (els.inventoryNote) els.inventoryNote.textContent = note;
    setScanStatus(note);
    announce(note);
    return true;
  }

  function askScanName(code, offline) {
    pendingCode = code;
    scanPaused = true;
    if (!els.scannerNameForm) return;
    els.scannerNameForm.hidden = false;
    if (els.scannerNameHint) {
      els.scannerNameHint.textContent = offline
        ? 'Gerade kein Netz. Wie heißt der Artikel?'
        : 'Diesen Strichcode kenne ich nicht. Wie heißt der Artikel?';
    }
    if (els.scannerName) {
      els.scannerName.value = '';
      els.scannerName.focus();
    }
    announce(els.scannerNameHint ? els.scannerNameHint.textContent : '');
    setScanStatus('');
  }

  function lookupOff(code) {
    var url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json';
    if (scanAbort) scanAbort.abort();
    scanAbort = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (scanAbort) scanAbort.abort();
    }, 8000);
    var options = scanAbort ? { signal: scanAbort.signal } : {};
    return fetch(url, options).then(function (response) {
      clearTimeout(timer);
      if (response.status === 404) return { name: '', offline: false };
      if (!response.ok) return { name: '', offline: true };
      return response.json().then(function (payload) {
        return { name: barcodeApi.productName(payload), offline: false };
      });
    }).catch(function () {
      clearTimeout(timer);
      return { name: '', offline: true };
    });
  }

  function acceptScan(code) {
    var known = barcodeApi.savedName(state.inventory, code);
    if (known) {
      commitScan(code, known);
      return;
    }
    var gen = scanGen;
    scanBusy = true;
    setScanStatus('Wird nachgesehen…');
    lookupOff(code).then(function (result) {
      scanBusy = false;
      if (gen !== scanGen || !scanning) return;
      if (result.name) {
        commitScan(code, result.name);
        return;
      }
      askScanName(code, result.offline);
    });
  }

  function considerScan(raw) {
    if (!scanning || scanPaused || scanBusy) return;
    var code = barcodeApi.canonical(raw);
    var now = Date.now();
    if (!code) {
      if (heldCode && !heldClearAt) heldClearAt = now;
      if (heldCode && heldClearAt && now - heldClearAt > 700) {
        heldCode = '';
        heldClearAt = 0;
      }
      return;
    }
    heldClearAt = 0;
    if (code === heldCode) return;
    heldCode = code;
    acceptScan(code);
  }

  function detectorFormats(found) {
    if (!found || !found.length) return '';
    var format = found[0].format || '';
    if (format && format !== 'ean_13' && format !== 'ean_8' && format !== 'upc_a') return '';
    return found[0].rawValue || '';
  }

  function decodeFrame() {
    var video = els.scannerVideo;
    var canvas = els.scannerCanvas;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return '';
    var width = 360;
    var height = Math.max(1, Math.round(video.videoHeight * (width / video.videoWidth)));
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext('2d');
    if (!context) return '';
    context.drawImage(video, 0, 0, width, height);
    try {
      return eanScan.decode(context.getImageData(0, 0, width, height)) || '';
    } catch (error) {
      return '';
    }
  }

  function readFrame() {
    var video = els.scannerVideo;
    var ready = !!(video && video.readyState >= 2 && video.videoWidth);
    if (scanDetector && ready) {
      return scanDetector.detect(video).then(function (found) {
        var native = detectorFormats(found);
        return native || decodeFrame();
      }).catch(function () {
        return decodeFrame();
      });
    }
    if (ready) return Promise.resolve(decodeFrame());
    try {
      return Promise.resolve(eanScan.decode(null) || '');
    } catch (error) {
      return Promise.resolve('');
    }
  }

  function scanTick() {
    if (!scanning) return;
    readFrame().then(function (raw) {
      if (!scanning) return;
      considerScan(raw);
      scanTimer = setTimeout(scanTick, 180);
    }).catch(function () {
      if (!scanning) return;
      scanTimer = setTimeout(scanTick, 180);
    });
  }

  function beginScanLoop() {
    if (!scanning) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTick();
  }

  function openCamera(constraints) {
    return navigator.mediaDevices.getUserMedia(constraints).catch(function (error) {
      if (!constraints || !constraints.video || constraints.video === true) throw error;
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    });
  }

  function openScanner() {
    if (!els.scanner) return;
    stopScanner();
    hideNamePrompt();
    scanning = true;
    els.scanner.hidden = false;
    setScanStatus('Halte den Strichcode in die Kamera.');
    scanDetector = null;
    if (window.BarcodeDetector) {
      try {
        scanDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
      } catch (error) {
        try { scanDetector = new BarcodeDetector(); } catch (again) { scanDetector = null; }
      }
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      scanning = false;
      setScanStatus(cameraMessage({ name: 'NotFoundError' }));
      return;
    }
    openCamera({
      audio: false,
      video: { facingMode: { ideal: 'environment' } }
    }).then(function (stream) {
      if (!scanning) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      scanStream = stream;
      var video = els.scannerVideo;
      try {
        video.srcObject = stream;
      } catch (error) {
        beginScanLoop();
        return;
      }
      video.muted = true;
      video.setAttribute('playsinline', '');
      video.playsInline = true;
      var played = video.play();
      if (played && played.catch) played.catch(function () {});
      beginScanLoop();
    }).catch(function (error) {
      scanning = false;
      setScanStatus(cameraMessage(error));
      announce(els.scannerStatus ? els.scannerStatus.textContent : '');
    });
  }

  function init() {
    var loaded = load();
    state = loaded.state;
    renderWeek();
    renderUnavailable();
    var until = endOfDay(catalog.validUntil);
    if (until && new Date() > until) {
      els.week.hidden = false;
      els.week.textContent = 'Diese Woche ist vorbei. Angezeigt wird der letzte gelesene Stand vom ' + deDate(catalog.extractedAt) + '.';
    } else if (loaded.weekChanged) {
      els.week.hidden = false;
      els.week.textContent = 'Neue Woche. Ergänzungen und die Einkaufsliste der letzten Woche sind geleert.';
    }
    hadSaved = !!readStorage();
    tickerState = loadTicker();
    persist();
    selectTab('einkauf');

    function onStoreClick(event) {
      var button = event.target.closest('[data-store]');
      if (!button) return;
      toggleStore(button.getAttribute('data-store'));
    }
    els.stores.addEventListener('click', onStoreClick);
    els.storePicks.addEventListener('click', onStoreClick);

    if (els.tabs) {
      els.tabs.addEventListener('click', function (event) {
        var button = event.target.closest('[role="tab"]');
        if (!button || !els.tabs.contains(button)) return;
        selectTab(button.id.replace(/^tab-/, ''));
      });
      els.tabs.addEventListener('keydown', function (event) {
        var button = event.target.closest('[role="tab"]');
        if (!button || !els.tabs.contains(button)) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          moveTab(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveTab(-1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          selectTab(TAB_IDS[0]);
          focusTab(TAB_IDS[0]);
        } else if (event.key === 'End') {
          event.preventDefault();
          selectTab(TAB_IDS[TAB_IDS.length - 1]);
          focusTab(TAB_IDS[TAB_IDS.length - 1]);
        }
      });
    }

    els.categories.addEventListener('click', function (event) {
      var button = event.target.closest('[data-category]');
      if (!button) return;
      var id = meals.offerCategoryById(button.getAttribute('data-category')).id;
      if (state.categoryId === id) return;
      state.categoryId = id;
      save();
      renderStoreDetail();
      if (els.offerScroll) els.offerScroll.scrollTop = 0;
      announce(meals.offerCategoryById(id).label);
    });

    if (els.inventoryForm) {
      els.inventoryForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var typed = shop.fold(els.inventoryText.value);
        var result = meals.addInventory(state.inventory, typed, els.inventoryAmount.value, Date.now());
        if (!result.ok) {
          els.inventoryNote.textContent = result.reason === 'empty' ? 'Trag einen Namen ein.' : 'Das ist zu lang.';
          announce(els.inventoryNote.textContent);
          return;
        }
        if (result.created || result.merged) remember();
        if (result.created) {
          state.inventory = result.inventory.concat([Object.assign({ id: meals.nextInventoryId(result.inventory) }, result.draft)]);
          els.inventoryText.value = '';
          els.inventoryAmount.value = '';
        } else {
          state.inventory = result.inventory;
          if (result.merged) {
            els.inventoryText.value = '';
            els.inventoryAmount.value = '';
          }
        }
        state.inventorySet = true;
        publishPantry();
        var known = meals.matchStockText(typed);
        if (result.already) els.inventoryNote.textContent = 'Steht schon im Vorrat.';
        else if (result.merged) els.inventoryNote.textContent = 'Menge aktualisiert.';
        else if (known.length) els.inventoryNote.textContent = 'Eingetragen. Kommt nicht auf den Zettel.';
        else els.inventoryNote.textContent = 'Eingetragen.';
        announce(els.inventoryNote.textContent);
        save();
        render();
      });
    }

    if (els.inventory) {
      els.inventory.addEventListener('click', function (event) {
        if (event.target.closest('[data-rename-cancel]')) {
          renameId = null;
          renderInventory();
          return;
        }
        var renameButton = event.target.closest('[data-inventory-rename]');
        if (renameButton) {
          renameId = renameButton.getAttribute('data-inventory-rename');
          focusRename = true;
          renderInventory();
          return;
        }
        var step = event.target.closest('[data-inventory-step]');
        if (step) {
          var stepId = step.getAttribute('data-inventory-id');
          var stepped = meals.stepInventory(state.inventory, stepId, Number(step.getAttribute('data-inventory-step')), Date.now());
          if (!stepped.ok) {
            announce('Diese Zeile fehlt.');
            return;
          }
          state.inventory = stepped.inventory;
          state.inventorySet = true;
          publishPantry();
          save();
          renderInventory();
          var steppedRow = null;
          stepped.inventory.forEach(function (item) {
            if (item.id === stepId) steppedRow = item;
          });
          var steppedDetail = steppedRow ? inventoryDetail(steppedRow) : '';
          announce((steppedRow ? steppedRow.name : 'Vorrat') + ': ' + (steppedDetail || 'ohne Menge'));
          return;
        }
        var button = event.target.closest('[data-inventory-remove]');
        if (!button) return;
        var id = button.getAttribute('data-inventory-remove');
        var removed = null;
        state.inventory.forEach(function (item) {
          if (item.id === id) removed = item;
        });
        remember();
        state.inventory = state.inventory.map(function (item) {
          if (item.id !== id) return item;
          return Object.assign({}, item, { deleted: true, rev: Date.now() });
        });
        state.inventorySet = true;
        publishPantry();
        save();
        render();
        if (removed) {
          els.inventoryNote.textContent = removed.name + ' entfernt.';
          announce(els.inventoryNote.textContent);
        }
      });
      els.inventory.addEventListener('submit', function (event) {
        var form = event.target.closest('[data-rename-form]');
        if (!form) return;
        event.preventDefault();
        var id = form.getAttribute('data-rename-form');
        var input = form.querySelector('input');
        var result = barcodeApi.renameItem(state.inventory, id, input ? input.value : '', Date.now());
        if (!result.ok) {
          els.inventoryNote.textContent = result.reason === 'exists'
            ? 'Den Namen gibt es schon.'
            : (result.reason === 'long' ? 'Das ist zu lang.' : 'Trag einen Namen ein.');
          announce(els.inventoryNote.textContent);
          return;
        }
        if (result.renamed) remember();
        state.inventory = result.inventory;
        state.inventorySet = true;
        renameId = null;
        publishPantry();
        save();
        render();
        els.inventoryNote.textContent = result.same ? '' : 'Name geändert.';
        if (!result.same) announce(els.inventoryNote.textContent);
      });
    }

    els.form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = els.text.value.trim();
      if (!text) {
        els.note.textContent = 'Trag einen Artikelnamen ein.';
        return;
      }
      if (text.length > 80) {
        els.note.textContent = 'Der Name ist zu lang.';
        return;
      }
      var stores = selectedStores();
      if (!stores.length) {
        els.note.textContent = 'Wähl zuerst einen Supermarkt.';
        return;
      }
      var store = stores.length === 1 ? stores[0] : storeById(els.extraStore.value);
      if (!store) store = stores[0];
      var names = extrasFor(store.id).slice();
      var known = false;
      offersFor(store).forEach(function (offer) {
        if (String(offer.name).toLowerCase() === text.toLowerCase()) known = true;
      });
      if (known) {
        els.note.textContent = 'Steht schon in der Liste.';
        announce(els.note.textContent);
        return;
      }
      names.push(text);
      state.extras[store.id] = names;
      save();
      els.text.value = '';
      var ids = meals.matchOfferText(text);
      var added = ids.map(function (id) { return meals.ingredient(id).name; });
      els.note.textContent = added.length
        ? 'Übernommen: ' + added.join(', ') + '.'
        : 'Eingetragen. Keine bekannte Zutat, die Vorschläge ändern sich nicht.';
      announce(els.note.textContent);
      render();
    });

    els.offerScroll.addEventListener('click', function (event) {
      var button = event.target.closest('[data-offer-add]');
      if (!button) return;
      var store = storeById(button.getAttribute('data-store'));
      var name = button.getAttribute('data-name') || '';
      var taken = foreignClaim(store ? store.id : button.getAttribute('data-store'));
      if (taken) {
        els.note.textContent = (store ? store.name : 'Dieser Markt') + ' hat ' + taken.by + '.';
        announce(els.note.textContent);
        return;
      }
      var label = shop.clipName(name);
      var result = shop.addOffer(state.lines, view.planItems, {
        name: name,
        price: button.getAttribute('data-price') || '',
        amount: button.getAttribute('data-amount') || '',
        storeId: store ? store.id : (button.getAttribute('data-store') || ''),
        storeName: store ? store.name : '',
        now: Date.now()
      });
      noteShop(result, label);
      if (els.note && result && result.ok) els.note.textContent = shopMessage(result, label);
    });

    els.shopForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = els.shopText.value;
      var result = shop.addManual(state.lines, view.planItems, state.extraAmounts, name, els.shopAmount.value);
      if (!result.ok) {
        els.shopNote.textContent = shopMessage(result, '');
        announce(els.shopNote.textContent);
        return;
      }
      noteShop(result, shop.clipName(name));
      if (result.created || result.merged) {
        els.shopText.value = '';
        els.shopAmount.value = '';
      }
    });

    els.shop.addEventListener('click', function (event) {
      var skip = event.target.closest('[data-skip]');
      if (skip) {
        var skipId = skip.getAttribute('data-skip');
        remember();
        state.skipped = shop.toggleSkip(state.skipped, skipId);
        var omitted = state.skipped.indexOf(skipId) !== -1;
        state.skippedLog[skipId] = { on: omitted, rev: Date.now() };
        if (omitted) {
          var skipKey = shop.planCheckKey(skipId);
          state.checked = state.checked.filter(function (key) { return key !== skipKey; });
          state.checkMeta[skipKey] = { on: false, by: displayName(), rev: Date.now() };
        }
        save();
        renderShop();
        var skippedItem = meals.ingredient(skipId);
        els.shopNote.textContent = (skippedItem ? skippedItem.name : 'Die Zutat') + (omitted ? ' ist weggelassen.' : ' ist wieder auf der Liste.');
        announce(els.shopNote.textContent);
        return;
      }
      var remove = event.target.closest('[data-remove]');
      if (remove) {
        var id = remove.getAttribute('data-remove');
        var removed = null;
        var now = Date.now();
        remember();
        state.lines = state.lines.map(function (line) {
          if (line.id !== id) return line;
          removed = line;
          return Object.assign({}, line, { deleted: true, rev: now });
        });
        var removeKey = shop.lineCheckKey(id);
        state.checked = state.checked.filter(function (key) { return key !== removeKey; });
        state.checkMeta[removeKey] = { on: false, by: displayName(), rev: now };
        save();
        renderShop();
        renderStoreDetail();
        if (removed) {
          els.shopNote.textContent = removed.name + ' ist von der Liste.';
          announce(els.shopNote.textContent);
        }
        return;
      }
      var button = event.target.closest('[data-check]');
      if (!button) return;
      var checkKey = button.getAttribute('data-check');
      var was = state.checked.indexOf(checkKey) !== -1;
      remember();
      var marked = shop.applyCheck(state.checked, state.checkMeta, checkKey, displayName(), Date.now());
      state.checked = marked.checked;
      state.checkMeta = marked.checkMeta;
      save();
      var labelNode = button.querySelector('.shop-name');
      var label = labelNode ? labelNode.textContent : 'Artikel';
      renderShop();
      els.shopNote.textContent = was ? label + ' ist wieder offen.' : label + ' liegt im Wagen.';
      announce(els.shopNote.textContent);
    });

    els.ideas.addEventListener('click', function (event) {
      var editBtn = event.target.closest('[data-edit-recipe]');
      if (editBtn) {
        openEditor(editBtn.getAttribute('data-edit-recipe'));
        return;
      }
      var resetBtn = event.target.closest('[data-reset-recipe]');
      if (resetBtn) {
        resetGenerated(resetBtn.getAttribute('data-reset-recipe'));
        return;
      }
      if (editSession && event.target.closest('[data-edit-form]')) {
        if (event.target.closest('[data-edit-add]')) {
          addEditIngredient();
          return;
        }
        if (event.target.closest('[data-edit-drop]')) {
          readEditorFields();
          editSession.ingredients.splice(Number(event.target.closest('[data-edit-drop]').getAttribute('data-edit-drop')), 1);
          editSession.note = '';
          renderIdeas();
          return;
        }
        if (event.target.closest('[data-edit-cancel]')) {
          closeEditor();
          return;
        }
        return;
      }
      var drop = event.target.closest('[data-drop-recipe]');
        if (drop) {
        var dropId = drop.getAttribute('data-drop-recipe');
        if (editSession && editSession.id === dropId) editSession = null;
        state.recipes = state.recipes.map(function (recipe) {
          if (recipe.id !== dropId) return recipe;
          return Object.assign({}, recipe, { deleted: true, rev: Date.now() });
        });
        save();
        render();
        announce('Gericht gelöscht.');
        return;
      }
      var button = event.target.closest('[data-pick]');
      if (!button) return;
      var id = button.getAttribute('data-pick');
      var list = suggestions();
      var chosen = meals.chosenIds(list, state.picked);
      var at = chosen.indexOf(id);
      remember();
      if (at === -1) chosen.push(id);
      else chosen.splice(at, 1);
      state.picked = chosen;
      state.pickedRev = Date.now();
      save();
      renderIdeas();
      renderEvenings();
      renderShop();
      renderStoreDetail();
      var recipe = null;
      list.forEach(function (item) { if (item.id === id) recipe = item; });
      if (recipe) {
        announce(at === -1 ? recipe.title + ' ist auf der Einkaufsliste' : recipe.title + ' ist von der Liste');
      }
    });

    els.ideas.addEventListener('submit', function (event) {
      if (!event.target.closest('[data-edit-form]')) return;
      saveEditor(event);
    });

    if (els.displayName && syncApi) {
      els.displayName.value = readStored(syncApi.NAME_KEY);
      els.displayName.addEventListener('change', function () {
        writeStored(syncApi.NAME_KEY, displayName());
        els.displayName.value = displayName();
        renderClaims();
        renderShop();
      });
    }

    if (els.recipeIngredient) {
      els.recipeIngredient.innerHTML = meals.INGREDIENTS.map(function (item) {
        return '<option value="' + item.id + '">' + escapeHtml(item.name) + '</option>';
      }).join('');
    }

    if (els.copyList) {
      els.copyList.addEventListener('click', function () {
        var text = shop.listText(shoppingGroups());
        if (!text) {
          els.shopNote.textContent = 'Die Liste ist leer.';
          announce(els.shopNote.textContent);
          return;
        }
        var done = function () {
          els.shopNote.textContent = 'Liste kopiert. Haken fließen nicht zurück.';
          announce(els.shopNote.textContent);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
        } else {
          fallbackCopy(text, done);
        }
      });
    }

    if (els.finishTrip) {
      els.finishTrip.addEventListener('click', function () {
        var now = Date.now();
        var result = shop.finishTrip({
          lines: state.lines,
          checked: state.checked,
          pantry: state.pantry,
          skipped: state.skipped,
          planItems: view.planItems,
          pantryItems: meals.pantryIngredients(),
          now: now
        });
        if (!result.bought) {
          els.shopNote.textContent = 'Noch nichts im Wagen.';
          announce(els.shopNote.textContent);
          return;
        }
        remember();
        state.lines = result.lines;
        state.checked = result.checked;
        state.skipped = result.skipped;
        var addedHome = result.pantry.filter(function (id) { return state.pantry.indexOf(id) === -1; });
        if (addedHome.length) {
          state.inventory = meals.absorbIds(state.inventory, addedHome, now);
          state.inventorySet = true;
          publishPantry();
        }
        result.skipped.forEach(function (id) { state.skippedLog[id] = { on: true, rev: now }; });
        Object.keys(state.checkMeta || {}).forEach(function (key) {
          if (result.checked.indexOf(key) === -1 && state.checkMeta[key] && state.checkMeta[key].on) {
            state.checkMeta[key] = { on: false, by: displayName(), rev: now };
          }
        });
        save();
        render();
        els.shopNote.textContent = 'Einkauf abgeschlossen. Gekaufte Grundzutaten sind zu Hause.';
        announce(els.shopNote.textContent);
      });
    }

    if (els.claims) {
      els.claims.addEventListener('click', function (event) {
        var button = event.target.closest('[data-claim]');
        if (!button) return;
        var storeId = button.getAttribute('data-claim');
        var store = storeById(storeId);
        var name = displayName();
        if (!name) {
          els.shopNote.textContent = 'Trag zuerst deinen Namen ein.';
          announce(els.shopNote.textContent);
          if (els.displayName) els.displayName.focus();
          return;
        }
        var claim = shop.claimFor(state.claims, storeId);
        var mine = claim && claim.by === name;
        remember();
        state.claims = shop.setClaim(state.claims, storeId, name, !mine, Date.now());
        save();
        renderClaims();
        renderShop();
        announce(mine ? (store ? store.name : 'Markt') + ' ist wieder frei.' : (store ? store.name : 'Markt') + ' ist deins.');
      });
    }

    if (els.evenings) {
      var cookNoted = {};
      els.evenings.addEventListener('focusin', function (event) {
        var input = event.target.closest('[data-cook]');
        if (input) cookNoted[input.getAttribute('data-cook')] = false;
      });
      els.evenings.addEventListener('change', function (event) {
        var select = event.target.closest('[data-evening]');
        if (!select) return;
        remember();
        setEvening(select.getAttribute('data-evening'), { recipeId: select.value });
      });
      els.evenings.addEventListener('input', function (event) {
        var input = event.target.closest('[data-cook]');
        if (!input) return;
        var day = input.getAttribute('data-cook');
        if (!cookNoted[day]) {
          remember();
          cookNoted[day] = true;
        }
        setEvening(day, { cook: input.value });
      });
    }

    if (els.recipeAdd) {
      els.recipeAdd.addEventListener('click', function () {
        var id = els.recipeIngredient.value;
        var amount = shop.fold(els.recipeAmount.value) || '1';
        if (amount.length > 40) {
          els.recipeNote.textContent = 'Die Menge ist zu lang.';
          return;
        }
        var next = recipeDraft.filter(function (item) { return item.id !== id; });
        next.push({ id: id, amount: amount });
        recipeDraft = next;
        els.recipeAmount.value = '';
        renderRecipeDraft();
      });
    }

    if (els.recipeIngredients) {
      els.recipeIngredients.addEventListener('click', function (event) {
        var button = event.target.closest('[data-draft]');
        if (!button) return;
        recipeDraft.splice(Number(button.getAttribute('data-draft')), 1);
        renderRecipeDraft();
      });
    }

    if (els.recipeForm) {
      els.recipeForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var title = shop.fold(els.recipeTitle.value);
        if (!title) {
          els.recipeNote.textContent = 'Trag einen Namen ein.';
          return;
        }
        if (!recipeDraft.length) {
          els.recipeNote.textContent = 'Mindestens eine Zutat.';
          return;
        }
        var id = meals.nextRecipeId(state.recipes);
        state.recipes = meals.cleanCustomRecipes(state.recipes.concat([{
          id: id,
          custom: true,
          title: title,
          minutes: 20,
          steps: [],
          ingredients: recipeDraft.slice(),
          rev: Date.now(),
          deleted: false
        }]));
        recipeDraft = [];
        els.recipeTitle.value = '';
        els.recipeNote.textContent = title + ' ist bei den Gerichten.';
        renderRecipeDraft();
        save();
        render();
        announce(els.recipeNote.textContent);
      });
    }

    if (els.stapleForm) {
      els.stapleForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var result = shop.addStaple(state.staples, els.stapleText.value, els.stapleAmount.value, Date.now());
        if (!result.ok) {
          els.stapleNote.textContent = result.reason === 'empty' ? 'Trag einen Artikelnamen ein.' : 'Das ist zu lang.';
          return;
        }
        if (result.created || result.merged) remember();
        if (result.created) {
          state.staples = result.staples.concat([Object.assign({ id: shop.nextStapleId(result.staples) }, result.draft)]);
          els.stapleText.value = '';
          els.stapleAmount.value = '';
        } else {
          state.staples = result.staples;
        }
        els.stapleNote.textContent = result.already ? 'Steht schon bei den festen Artikeln.' : 'Gemerkt.';
        save();
        renderStaples();
        announce(els.stapleNote.textContent);
      });
    }

    if (els.staples) {
      els.staples.addEventListener('click', function (event) {
        var add = event.target.closest('[data-staple-add]');
        if (add) {
          var staple = null;
          state.staples.forEach(function (item) {
            if (item.id === add.getAttribute('data-staple-add')) staple = item;
          });
          if (!staple) return;
          var result = shop.addManual(state.lines, view.planItems, state.extraAmounts, staple.name, staple.amount);
          noteShop(result, staple.name);
          return;
        }
        var remove = event.target.closest('[data-staple-remove]');
        if (!remove) return;
        var removeId = remove.getAttribute('data-staple-remove');
        remember();
        state.staples = state.staples.map(function (item) {
          if (item.id !== removeId) return item;
          return Object.assign({}, item, { deleted: true, rev: Date.now() });
        });
        save();
        renderStaples();
      });
    }

    if (els.undoBtn) els.undoBtn.addEventListener('click', undoEdit);
    if (els.redoBtn) els.redoBtn.addEventListener('click', redoEdit);
    if (els.clearList) els.clearList.addEventListener('click', clearShoppingList);
    syncHistoryButtons();

    if (els.sync) els.sync.addEventListener('click', openSyncSheet);
    if (els.sheet) {
      els.sheet.addEventListener('click', function (event) {
        if (event.target.closest('[data-sheet-close]')) closeSheet();
      });
      els.sheetForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!sheetState.onSubmit) return;
        var error = sheetState.onSubmit();
        if (error && error !== 'stay') showSheetError(error);
      });
    }

    if (els.scanOpen) els.scanOpen.addEventListener('click', openScanner);
    if (els.scanner) {
      els.scanner.addEventListener('click', function (event) {
        if (event.target.closest('[data-scan-close]')) closeScanner();
      });
    }
    if (els.scannerNameForm) {
      els.scannerNameForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var code = pendingCode;
        var typed = els.scannerName ? els.scannerName.value : '';
        if (!code) return;
        if (commitScan(code, typed)) hideNamePrompt();
      });
    }
    var skipName = document.getElementById('scanner-name-skip');
    if (skipName) {
      skipName.addEventListener('click', function () {
        hideNamePrompt();
        setScanStatus('Halte den Strichcode in die Kamera.');
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !els.scanner || els.scanner.hidden) return;
      event.preventDefault();
      closeScanner();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) closeScanner();
    });

    if (els.tickerBanner) {
      els.tickerBanner.addEventListener('click', function () {
        selectTab('angebote');
        var heading = document.getElementById('ticker-heading');
        if (heading && heading.scrollIntoView) heading.scrollIntoView({ block: 'start' });
      });
    }
    if (els.tickerForm && tickerApi) {
      els.tickerForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var result = tickerApi.addItem(tickerState, els.tickerText.value);
        if (!result.ok) {
          if (els.tickerNote) els.tickerNote.textContent = result.error;
          announce(result.error);
          return;
        }
        tickerState = result.state;
        var saved = saveTicker();
        els.tickerText.value = '';
        renderTicker();
        var fresh = tickerApi.reminders(tickerState, tickerStores())[0];
        var message = result.state.items[0].query + ' steht auf dem Ticker.';
        if (fresh && fresh.hits.length) message = fresh.query + ' ist im Angebot.';
        if (!saved) message += ' Speichern auf diesem Gerät ist fehlgeschlagen.';
        announce(message);
      });
      if (els.tickerList) {
        els.tickerList.addEventListener('click', function (event) {
          var removeButton = event.target.closest('[data-ticker-remove]');
          if (!removeButton) return;
          var id = removeButton.getAttribute('data-ticker-remove');
          var current = null;
          tickerState.items.forEach(function (item) {
            if (item.id === id) current = item;
          });
          var removed = tickerApi.removeItem(tickerState, id);
          if (!removed.ok) {
            announce(removed.error);
            return;
          }
          tickerState = removed.state;
          saveTicker();
          renderTicker();
          announce((current ? current.query : 'Eintrag') + ' vom Ticker genommen.');
        });
      }
    }

    render();
    updateConnectivity();
    window.addEventListener('online', function () {
      updateConnectivity();
      if (session) session.retry();
    });
    window.addEventListener('offline', updateConnectivity);
    registerServiceWorker();
    startSession();
  }

  init();
})();
