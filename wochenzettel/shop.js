/* Wochenzettel – Einkaufsliste.
   Reine Funktionen, ohne DOM. Im Browser als WochenzettelShop, unter Node als Modul. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WochenzettelShop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var NAME_MAX = 80;
  var AMOUNT_MAX = 80;
  var LINE_MAX = 80;
  var PERSON_MAX = 24;
  var STAPLE_MAX = 40;
  var HISTORY_CAP = 30;
  var WEEK_DAYS = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

  function fold(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function clip(value, max) {
    var text = fold(value);
    if (text.length > max) return text.slice(0, max);
    return text;
  }

  function clipName(value) {
    return clip(value, NAME_MAX);
  }

  function clipPerson(value) {
    return clip(value, PERSON_MAX);
  }

  function revOf(value) {
    var rev = Number(value);
    if (!Number.isFinite(rev) || rev < 0) return 0;
    return Math.floor(rev);
  }

  function nameKey(value) {
    return clipName(value).toLowerCase();
  }

  function copyLine(line) {
    return {
      id: line.id,
      name: line.name,
      amounts: (line.amounts || []).slice(),
      price: line.price || '',
      storeId: line.storeId || '',
      storeName: withoutBranch(line.storeName || ''),
      addedBy: line.addedBy || '',
      rev: revOf(line.rev),
      deleted: !!line.deleted
    };
  }

  var BRANCH_SUFFIXES = [
    'bad feilnbach',
    'bad aibling',
    'oberaudorf',
    'brannenburg',
    'raubling'
  ];

  function withoutBranch(name) {
    var text = fold(name);
    var lower = text.toLowerCase();
    for (var i = 0; i < BRANCH_SUFFIXES.length; i += 1) {
      var suffix = ' ' + BRANCH_SUFFIXES[i];
      if (lower.length > suffix.length && lower.lastIndexOf(suffix) === lower.length - suffix.length) {
        return text.slice(0, text.length - suffix.length).trim();
      }
    }
    return text;
  }

  function cleanAmounts(raw) {
    var amounts = [];
    var source = Array.isArray(raw) ? raw : [];
    source.forEach(function (amount) {
      var text = fold(amount);
      if (!text || text.length > AMOUNT_MAX) return;
      if (amounts.indexOf(text) !== -1) return;
      if (amounts.length >= 6) return;
      amounts.push(text);
    });
    return amounts;
  }

  function cleanLines(raw) {
    var out = [];
    var seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var name = clipName(item.name);
      var id = fold(item.id);
      if (!name || !id || id.length > 40 || seen[id]) return;
      seen[id] = true;
      if (out.length >= LINE_MAX) return;
      out.push({
        id: id,
        name: name,
        amounts: cleanAmounts(Array.isArray(item.amounts) ? item.amounts : (item.amount ? [item.amount] : [])),
        price: clip(item.price, 32),
        storeId: clip(item.storeId, 40),
        storeName: withoutBranch(clip(item.storeName, 40)),
        addedBy: clipPerson(item.addedBy),
        rev: revOf(item.rev),
        deleted: !!item.deleted
      });
    });
    return out;
  }

  function cleanChecked(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (key) {
      var text = fold(key);
      if (!text || text.length > 80) return;
      if (text.indexOf('plan:') !== 0 && text.indexOf('line:') !== 0) return;
      if (out.indexOf(text) !== -1) return;
      if (out.length >= 200) return;
      out.push(text);
    });
    return out;
  }

  function cleanExtraAmounts(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      var id = fold(key);
      if (!id || id.length > 40) return;
      var amounts = cleanAmounts(raw[key]);
      if (amounts.length) out[id] = amounts;
    });
    return out;
  }

  function lineCheckKey(id) {
    return 'line:' + id;
  }

  function planCheckKey(id) {
    return 'plan:' + id;
  }

  function cleanCheckMeta(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      var text = fold(key);
      if (text.indexOf('plan:') !== 0 && text.indexOf('line:') !== 0) return;
      var row = raw[key];
      if (!row || typeof row !== 'object') return;
      out[text] = { on: !!row.on, by: clipPerson(row.by), rev: revOf(row.rev) };
    });
    return out;
  }

  function reconcileChecks(checked, meta) {
    var list = checked.slice();
    Object.keys(meta).forEach(function (key) {
      var at = list.indexOf(key);
      if (meta[key].on && at === -1) list.push(key);
      if (!meta[key].on && at !== -1) list.splice(at, 1);
    });
    list.forEach(function (key) {
      if (!meta[key]) meta[key] = { on: true, by: '', rev: 0 };
    });
    return list;
  }

  function cleanSkipped(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (id) {
      var text = fold(id);
      if (!text || text.length > 40 || out.indexOf(text) !== -1) return;
      if (out.length >= 80) return;
      out.push(text);
    });
    return out;
  }

  function cleanFlagLog(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      var id = fold(key);
      if (!id || id.length > 40) return;
      var row = raw[key];
      if (!row || typeof row !== 'object') return;
      out[id] = { on: !!row.on, rev: revOf(row.rev) };
    });
    return out;
  }

  function cleanClaims(raw) {
    var out = [];
    var seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var storeId = clip(row.storeId, 40);
      if (!storeId || seen[storeId]) return;
      seen[storeId] = true;
      out.push({ storeId: storeId, by: clipPerson(row.by), on: !!row.on, rev: revOf(row.rev) });
    });
    return out;
  }

  function cleanStaples(raw) {
    var out = [];
    var seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var id = fold(item.id);
      var name = clipName(item.name);
      if (!id || !/^s\d+$/.test(id) || seen[id] || !name) return;
      seen[id] = true;
      if (out.length >= STAPLE_MAX) return;
      var amount = fold(item.amount);
      if (amount.length > AMOUNT_MAX) amount = '';
      out.push({ id: id, name: name, amount: amount, rev: revOf(item.rev), deleted: !!item.deleted });
    });
    return out;
  }

  function shopFromSaved(saved, weekChanged) {
    var staples = cleanStaples(saved && saved.staples);
    if (weekChanged) {
      return { lines: [], checked: [], extraAmounts: {}, checkMeta: {}, skipped: [], claims: [], staples: staples };
    }
    var lines = cleanLines(saved && saved.lines);
    var live = {};
    lines.forEach(function (line) {
      if (!line.deleted) live[lineCheckKey(line.id)] = true;
    });
    var checked = cleanChecked(saved && saved.checked).filter(function (key) {
      return key.indexOf('line:') !== 0 || live[key];
    });
    var checkMeta = cleanCheckMeta(saved && saved.checkMeta);
    checked = reconcileChecks(checked, checkMeta);
    return {
      lines: lines,
      checked: checked,
      extraAmounts: cleanExtraAmounts(saved && saved.extraAmounts),
      checkMeta: checkMeta,
      skipped: cleanSkipped(saved && saved.skipped),
      claims: cleanClaims(saved && saved.claims),
      staples: staples
    };
  }

  function findPlan(planItems, name) {
    var key = nameKey(name);
    var found = null;
    if (!key) return null;
    (planItems || []).forEach(function (item) {
      if (!found && item && nameKey(item.name) === key) found = item;
    });
    return found;
  }

  function findLine(lines, name, storeId) {
    var key = nameKey(name);
    var exact = null;
    var generic = null;
    var first = null;
    (lines || []).forEach(function (line) {
      if (!line || line.deleted) return;
      if (nameKey(line.name) !== key) return;
      if (!first) first = line;
      if (storeId && line.storeId === storeId) exact = line;
      if (!line.storeId && !generic) generic = line;
    });
    if (!storeId) return first;
    return exact || generic || null;
  }

  function findOfferLine(lines, name, storeId) {
    var key = nameKey(name);
    var store = clip(storeId, 40);
    if (!key || !store) return null;
    var found = null;
    (lines || []).forEach(function (line) {
      if (found || !line || line.deleted) return;
      if (line.storeId !== store) return;
      if (nameKey(line.name) !== key) return;
      found = line;
    });
    return found;
  }

  function knownAmounts(plan, extraAmounts) {
    var known = (plan.amounts || []).slice();
    var extras = (extraAmounts && extraAmounts[plan.id]) || [];
    extras.forEach(function (amount) {
      if (known.indexOf(amount) === -1) known.push(amount);
    });
    return known;
  }

  function blankResult(lines, extraAmounts) {
    return { ok: false, lines: lines, extraAmounts: extraAmounts || {} };
  }

  function addManual(lines, planItems, extraAmounts, name, amount) {
    var clean = fold(name);
    var extras = extraAmounts || {};
    if (!clean) return { ok: false, reason: 'empty', lines: lines, extraAmounts: extras };
    if (clean.length > NAME_MAX) return { ok: false, reason: 'long', lines: lines, extraAmounts: extras };
    var qty = fold(amount);
    if (qty.length > AMOUNT_MAX) return { ok: false, reason: 'amount', lines: lines, extraAmounts: extras };

    var plan = findPlan(planItems, clean);
    if (plan) {
      var known = knownAmounts(plan, extras);
      if (!qty || known.indexOf(qty) !== -1) {
        return { ok: true, already: true, lines: lines, extraAmounts: extras, planId: plan.id };
      }
      var nextExtra = {};
      Object.keys(extras).forEach(function (key) { nextExtra[key] = extras[key].slice(); });
      nextExtra[plan.id] = (extras[plan.id] || []).concat([qty]);
      return { ok: true, merged: true, lines: lines, extraAmounts: nextExtra, planId: plan.id };
    }

    var line = findLine(lines, clean, '');
    if (line) {
      if (qty && line.amounts.indexOf(qty) === -1) {
        var merged = (lines || []).map(function (item) {
          if (item.id !== line.id) return item;
          var copy = copyLine(item);
          copy.amounts = copy.amounts.concat([qty]);
          return copy;
        });
        return { ok: true, merged: true, lines: merged, extraAmounts: extras, lineId: line.id };
      }
      return { ok: true, already: true, lines: lines, extraAmounts: extras, lineId: line.id };
    }

    return {
      ok: true,
      created: true,
      lines: lines,
      extraAmounts: extras,
      draft: {
        name: clean,
        amounts: qty ? [qty] : [],
        price: '',
        storeId: '',
        storeName: ''
      }
    };
  }

  function addOffer(lines, planItems, offer) {
    var clean = clipName(offer && offer.name);
    if (!clean) return { ok: false, reason: 'empty', lines: lines };
    var storeId = clip(offer.storeId, 40);
    var listed = findOfferLine(lines, clean, storeId);
    if (listed) {
      var rev = revOf(offer && offer.now);
      var removed = (lines || []).map(function (item) {
        if (!item || item.id !== listed.id) return item;
        var copy = copyLine(item);
        copy.deleted = true;
        if (rev) copy.rev = rev;
        return copy;
      });
      return { ok: true, removed: true, lines: removed, lineId: listed.id };
    }

    var plan = findPlan(planItems, clean);
    if (plan) return { ok: true, already: true, lines: lines, planId: plan.id };

    var line = findLine(lines, clean, storeId);
    if (line) {
      if (!line.storeId && storeId) {
        var enriched = (lines || []).map(function (item) {
          if (item.id !== line.id) return item;
          var copy = copyLine(item);
          copy.storeId = storeId;
          copy.storeName = withoutBranch(clip(offer.storeName, 40));
          if (!copy.price && offer.price) copy.price = clip(offer.price, 32);
          return copy;
        });
        return { ok: true, already: true, enriched: true, lines: enriched, lineId: line.id };
      }
      return { ok: true, already: true, lines: lines, lineId: line.id };
    }

    var amount = fold(offer.amount);
    if (amount.length > AMOUNT_MAX) amount = '';
    return {
      ok: true,
      created: true,
      lines: lines,
      draft: {
        name: clean,
        amounts: amount ? [amount] : [],
        price: clip(offer.price, 32),
        storeId: storeId,
        storeName: withoutBranch(clip(offer.storeName, 40))
      }
    };
  }

  function offerListed(lines, planItems, storeId, name) {
    return !!findOfferLine(lines, name, storeId);
  }

  function toggleChecked(checked, key) {
    var list = (checked || []).slice();
    var at = list.indexOf(key);
    if (at === -1) list.push(key);
    else list.splice(at, 1);
    return list;
  }

  function nextLineId(lines) {
    var n = 0;
    (lines || []).forEach(function (line) {
      var match = /^m(\d+)$/.exec(line.id || '');
      if (match) n = Math.max(n, Number(match[1]));
    });
    return 'm' + (n + 1);
  }

  function nextStapleId(staples) {
    var n = 0;
    (staples || []).forEach(function (item) {
      var match = /^s(\d+)$/.exec(item && item.id || '');
      if (match) n = Math.max(n, Number(match[1]));
    });
    return 's' + (n + 1);
  }

  function aliveLines(lines) {
    return (lines || []).filter(function (line) { return line && !line.deleted; });
  }

  function applyCheck(checked, meta, key, person, now) {
    var list = toggleChecked(checked, key);
    var next = {};
    Object.keys(meta || {}).forEach(function (id) { next[id] = meta[id]; });
    next[key] = { on: list.indexOf(key) !== -1, by: clipPerson(person), rev: revOf(now) };
    return { checked: list, checkMeta: next };
  }

  function toggleSkip(skipped, id) {
    var list = cleanSkipped(skipped);
    var text = fold(id);
    var at = list.indexOf(text);
    if (!text) return list;
    if (at === -1) list.push(text);
    else list.splice(at, 1);
    return list;
  }

  function withoutSkipped(plan, skipped) {
    var skip = {};
    cleanSkipped(skipped).forEach(function (id) { skip[id] = true; });
    var offers = [];
    ((plan && plan.offers) || []).forEach(function (group) {
      var items = (group.items || []).filter(function (item) { return item && !skip[item.id]; });
      if (!items.length) return;
      offers.push({ id: group.id, label: group.label, items: items });
    });
    return {
      offers: offers,
      missing: ((plan && plan.missing) || []).filter(function (item) { return item && !skip[item.id]; })
    };
  }

  function listText(groups) {
    var open = [];
    var cart = [];
    (groups || []).forEach(function (group) {
      var openLines = [];
      var cartLines = [];
      (group.items || []).forEach(function (item) {
        if (!item || !fold(item.name)) return;
        var line = '- ' + fold(item.name);
        var detail = fold(item.detail);
        if (detail) line += ' ' + detail;
        if (item.checked) cartLines.push(line);
        else openLines.push(line);
      });
      if (openLines.length) open.push(fold(group.label) + '\n' + openLines.join('\n'));
      if (cartLines.length) cart.push(fold(group.label) + '\n' + cartLines.join('\n'));
    });
    var parts = [];
    if (open.length) parts.push(open.join('\n\n'));
    if (cart.length) parts.push('Im Wagen\n' + cart.join('\n\n'));
    return parts.join('\n\n');
  }

  function finishTrip(input) {
    var now = revOf(input && input.now);
    var pantryIds = {};
    var nameToPantry = {};
    ((input && input.pantryItems) || []).forEach(function (item) {
      if (!item || !item.id) return;
      pantryIds[item.id] = true;
      nameToPantry[nameKey(item.name)] = item.id;
    });
    var pantry = ((input && input.pantry) || []).slice();
    function addHome(id) {
      if (!id || !pantryIds[id] || pantry.indexOf(id) !== -1) return;
      pantry.push(id);
    }
    var skipped = cleanSkipped(input && input.skipped);
    var checked = ((input && input.checked) || []).slice();
    var bought = 0;
    ((input && input.planItems) || []).forEach(function (item) {
      if (!item || checked.indexOf(planCheckKey(item.id)) === -1) return;
      bought += 1;
      addHome(item.id);
      if (skipped.indexOf(item.id) === -1) skipped.push(item.id);
    });
    var lines = ((input && input.lines) || []).map(function (line) {
      var copy = copyLine(line);
      if (copy.deleted) return copy;
      if (checked.indexOf(lineCheckKey(copy.id)) === -1) return copy;
      bought += 1;
      addHome(nameToPantry[nameKey(copy.name)]);
      copy.deleted = true;
      if (now) copy.rev = now;
      return copy;
    });
    var live = {};
    lines.forEach(function (line) {
      if (!line.deleted) live[lineCheckKey(line.id)] = true;
    });
    var skippedSet = {};
    skipped.forEach(function (id) { skippedSet[id] = true; });
    var nextChecked = checked.filter(function (key) {
      if (key.indexOf('plan:') === 0) return !skippedSet[key.slice(5)];
      return !!live[key];
    });
    return { bought: bought, lines: lines, checked: nextChecked, pantry: pantry, skipped: skipped };
  }

  function setClaim(claims, storeId, person, on, now) {
    var id = clip(storeId, 40);
    var next = cleanClaims(claims).filter(function (row) { return row.storeId !== id; });
    if (!id) return next;
    next.push({ storeId: id, by: clipPerson(person), on: !!on, rev: revOf(now) });
    return next;
  }

  function claimFor(claims, storeId) {
    var id = clip(storeId, 40);
    var found = null;
    cleanClaims(claims).forEach(function (row) {
      if (row.storeId === id && row.on) found = row;
    });
    return found;
  }

  function copyIds(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (id) {
      var text = fold(id);
      if (!text || text.length > 40 || out.indexOf(text) !== -1) return;
      out.push(text);
    });
    return out;
  }

  function copyEvenings(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var day = fold(row.day);
      if (!day || day.length > 8) return;
      out.push({
        day: day,
        recipeId: fold(row.recipeId),
        cook: clipPerson(row.cook),
        rev: revOf(row.rev)
      });
    });
    return out;
  }

  function copyPicked(raw) {
    if (raw == null) return null;
    return copyIds(raw);
  }

  function copyInventory(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var id = fold(row.id);
      var name = fold(row.name);
      if (!id || !name || id.length > 40 || name.length > NAME_MAX) return;
      out.push({
        id: id,
        name: name,
        amount: clip(row.amount, AMOUNT_MAX),
        rev: revOf(row.rev),
        deleted: !!row.deleted
      });
    });
    return out;
  }

  function copyOverrides(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var id = fold(row.id);
      var title = fold(row.title);
      if (!id || !title || id.length > 40 || title.length > NAME_MAX) return;
      var ingredients = [];
      (Array.isArray(row.ingredients) ? row.ingredients : []).forEach(function (item) {
        if (!item || !fold(item.id) || ingredients.length >= 12) return;
        ingredients.push({ id: fold(item.id), amount: clip(item.amount, 40) || '1' });
      });
      var steps = [];
      (Array.isArray(row.steps) ? row.steps : []).forEach(function (step) {
        var text = fold(step);
        if (!text || steps.length >= 8) return;
        steps.push(text);
      });
      var minutes = Math.floor(Number(row.minutes));
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) minutes = 20;
      out.push({
        id: id,
        title: title,
        minutes: minutes,
        steps: steps,
        ingredients: ingredients,
        rev: revOf(row.rev),
        deleted: !!row.deleted
      });
    });
    return out;
  }

  function cloneSnapshot(state) {
    var source = state && typeof state === 'object' ? state : {};
    return {
      lines: cleanLines(source.lines),
      checked: cleanChecked(source.checked),
      checkMeta: cleanCheckMeta(source.checkMeta),
      skipped: cleanSkipped(source.skipped),
      skippedLog: cleanFlagLog(source.skippedLog),
      extraAmounts: cleanExtraAmounts(source.extraAmounts),
      picked: copyPicked(source.picked),
      pickedRev: revOf(source.pickedRev),
      evenings: copyEvenings(source.evenings),
      pantry: copyIds(source.pantry),
      pantryLog: cleanFlagLog(source.pantryLog),
      claims: cleanClaims(source.claims),
      staples: cleanStaples(source.staples),
      inventory: copyInventory(source.inventory),
      overrides: copyOverrides(source.overrides)
    };
  }

  function emptyHistory() {
    return { undo: [], redo: [] };
  }

  function pushHistory(history, snapshot) {
    var past = ((history && history.undo) || []).concat([cloneSnapshot(snapshot)]);
    if (past.length > HISTORY_CAP) past = past.slice(past.length - HISTORY_CAP);
    return { undo: past, redo: [] };
  }

  function undoHistory(history, current) {
    var past = ((history && history.undo) || []).slice();
    var future = ((history && history.redo) || []).slice();
    if (!past.length) return { history: { undo: past, redo: future }, state: null };
    var previous = past.pop();
    future.unshift(cloneSnapshot(current));
    return { history: { undo: past, redo: future }, state: cloneSnapshot(previous) };
  }

  function redoHistory(history, current) {
    var past = ((history && history.undo) || []).slice();
    var future = ((history && history.redo) || []).slice();
    if (!future.length) return { history: { undo: past, redo: future }, state: null };
    var next = future.shift();
    past.push(cloneSnapshot(current));
    if (past.length > HISTORY_CAP) past = past.slice(past.length - HISTORY_CAP);
    return { history: { undo: past, redo: future }, state: cloneSnapshot(next) };
  }

  function tombstoneLines(lines, rev) {
    return cleanLines(lines).map(function (line) {
      if (line.deleted) return line;
      var copy = copyLine(line);
      copy.deleted = true;
      if (rev) copy.rev = rev;
      return copy;
    });
  }

  function clearChecks(checked, meta, rev) {
    var next = cleanCheckMeta(meta);
    Object.keys(next).forEach(function (key) {
      if (!next[key].on) return;
      next[key] = { on: false, by: next[key].by, rev: rev || next[key].rev };
    });
    cleanChecked(checked).forEach(function (key) {
      if (next[key] && !next[key].on) return;
      next[key] = {
        on: false,
        by: (next[key] && next[key].by) || '',
        rev: rev || (next[key] && next[key].rev) || 0
      };
    });
    return next;
  }

  function clearSkippedLog(skipped, log, rev) {
    var next = cleanFlagLog(log);
    function off(id) {
      next[id] = { on: false, rev: rev || (next[id] && next[id].rev) || 0 };
    }
    cleanSkipped(skipped).forEach(off);
    Object.keys(next).forEach(function (id) {
      if (next[id].on) off(id);
    });
    return next;
  }

  function clearEvenings(raw, rev) {
    var byDay = {};
    copyEvenings(raw).forEach(function (row) { byDay[row.day] = row; });
    return WEEK_DAYS.map(function (day) {
      var row = byDay[day];
      return { day: day, recipeId: '', cook: '', rev: rev || revOf(row && row.rev) };
    });
  }

  function clearList(input, now) {
    var source = input && typeof input === 'object' ? input : {};
    var rev = revOf(now);
    return {
      lines: tombstoneLines(source.lines, rev),
      checked: [],
      checkMeta: clearChecks(source.checked, source.checkMeta, rev),
      skipped: [],
      skippedLog: clearSkippedLog(source.skipped, source.skippedLog, rev),
      extraAmounts: {},
      picked: [],
      pickedRev: rev || revOf(source.pickedRev),
      evenings: clearEvenings(source.evenings, rev)
    };
  }

  function addStaple(staples, name, amount, now) {
    var list = cleanStaples(staples);
    var clean = fold(name);
    if (!clean) return { ok: false, reason: 'empty', staples: list };
    if (clean.length > NAME_MAX) return { ok: false, reason: 'long', staples: list };
    var qty = fold(amount);
    if (qty.length > AMOUNT_MAX) return { ok: false, reason: 'amount', staples: list };
    var existing = null;
    list.forEach(function (item) {
      if (!item.deleted && nameKey(item.name) === nameKey(clean)) existing = item;
    });
    if (existing) {
      if (!qty || existing.amount === qty) return { ok: true, already: true, staples: list, id: existing.id };
      var merged = list.map(function (item) {
        if (item.id !== existing.id) return item;
        return { id: item.id, name: item.name, amount: qty, rev: revOf(now) || item.rev, deleted: false };
      });
      return { ok: true, merged: true, staples: merged, id: existing.id };
    }
    return {
      ok: true,
      created: true,
      staples: list,
      draft: { name: clean, amount: qty, rev: revOf(now), deleted: false }
    };
  }

  return {
    NAME_MAX: NAME_MAX,
    AMOUNT_MAX: AMOUNT_MAX,
    PERSON_MAX: PERSON_MAX,
    fold: fold,
    clipName: clipName,
    clipPerson: clipPerson,
    nameKey: nameKey,
    cleanLines: cleanLines,
    cleanChecked: cleanChecked,
    cleanExtraAmounts: cleanExtraAmounts,
    cleanCheckMeta: cleanCheckMeta,
    cleanSkipped: cleanSkipped,
    cleanFlagLog: cleanFlagLog,
    cleanClaims: cleanClaims,
    cleanStaples: cleanStaples,
    shopFromSaved: shopFromSaved,
    addManual: addManual,
    addOffer: addOffer,
    offerListed: offerListed,
    toggleChecked: toggleChecked,
    applyCheck: applyCheck,
    toggleSkip: toggleSkip,
    withoutSkipped: withoutSkipped,
    listText: listText,
    finishTrip: finishTrip,
    setClaim: setClaim,
    claimFor: claimFor,
    addStaple: addStaple,
    aliveLines: aliveLines,
    lineCheckKey: lineCheckKey,
    planCheckKey: planCheckKey,
    nextLineId: nextLineId,
    nextStapleId: nextStapleId,
    HISTORY_CAP: HISTORY_CAP,
    emptyHistory: emptyHistory,
    pushHistory: pushHistory,
    undoHistory: undoHistory,
    redoHistory: redoHistory,
    clearList: clearList
  };
});
