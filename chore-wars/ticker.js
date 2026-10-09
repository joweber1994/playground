/* Chore Wars – Ticker für gemerkte Artikel.
   Reine Funktionen, ohne DOM. Im Browser als ChoreWarsTicker, unter Node als Modul. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoreWarsTicker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STORAGE_KEY = 'chore-wars-ticker-v1';
  var QUERY_MAX = 80;
  var LIST_MAX = 20;

  var GROUPS = [
    ['nudel', 'nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'rigatoni', 'makkaroni', 'farfalle', 'tagliatelle', 'gnocchi', 'spaghettini', 'noodle', 'noodles'],
    ['reis', 'expressreis', 'basmatireis', 'duftreis'],
    ['ei', 'eier'],
    ['zwiebel', 'zwiebeln'],
    ['apfel', 'aepfel'],
    ['kartoffel', 'kartoffeln', 'erdaepfel'],
    ['oel', 'olivenoel', 'rapsoel'],
    ['kaese', 'frischkaese'],
    ['joghurt', 'jogurt']
  ];

  var BLOCKED_PAIR = {
    'kaese|leberkaese': 1,
    'reis|preis': 1,
    'lachs|lachse': 1,
    'eis|eisbein': 1,
    'pfeffer|pfefferer': 1,
    'wein|schwein': 1
  };

  var BLOCKED_REST = {
    sauce: 1,
    saucen: 1,
    suppe: 1,
    saft: 1,
    schorle: 1,
    nudel: 1,
    nudeln: 1
  };

  function fold(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss');
  }

  function collapse(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function tokens(text) {
    return fold(text).split(/[^a-z0-9]+/).map(function (part) {
      if (/^\d+(kg|ml|stk|g|l)$/.test(part)) return '';
      return part;
    }).filter(function (part) {
      return part.length > 1 && !/^\d+$/.test(part);
    });
  }

  function canon(token) {
    for (var i = 0; i < GROUPS.length; i += 1) {
      if (GROUPS[i].indexOf(token) !== -1) return GROUPS[i][0];
    }
    return token;
  }

  function sameWord(a, b) {
    if (a === b) return true;
    if (a + 'n' === b || b + 'n' === a) return true;
    if (a + 's' === b || b + 's' === a) return true;
    if (a + 'en' === b || b + 'en' === a) return true;
    return false;
  }

  function tokenMatch(queryToken, offerToken) {
    var q = canon(queryToken);
    var o = canon(offerToken);
    if (BLOCKED_PAIR[q + '|' + o]) return false;
    if (sameWord(q, o)) return true;
    if (q.length >= 5 && o.indexOf(q) === 0) {
      var rest = o.slice(q.length);
      if (BLOCKED_REST[rest]) return false;
      return true;
    }
    if (q.length >= 5 && o.length > q.length && o.lastIndexOf(q) === o.length - q.length) {
      return true;
    }
    return false;
  }

  function mentionsNoodle(text) {
    return tokens(text).some(function (word) { return canon(word) === 'nudel'; });
  }

  function mentionsSauce(text) {
    var folded = fold(text);
    return folded.indexOf('sauce') !== -1 || folded.indexOf('soss') !== -1;
  }

  function queryMatchesOffer(query, offerName) {
    var wanted = tokens(query);
    var have = tokens(offerName);
    if (!wanted.length || !have.length) return false;
    if (have.indexOf('schoko') !== -1 && wanted.indexOf('schoko') === -1 && wanted.some(function (word) { return canon(word) === 'reis'; })) {
      return false;
    }
    if (mentionsSauce(offerName) && mentionsNoodle(query) && !mentionsSauce(query)) return false;
    return wanted.every(function (needle) {
      return have.some(function (word) { return tokenMatch(needle, word); });
    });
  }

  function queryKey(query) {
    return tokens(query).map(canon).join(' ');
  }

  function readQuery(value) {
    if (typeof value !== 'string' || collapse(value).length < 1) {
      return { ok: false, error: 'Trag einen Artikelnamen ein.' };
    }
    var query = collapse(value);
    if (query.length > QUERY_MAX) return { ok: false, error: 'Der Name ist zu lang.' };
    if (!tokens(query).length) return { ok: false, error: 'Der Name ist zu kurz.' };
    return { ok: true, value: query };
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function blank() {
    return { items: [] };
  }

  function normalize(saved) {
    var items = [];
    var seen = {};
    var list = saved && Array.isArray(saved.items) ? saved.items : [];
    list.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var read = readQuery(item.query);
      if (!read.ok) return;
      var key = queryKey(read.value);
      if (!key || seen[key]) return;
      seen[key] = true;
      var id = typeof item.id === 'string' && item.id && item.id.length <= 80 ? item.id : uid();
      items.push({ id: id, query: read.value });
    });
    return { items: items.slice(0, LIST_MAX) };
  }

  function addItem(state, query, options) {
    var read = readQuery(query);
    if (!read.ok) return read;
    var current = normalize(state);
    var key = queryKey(read.value);
    for (var i = 0; i < current.items.length; i += 1) {
      if (queryKey(current.items[i].query) === key) {
        return { ok: false, error: 'Steht schon auf dem Ticker.' };
      }
    }
    if (current.items.length >= LIST_MAX) return { ok: false, error: 'Der Ticker ist voll.' };
    var id = options && options.id ? String(options.id) : uid();
    return { ok: true, state: { items: [{ id: id, query: read.value }].concat(current.items) } };
  }

  function removeItem(state, id) {
    var current = normalize(state);
    var items = current.items.filter(function (item) { return item.id !== id; });
    if (items.length === current.items.length) return { ok: false, error: 'Der Eintrag fehlt.' };
    return { ok: true, state: { items: items } };
  }

  function flattenOffers(stores) {
    var rows = [];
    (stores || []).forEach(function (store) {
      (store.offers || []).forEach(function (offer) {
        var name = offer && typeof offer === 'object' ? offer.name : offer;
        if (!name) return;
        rows.push({
          storeId: store.id || '',
          storeName: store.name || '',
          name: String(name),
          price: offer && typeof offer === 'object' ? String(offer.price || '') : '',
          amount: offer && typeof offer === 'object' ? String(offer.amount || '') : ''
        });
      });
    });
    return rows;
  }

  function formatPrice(price) {
    var text = String(price || '').trim();
    if (!text) return '';
    if (/^\d+\.\d+$/.test(text) || /^\d+$/.test(text)) return text.replace('.', ',') + ' €';
    return text;
  }

  function matches(query, offers) {
    var hits = [];
    (offers || []).forEach(function (offer) {
      if (!queryMatchesOffer(query, offer.name)) return;
      hits.push({
        storeId: offer.storeId || '',
        storeName: offer.storeName || '',
        name: offer.name,
        price: formatPrice(offer.price),
        amount: offer.amount || ''
      });
    });
    return hits;
  }

  function reminders(state, stores) {
    var current = normalize(state);
    var offers = flattenOffers(stores);
    return current.items.map(function (item) {
      return { id: item.id, query: item.query, hits: matches(item.query, offers) };
    });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    blank: blank,
    normalize: normalize,
    addItem: addItem,
    removeItem: removeItem,
    queryMatchesOffer: queryMatchesOffer,
    flattenOffers: flattenOffers,
    matches: matches,
    reminders: reminders,
    formatPrice: formatPrice
  };
});
