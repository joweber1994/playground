/* Erinnerungen – Texte mit optionalem Datum.
   Reine Funktionen, ohne DOM. Im Browser als ErinnerungenLogik, unter Node als Modul. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ErinnerungenLogik = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STORAGE_KEY = 'erinnerungen-v1';
  var TEXT_MAX = 120;
  var LIST_MAX = 80;

  function blank() {
    return { items: [] };
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function pad(number) {
    return number < 10 ? '0' + number : String(number);
  }

  function validDate(value) {
    if (value == null || value === '') return '';
    var text = String(value).trim();
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return text;
  }

  function normalize(raw) {
    var items = [];
    var seen = {};
    var source = raw && Array.isArray(raw.items) ? raw.items : [];
    source.forEach(function (item) {
      if (items.length >= LIST_MAX) return;
      if (!item || typeof item !== 'object') return;
      var id = String(item.id == null ? '' : item.id).trim();
      var text = cleanText(item.text);
      var date = validDate(item.date);
      if (!id || !text || date === null || seen[id]) return;
      if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX).trim();
      if (!text) return;
      seen[id] = 1;
      items.push({
        id: id,
        text: text,
        date: date,
        done: item.done === true
      });
    });
    return { items: items };
  }

  function uniqueId(items, id) {
    var taken = {};
    items.forEach(function (item) { taken[item.id] = 1; });
    var unique = id;
    var n = 1;
    while (taken[unique]) {
      unique = id + '-' + n;
      n += 1;
    }
    return unique;
  }

  function addItem(state, text, date, options) {
    var current = normalize(state);
    var clean = cleanText(text);
    if (!clean) return { ok: false, error: 'Bitte einen Text eingeben.', state: current };
    if (clean.length > TEXT_MAX) return { ok: false, error: 'Höchstens 120 Zeichen.', state: current };
    var when = validDate(date);
    if (when === null) return { ok: false, error: 'Das Datum ist ungültig.', state: current };
    if (current.items.length >= LIST_MAX) {
      return { ok: false, error: 'Die Liste ist voll. Erledigte lassen sich löschen.', state: current };
    }
    var requested = options && options.id ? String(options.id).trim() : String(Date.now());
    if (!requested) requested = String(Date.now());
    var item = {
      id: uniqueId(current.items, requested),
      text: clean,
      date: when,
      done: false
    };
    return { ok: true, state: { items: [item].concat(current.items) }, item: item };
  }

  function updateItems(state, id, change) {
    var current = normalize(state);
    var hit = false;
    var items = current.items.map(function (item) {
      if (item.id !== id) return item;
      hit = true;
      return change(item);
    });
    if (!hit) return { ok: false, error: 'Die Erinnerung fehlt.', state: current };
    return { ok: true, state: { items: items } };
  }

  function toggleItem(state, id) {
    return updateItems(state, id, function (item) {
      return { id: item.id, text: item.text, date: item.date, done: !item.done };
    });
  }

  function removeItem(state, id) {
    var current = normalize(state);
    var items = current.items.filter(function (item) { return item.id !== id; });
    if (items.length === current.items.length) return { ok: false, error: 'Die Erinnerung fehlt.', state: current };
    return { ok: true, state: { items: items } };
  }

  function clearDone(state) {
    var current = normalize(state);
    return { items: current.items.filter(function (item) { return !item.done; }) };
  }

  function shiftIso(iso, days) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return '';
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    date.setUTCDate(date.getUTCDate() + days);
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
  }

  function whenKind(date, today) {
    if (!date) return 'none';
    if (date < today) return 'overdue';
    if (date === today) return 'today';
    if (date === shiftIso(today, 1)) return 'tomorrow';
    return 'upcoming';
  }

  function formatDate(iso) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return '';
    return String(Number(match[3])) + '.' + String(Number(match[2])) + '.' + match[1];
  }

  function whenLabel(date, today) {
    var kind = whenKind(date, today);
    if (kind === 'none') return '';
    if (kind === 'today') return 'heute';
    if (kind === 'tomorrow') return 'morgen';
    if (date === shiftIso(today, -1)) return 'gestern';
    if (kind === 'overdue') return 'überfällig · ' + formatDate(date);
    return formatDate(date);
  }

  function sortOpen(items, today) {
    var rank = { overdue: 0, today: 1, tomorrow: 2, upcoming: 3, none: 4 };
    return items.slice().sort(function (a, b) {
      var left = rank[whenKind(a.date, today)];
      var right = rank[whenKind(b.date, today)];
      if (left !== right) return left - right;
      if (!a.date || !b.date) return 0;
      if (a.date === b.date) return 0;
      return a.date < b.date ? -1 : 1;
    });
  }

  function groups(state, today) {
    var current = normalize(state);
    var open = [];
    var done = [];
    current.items.forEach(function (item) {
      if (item.done) done.push(item);
      else open.push(item);
    });
    var sorted = sortOpen(open, today || '');
    return {
      open: sorted,
      due: sorted.filter(function (item) {
        var kind = whenKind(item.date, today || '');
        return kind === 'overdue' || kind === 'today';
      }),
      done: done
    };
  }

  function todayFromDate(date) {
    var current = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    return current.getFullYear() + '-' + pad(current.getMonth() + 1) + '-' + pad(current.getDate());
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    TEXT_MAX: TEXT_MAX,
    LIST_MAX: LIST_MAX,
    blank: blank,
    normalize: normalize,
    addItem: addItem,
    toggleItem: toggleItem,
    removeItem: removeItem,
    clearDone: clearDone,
    whenKind: whenKind,
    whenLabel: whenLabel,
    formatDate: formatDate,
    groups: groups,
    todayFromDate: todayFromDate
  };
});
