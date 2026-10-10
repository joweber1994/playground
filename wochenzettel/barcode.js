/* Wochenzettel – Strichcode zum Vorrat.
   Reine Funktionen, ohne DOM und ohne Netz. Im Browser als WochenzettelBarcode, unter Node als Modul.
   Der Name kommt aus der Open-Food-Facts-Antwort v2: product_name_de, dann product_name, brands, quantity. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WochenzettelBarcode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function fold(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function revOf(value) {
    var rev = Math.floor(Number(value));
    if (!Number.isFinite(rev) || rev < 0) return 0;
    return rev;
  }

  function unitsOf(value) {
    var units = Math.floor(Number(value));
    if (!Number.isFinite(units) || units < 0) return 0;
    if (units > 999) return 999;
    return units;
  }

  function checksumOk(digits) {
    if (!/^\d+$/.test(digits)) return false;
    var sum = 0;
    var i;
    for (i = 0; i < digits.length - 1; i += 1) {
      var fromRight = digits.length - 1 - i;
      sum += Number(digits[i]) * (fromRight % 2 === 1 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
  }

  function canonical(code) {
    var digits = String(code == null ? '' : code).replace(/\D/g, '');
    if (digits.length === 12) digits = '0' + digits;
    if (digits.length !== 8 && digits.length !== 13) return '';
    return checksumOk(digits) ? digits : '';
  }

  function productName(payload) {
    if (!payload || Number(payload.status) !== 1 || !payload.product || typeof payload.product !== 'object') return '';
    var keys = ['product_name_de', 'product_name', 'brands', 'quantity'];
    var name = '';
    var i;
    for (i = 0; i < keys.length; i += 1) {
      name = fold(payload.product[keys[i]]);
      if (name) break;
    }
    if (name.length > 80) name = fold(name.slice(0, 80));
    return name;
  }

  function copyRow(row) {
    if (!row || typeof row !== 'object') return null;
    var id = String(row.id || '').trim();
    var name = fold(row.name);
    if (!id || !name) return null;
    return {
      id: id,
      name: name,
      amount: fold(row.amount).slice(0, 80),
      units: unitsOf(row.units),
      barcode: canonical(row.barcode),
      rev: revOf(row.rev),
      deleted: !!row.deleted
    };
  }

  function savedName(rows, code) {
    var want = canonical(code);
    if (!want) return '';
    var live = '';
    var dead = '';
    (rows || []).forEach(function (row) {
      var item = copyRow(row);
      if (!item || item.barcode !== want) return;
      if (item.deleted) dead = item.name;
      else live = item.name;
    });
    return live || dead;
  }

  function nextId(rows) {
    var n = 0;
    rows.forEach(function (row) {
      var match = /^v(\d+)$/.exec(row.id);
      if (match) n = Math.max(n, Number(match[1]));
    });
    return 'v' + (n + 1);
  }

  function hoist(list, id) {
    var hit = null;
    var rest = [];
    list.forEach(function (item) {
      if (item.id === id && !hit) hit = item;
      else rest.push(item);
    });
    return hit ? [hit].concat(rest) : list;
  }

  function addScanned(rows, code, name, now) {
    var list = [];
    (rows || []).forEach(function (row) {
      var item = copyRow(row);
      if (item) list.push(item);
    });
    var barcode = canonical(code);
    var clean = fold(name);
    if (!barcode) return { ok: false, reason: 'code', inventory: list };
    if (!clean) return { ok: false, reason: 'empty', inventory: list };
    if (clean.length > 80) return { ok: false, reason: 'long', inventory: list };
    var key = clean.toLowerCase();
    var rev = revOf(now);
    var liveCode = null;
    var liveName = null;
    var tombCode = null;
    var tombName = null;
    list.forEach(function (item) {
      if (item.barcode === barcode) {
        if (item.deleted) tombCode = item;
        else liveCode = item;
      }
      if (item.name.toLowerCase() !== key) return;
      if (item.deleted) tombName = item;
      else liveName = item;
    });
    var existing = liveCode || liveName;
    if (existing) {
      var units = Math.min(999, existing.units + 1);
      var kept = existing.barcode && existing.barcode !== barcode ? existing.barcode : barcode;
      if (!liveCode && existing.barcode) kept = existing.barcode;
      var updated = list.map(function (item) {
        if (kept === barcode && item.id !== existing.id && item.barcode === barcode) {
          return {
            id: item.id,
            name: item.name,
            amount: item.amount,
            units: item.units,
            barcode: '',
            rev: item.rev,
            deleted: item.deleted
          };
        }
        if (item.id !== existing.id) return item;
        return {
          id: item.id,
          name: item.name,
          amount: item.amount,
          units: units,
          barcode: kept,
          rev: rev || item.rev,
          deleted: false
        };
      });
      return { ok: true, incremented: true, inventory: hoist(updated, existing.id), id: existing.id, name: existing.name, units: units };
    }
    var tomb = tombCode || tombName;
    if (tomb) {
      var revivedName = tomb.name || clean;
      var revived = list.map(function (item) {
        if (item.id !== tomb.id && item.barcode === barcode) {
          return {
            id: item.id,
            name: item.name,
            amount: item.amount,
            units: item.units,
            barcode: '',
            rev: item.rev,
            deleted: item.deleted
          };
        }
        if (item.id !== tomb.id) return item;
        return {
          id: item.id,
          name: revivedName,
          amount: item.amount,
          units: 1,
          barcode: barcode,
          rev: rev || item.rev,
          deleted: false
        };
      });
      return { ok: true, created: true, inventory: hoist(revived, tomb.id), id: tomb.id, name: revivedName, units: 1 };
    }
    var id = nextId(list);
    list.unshift({
      id: id,
      name: clean,
      amount: '',
      units: 1,
      barcode: barcode,
      rev: rev,
      deleted: false
    });
    return { ok: true, created: true, inventory: list, id: id, name: clean, units: 1 };
  }

  function renameItem(rows, id, name, now) {
    var list = [];
    (rows || []).forEach(function (row) {
      var item = copyRow(row);
      if (item) list.push(item);
    });
    var clean = fold(name);
    if (!clean) return { ok: false, reason: 'empty', inventory: list };
    if (clean.length > 80) return { ok: false, reason: 'long', inventory: list };
    var current = null;
    var clash = false;
    list.forEach(function (item) {
      if (item.deleted) return;
      if (item.id === id) current = item;
      else if (item.name.toLowerCase() === clean.toLowerCase()) clash = true;
    });
    if (!current) return { ok: false, reason: 'missing', inventory: list };
    if (current.name === clean) return { ok: true, same: true, inventory: list, id: id, name: clean };
    if (clash) return { ok: false, reason: 'exists', inventory: list };
    var rev = revOf(now);
    var next = list.map(function (item) {
      if (item.id !== id) return item;
      return {
        id: item.id,
        name: clean,
        amount: item.amount,
        units: item.units,
        barcode: item.barcode,
        rev: rev || item.rev,
        deleted: false
      };
    });
    return { ok: true, renamed: true, inventory: next, id: id, name: clean, barcode: current.barcode };
  }

  return {
    canonical: canonical,
    productName: productName,
    savedName: savedName,
    addScanned: addScanned,
    renameItem: renameItem
  };
});
