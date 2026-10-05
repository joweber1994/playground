(function () {
  'use strict';

  var meals = window.WochenessenMeals;
  if (!meals) return;

  var STORAGE_KEY = 'wochenessen-v1';
  var state = meals.freshState(new Date());

  var els = {
    market: document.getElementById('market'),
    prospekt: document.getElementById('prospekt'),
    week: document.getElementById('week-note'),
    offers: document.getElementById('offers'),
    form: document.getElementById('offer-form'),
    text: document.getElementById('offer-text'),
    note: document.getElementById('offer-note'),
    pantry: document.getElementById('pantry'),
    ideas: document.getElementById('ideas'),
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

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (error) { raw = null; }
    var saved = null;
    if (raw) {
      try { saved = JSON.parse(raw); } catch (error) { saved = null; }
    }
    return meals.normalizeState(saved, new Date());
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* Private mode can reject storage; the page still works for this visit. */
    }
  }

  function suggestions() {
    return meals.suggest(state.offers, state.pantry);
  }

  function toggleId(list, id) {
    var next = list.slice();
    var at = next.indexOf(id);
    if (at === -1) next.push(id);
    else next.splice(at, 1);
    return next;
  }

  function renderGrouped(container, items, selected, attr) {
    var html = '';
    meals.GROUPS.forEach(function (group) {
      var inGroup = items.filter(function (item) { return item.group === group.id; });
      if (!inGroup.length) return;
      html += '<h3 class="group-label">' + escapeHtml(group.label) + '</h3><div class="chips">';
      inGroup.forEach(function (item) {
        var on = selected.indexOf(item.id) !== -1;
        html += '<button type="button" class="chip" ' + attr + '="' + item.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + escapeHtml(item.name) + '</button>';
      });
      html += '</div>';
    });
    container.innerHTML = html;
  }

  function renderOffers() {
    renderGrouped(els.offers, meals.offerIngredients(), state.offers, 'data-offer');
  }

  function renderPantry() {
    renderGrouped(els.pantry, meals.pantryIngredients(), state.pantry, 'data-pantry');
  }

  function renderIdeas() {
    var list = suggestions();
    var chosen = meals.chosenIds(list, state.picked);
    if (!list.length) {
      els.ideas.innerHTML = '<p class="empty">Noch kein Angebot. Öffne den Prospekt und kreuze an, was im Blatt steht, oder trag den Namen ein.</p>';
      return;
    }
    els.ideas.innerHTML = list.map(function (recipe) {
      var on = chosen.indexOf(recipe.id) !== -1;
      var hits = recipe.hits.map(function (item) { return escapeHtml(item.name); }).join(', ');
      var missing = recipe.missing.length
        ? 'Dazu: ' + recipe.missing.map(function (item) {
          return escapeHtml(item.name + ' ' + item.amount);
        }).join(', ')
        : 'Nichts extra kaufen';
      var steps = recipe.steps.map(function (step) {
        return '<li>' + escapeHtml(step) + '</li>';
      }).join('');
      var countLabel = recipe.hits.length === 1 ? '1 Angebot' : recipe.hits.length + ' Angebote';
      return '<article class="meal">' +
        '<div class="meal-top"><h3>' + escapeHtml(recipe.title) + '</h3>' +
        '<p class="meta">' + recipe.minutes + ' Min · ' + countLabel + '</p></div>' +
        '<p class="hits">Im Angebot: ' + hits + '</p>' +
        '<p class="missing">' + missing + '</p>' +
        '<ol class="steps">' + steps + '</ol>' +
        '<button type="button" class="pick" data-pick="' + recipe.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        (on ? 'Auf der Einkaufsliste' : 'Auf die Einkaufsliste') + '</button></article>';
    }).join('');
  }

  function renderShop() {
    var market = meals.marketById(state.marketId);
    els.shopHeading.textContent = 'Einkauf bei Prechtl ' + market.name;
    var list = suggestions();
    var chosen = meals.chosenIds(list, state.picked);
    var items = meals.shoppingList(list, state.picked);
    if (!state.offers.length) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = 'Sobald Angebote markiert sind, stehen hier die fehlenden Zutaten.';
      return;
    }
    if (!chosen.length) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = 'Kein Gericht auf der Liste.';
      return;
    }
    if (!items.length) {
      els.shop.innerHTML = '';
      els.shopEmpty.hidden = false;
      els.shopEmpty.textContent = 'Für die ausgewählten Gerichte ist alles da.';
      return;
    }
    els.shopEmpty.hidden = true;
    els.shop.innerHTML = items.map(function (item) {
      return '<li class="shop-item"><span class="shop-name">' + escapeHtml(item.name) + '</span>' +
        '<span class="shop-amount">' + escapeHtml(item.amounts.join(' · ')) + '</span>' +
        '<span class="shop-meals">für ' + escapeHtml(item.meals.join(', ')) + '</span></li>';
    }).join('');
  }

  function render() {
    renderOffers();
    renderPantry();
    renderIdeas();
    renderShop();
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
    if (loaded.weekChanged) els.week.hidden = false;
    save();

    els.prospekt.href = meals.PROSPEKT_URL;
    els.market.innerHTML = meals.MARKETS.map(function (market) {
      return '<option value="' + market.id + '">' + escapeHtml(market.name) + '</option>';
    }).join('');
    els.market.value = state.marketId;

    els.market.addEventListener('change', function () {
      state.marketId = meals.marketById(els.market.value).id;
      save();
      renderShop();
      announce('Markt ' + meals.marketById(state.marketId).name);
    });

    els.offers.addEventListener('click', function (event) {
      var button = event.target.closest('[data-offer]');
      if (!button) return;
      var id = button.getAttribute('data-offer');
      state.offers = toggleId(state.offers, id);
      save();
      render();
      var name = meals.ingredient(id).name;
      announce(state.offers.indexOf(id) === -1 ? name + ' abgewählt' : name + ' als Angebot markiert');
    });

    els.pantry.addEventListener('click', function (event) {
      var button = event.target.closest('[data-pantry]');
      if (!button) return;
      var id = button.getAttribute('data-pantry');
      state.pantry = toggleId(state.pantry, id);
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
      var ids = meals.matchOfferText(text);
      if (!ids.length) {
        els.note.textContent = 'Dazu kenne ich keinen Artikel. Kreuz ihn in der Liste an.';
        announce(els.note.textContent);
        return;
      }
      var added = [];
      var already = [];
      ids.forEach(function (id) {
        var name = meals.ingredient(id).name;
        if (state.offers.indexOf(id) === -1) {
          state.offers.push(id);
          added.push(name);
        } else {
          already.push(name);
        }
      });
      save();
      els.text.value = '';
      els.note.textContent = added.length
        ? 'Übernommen: ' + added.join(', ') + '.'
        : 'Schon markiert: ' + already.join(', ') + '.';
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
