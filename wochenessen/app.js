(function () {
  'use strict';

  var meals = window.WochenessenMeals;
  var catalog = window.WochenessenOffers;
  if (!meals || !catalog || !catalog.stores || !catalog.stores.length) return;

  var STORAGE_KEY = 'wochenessen-v1';
  var state = meals.freshState(new Date());
  state.storeIds = [catalog.stores[0].id];
  state.extras = {};

  var els = {
    weekLine: document.getElementById('week-line'),
    week: document.getElementById('week-note'),
    stores: document.getElementById('stores'),
    combo: document.getElementById('combo'),
    unavailable: document.getElementById('unavailable'),
    storeNote: document.getElementById('store-note'),
    prospekte: document.getElementById('prospekte'),
    matched: document.getElementById('matched'),
    offerScroll: document.getElementById('offer-scroll'),
    extraWrap: document.getElementById('extra-store-wrap'),
    extraStore: document.getElementById('extra-store'),
    form: document.getElementById('offer-form'),
    text: document.getElementById('offer-text'),
    note: document.getElementById('offer-note'),
    pantry: document.getElementById('pantry'),
    ideas: document.getElementById('ideas'),
    storePicks: document.getElementById('store-picks'),
    marketWrap: document.getElementById('market-wrap'),
    market: document.getElementById('market'),
    shopHeading: document.getElementById('shop-heading'),
    shopEmpty: document.getElementById('shop-empty'),
    shop: document.getElementById('shop-list'),
    connectivity: document.getElementById('connectivity'),
    live: document.getElementById('live')
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function announce(message) {
    if (els.live) els.live.textContent = message;
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
    return meals.suggest(ingredientIds(store), state.pantry).length;
  }

  function bestStoreId(pantry) {
    var best = catalog.stores[0];
    var bestCount = -1;
    catalog.stores.forEach(function (store) {
      var count = meals.suggest(meals.idsFromOffers(store.offers || []), pantry).length;
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

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (error) { raw = null; }
    var saved = null;
    if (raw) {
      try { saved = JSON.parse(raw); } catch (error) { saved = null; }
    }
    var loaded = meals.normalizeState(saved, new Date());
    var next = loaded.state;
    next.extras = loaded.weekChanged ? {} : cleanExtras(saved && saved.extras);
    if (saved && Array.isArray(saved.storeIds)) {
      next.storeIds = orderedIds(saved.storeIds.filter(function (id) { return storeById(id); }));
    } else if (saved && storeById(saved.storeId)) {
      next.storeIds = [saved.storeId];
    } else {
      next.storeIds = [bestStoreId(next.pantry)];
    }
    return { state: next, weekChanged: loaded.weekChanged };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* Private mode can reject storage; the page still works for this visit. */
    }
  }

  function suggestions() {
    return meals.suggest(unionIds(selectedStores()), state.pantry);
  }

  function storeNames(stores) {
    return stores.map(function (store) {
      if (store.id === 'prechtl') return store.name + ' ' + meals.marketById(state.marketId).name;
      return store.name;
    });
  }

  function sources() {
    return selectedStores().map(function (store) {
      return {
        id: store.id,
        name: store.id === 'prechtl' ? store.name + ' ' + meals.marketById(state.marketId).name : store.name,
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
      els.combo.textContent = selected[0].name + ' ist ausgewählt. Weitere Märkte kannst du dazunehmen.';
      return;
    }
    var count = meals.suggest(unionIds(selected), state.pantry).length;
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
          storeName: store.name
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

  function renderOfferList(stores) {
    var rows = combinedRows(stores);
    if (!rows.length) {
      els.offerScroll.innerHTML = '<p class="empty offer-empty">In diesen Prospekten stehen keine Lebensmittel.</p>';
      return;
    }
    var showStore = stores.length > 1;
    els.offerScroll.innerHTML = rows.map(function (offer) {
      var hit = meals.matchOfferText(offer.name).length > 0;
      var meta = [showStore ? offer.storeName : '', formatPrice(offer.price), offer.amount].filter(function (part) { return part; }).join(' · ');
      return '<div class="offer-row' + (hit ? ' is-hit' : '') + '">' +
        '<span class="offer-name">' + escapeHtml(offer.name) +
        (offer.extra ? ' <span class="offer-extra">ergänzt</span>' : '') + '</span>' +
        (meta ? '<span class="offer-meta">' + escapeHtml(meta) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  function renderStoreDetail() {
    var stores = selectedStores();
    if (!stores.length) {
      els.storeNote.textContent = 'Wähl mindestens einen Supermarkt. Die Angebote werden zusammengezählt.';
      els.prospekte.innerHTML = '';
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
    els.marketWrap.hidden = state.storeIds.indexOf('prechtl') === -1;
    var stores = selectedStores();
    var previous = els.extraStore.value;
    els.extraWrap.hidden = stores.length < 2;
    els.extraStore.innerHTML = stores.map(function (store) {
      return '<option value="' + store.id + '">' + escapeHtml(store.name) + '</option>';
    }).join('');
    if (stores.some(function (store) { return store.id === previous; })) els.extraStore.value = previous;
  }

  function renderPantry() {
    var html = '';
    meals.GROUPS.forEach(function (group) {
      var inGroup = meals.pantryIngredients().filter(function (item) { return item.group === group.id; });
      if (!inGroup.length) return;
      html += '<h3 class="group-label">' + escapeHtml(group.label) + '</h3><div class="chips">';
      inGroup.forEach(function (item) {
        var on = state.pantry.indexOf(item.id) !== -1;
        html += '<button type="button" class="chip" data-pantry="' + item.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + escapeHtml(item.name) + '</button>';
      });
      html += '</div>';
    });
    els.pantry.innerHTML = html;
  }

  function renderIdeas() {
    var list = suggestions();
    var chosen = meals.chosenIds(list, state.picked);
    if (!selectedStores().length) {
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
      var steps = recipe.steps.map(function (step) {
        return '<li>' + escapeHtml(step) + '</li>';
      }).join('');
      return '<article class="meal">' +
        '<div class="meal-top"><h3>' + escapeHtml(recipe.title) + '</h3>' +
        '<p class="meta">' + recipe.minutes + ' Min · ' + plural(recipe.hits.length, 'Angebot', 'Angebote') + '</p></div>' +
        '<p class="hits">Im Angebot: ' + hits + '</p>' +
        '<p class="missing">' + missing + '</p>' +
        '<ol class="steps">' + steps + '</ol>' +
        '<button type="button" class="pick" data-pick="' + recipe.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        (on ? 'Auf der Einkaufsliste' : 'Auf die Einkaufsliste') + '</button></article>';
    }).join('');
  }

  function shopItem(item) {
    return '<li class="shop-item"><span class="shop-name">' + escapeHtml(item.name) + '</span>' +
      '<span class="shop-amount">' + escapeHtml(item.amounts.join(' · ')) + '</span>' +
      '<span class="shop-meals">für ' + escapeHtml(item.meals.join(', ')) + '</span></li>';
  }

  function renderShop() {
    var stores = selectedStores();
    els.shopHeading.textContent = stores.length ? 'Einkauf bei ' + joinNames(storeNames(stores)) : 'Einkaufsliste';
    var list = suggestions();
    var chosen = meals.chosenIds(list, state.picked);
    if (!stores.length) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = 'Wähl mindestens einen Supermarkt.';
      return;
    }
    if (!list.length) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = 'Aus diesen Angeboten lässt sich keins der Gerichte kochen.';
      return;
    }
    if (!chosen.length) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = 'Kein Gericht auf der Liste.';
      return;
    }
    var plan = meals.shopPlan(list, state.picked, sources());
    if (!plan.offers.length && !plan.missing.length) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = 'Für die ausgewählten Gerichte ist alles da.';
      return;
    }
    els.shopEmpty.hidden = true;
    var html = '';
    plan.offers.forEach(function (group) {
      html += '<li class="shop-label">' + escapeHtml(group.label) + '</li>';
      html += group.items.map(shopItem).join('');
    });
    if (plan.missing.length) {
      html += '<li class="shop-label">Noch kaufen</li>';
      html += plan.missing.map(shopItem).join('');
    }
    els.shop.innerHTML = html;
  }

  function render() {
    renderStores();
    renderStoreDetail();
    renderChoice();
    renderPantry();
    renderIdeas();
    renderShop();
  }

  function toggleStore(id) {
    var store = storeById(id);
    if (!store) return;
    var next = state.storeIds.slice();
    var at = next.indexOf(id);
    if (at === -1) next.push(id);
    else next.splice(at, 1);
    state.storeIds = orderedIds(next);
    state.picked = null;
    if (els.note) els.note.textContent = '';
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
      node.textContent = 'Offline – die Liste bleibt auf diesem Gerät';
      return;
    }
    if (!('serviceWorker' in navigator) || navigator.serviceWorker.controller) {
      node.classList.add('is-ready');
      node.textContent = 'Offline-bereit';
      return;
    }
    node.textContent = 'Wird auf diesem Gerät gespeichert…';
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
      els.week.textContent = 'Neue Woche. Ergänzungen der letzten Woche sind geleert.';
    }
    save();

    els.market.innerHTML = meals.MARKETS.map(function (market) {
      return '<option value="' + market.id + '">' + escapeHtml(market.name) + '</option>';
    }).join('');
    els.market.value = state.marketId;

    function onStoreClick(event) {
      var button = event.target.closest('[data-store]');
      if (!button) return;
      toggleStore(button.getAttribute('data-store'));
    }
    els.stores.addEventListener('click', onStoreClick);
    els.storePicks.addEventListener('click', onStoreClick);

    els.market.addEventListener('change', function () {
      state.marketId = meals.marketById(els.market.value).id;
      save();
      renderShop();
      announce('Markt ' + meals.marketById(state.marketId).name);
    });

    els.pantry.addEventListener('click', function (event) {
      var button = event.target.closest('[data-pantry]');
      if (!button) return;
      var id = button.getAttribute('data-pantry');
      var at = state.pantry.indexOf(id);
      if (at === -1) state.pantry.push(id);
      else state.pantry.splice(at, 1);
      save();
      renderPantry();
      renderIdeas();
      renderShop();
      var name = meals.ingredient(id).name;
      announce(state.pantry.indexOf(id) === -1 ? name + ' ist nicht zu Hause' : name + ' ist zu Hause');
    });

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

    els.ideas.addEventListener('click', function (event) {
      var button = event.target.closest('[data-pick]');
      if (!button) return;
      var id = button.getAttribute('data-pick');
      var list = suggestions();
      var chosen = meals.chosenIds(list, state.picked);
      var at = chosen.indexOf(id);
      if (at === -1) chosen.push(id);
      else chosen.splice(at, 1);
      state.picked = chosen;
      save();
      renderIdeas();
      renderShop();
      var recipe = null;
      list.forEach(function (item) { if (item.id === id) recipe = item; });
      if (recipe) {
        announce(at === -1 ? recipe.title + ' ist auf der Einkaufsliste' : recipe.title + ' ist von der Liste');
      }
    });

    render();
    updateConnectivity();
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    registerServiceWorker();
  }

  init();
})();
