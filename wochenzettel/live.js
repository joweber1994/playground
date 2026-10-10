/* Wochenzettel – liest die laufenden Angebote neu, ohne die Datei von Hand zu ändern.
   Lidl und Penny kann der Browser selbst abrufen. Aldi, dm und Rossmann gehen über
   dieselben öffentlichen Seiten; schlägt das fehl, bleibt der letzte Stand des Markts. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WochenzettelLive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var PLACE = 'lat=47.8534&lng=12.124';
  var PENNY_CATEGORIES = [
    'dauerhaft-im-preis-gesenkt1',
    'drogerie-und-haushalt',
    'drogerie-und-haushalt1',
    'fleisch-und-wurst',
    'food-highlights-fuer-alle',
    'framstag',
    'getraenke',
    'getraenke1',
    'haushalt-und-wohnen',
    'kinderwelt',
    'kochen-und-backen',
    'kuehlregal',
    'naturgut',
    'obst-und-gemuese',
    'obst-und-gemuese1',
    'pflanzen',
    'pflanzen-mo-sa',
    'que-viva-espana',
    'sparen-auf-top-marken',
    'sport-und-freizeit',
    'suessigkeiten-und-snacks',
    'suessigkeiten-und-snacks0',
    'tiernahrung',
    'top-angebote',
    'weitere-angebote'
  ];

  function priceText(value) {
    if (value == null || value === '') return '';
    var text = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(text)) return '';
    var number = Number(text);
    if (!isFinite(number) || number <= 0) return '';
    return number.toFixed(2);
  }

  function aldiPrice(price) {
    if (!price || price.amountRelevant == null) return '';
    return priceText(Number(price.amountRelevant) / 100);
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#160;/g, ' ')
      .replace(/[®™]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clip(value) {
    var text = cleanText(value);
    if (text.length <= 80) return text;
    var cut = text.slice(0, 80);
    var space = cut.lastIndexOf(' ');
    if (space > 40) cut = cut.slice(0, space);
    return cut.trim();
  }

  function joinName(brand, title) {
    var left = cleanText(brand);
    var right = cleanText(title);
    if (!right) return clip(left);
    if (!left) return clip(right);
    if (right.toLowerCase().indexOf(left.toLowerCase()) === 0) return clip(right);
    return clip(left + ' ' + right);
  }

  function dayKey(value) {
    if (!value) return '';
    var text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    var date = new Date(text);
    if (isNaN(date.getTime())) return '';
    try {
      return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    } catch (error) {
      return date.toISOString().slice(0, 10);
    }
  }

  function todayKey(now) {
    return dayKey(now || new Date());
  }

  function coversDay(from, until, day) {
    var start = dayKey(from);
    var end = dayKey(until);
    if (start && day < start) return false;
    if (end && day > end) return false;
    return !!(start || end);
  }

  function weekKey(date) {
    var copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var day = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
    var year = copy.getUTCFullYear();
    return year + '-W' + (week < 10 ? '0' + week : String(week));
  }

  function pennyWeek(date) {
    return weekKey(date).replace('-W', '-');
  }

  function shortRange(from, until) {
    function part(iso) {
      var bits = String(iso || '').split('-');
      if (bits.length < 3) return '';
      return Number(bits[2]) + '.' + Number(bits[1]) + '.';
    }
    var start = dayKey(from);
    var end = dayKey(until);
    if (!start || !end) return '';
    return part(start) + '–' + part(end) + end.slice(0, 4);
  }

  function getJson(fetchImpl, url) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
    var options = { headers: { Accept: 'application/json, text/html;q=0.8' } };
    if (ctrl) options.signal = ctrl.signal;
    return Promise.resolve(fetchImpl(url, options)).then(function (response) {
      if (timer) clearTimeout(timer);
      if (!response || !response.ok) throw new Error('http');
      var type = response.headers && response.headers.get ? response.headers.get('content-type') || '' : '';
      if (type.indexOf('json') !== -1) return response.json();
      return response.text().then(function (text) {
        try { return JSON.parse(text); } catch (error) { return text; }
      });
    }, function (error) {
      if (timer) clearTimeout(timer);
      throw error;
    });
  }

  function lidlFlyers(input) {
    if (Array.isArray(input)) return input;
    var found = [];
    var categories = (input && input.categories) || [];
    categories.forEach(function (category) {
      (category.subcategories || []).forEach(function (sub) {
        (sub.flyers || []).forEach(function (flyer) { found.push(flyer); });
      });
    });
    return found;
  }

  function lidlScore(flyer) {
    var url = String(flyer && flyer.flyerUrlAbsolute || '');
    var score = 0;
    if (url.indexOf('lf=HHZ') !== -1) score += 2;
    if (url.indexOf('/ar/0') !== -1) score += 1;
    return score;
  }

  function pickLidlFlyer(input, day) {
    var best = null;
    lidlFlyers(input).forEach(function (flyer) {
      if (!flyer || flyer.name !== 'Aktionsprospekt') return;
      if (!coversDay(flyer.offerStartDate, flyer.offerEndDate, day)) return;
      if (!best || lidlScore(flyer) > lidlScore(best)) best = flyer;
    });
    return best;
  }

  function lidlFlyerUrl(flyer) {
    var json = flyer && flyer.flyerJson;
    if (typeof json === 'string' && json.indexOf('https://') === 0) return json;
    var page = String(flyer && flyer.flyerUrlAbsolute || '');
    var match = page.match(/\/prospekte\/([^/?#]+)/);
    if (!match) return '';
    return 'https://endpoints.leaflets.schwarz/v4/flyer?version=4&flyer_identifier=' +
      encodeURIComponent(match[1]) + '&client=lidl&region_id=0&region_code=0';
  }

  function lidlOffers(flyer) {
    var products = flyer && flyer.products;
    var offers = [];
    var skipped = 0;
    var list = [];
    if (Array.isArray(products)) list = products;
    else if (products && typeof products === 'object') list = Object.keys(products).map(function (key) { return products[key]; });
    list.forEach(function (product) {
      if (!product) return;
      var price = priceText(product.price);
      var name = joinName(product.brand, product.title || product.name);
      if (!name || !price) {
        skipped += 1;
        return;
      }
      var amount = cleanText(product.description || '');
      if (amount.length > 70 || /material|durchmesser|bodenst/i.test(amount)) amount = '';
      offers.push({ name: name, price: price, amount: amount });
    });
    return { offers: dedupe(offers).slice(0, 800), otherCount: skipped };
  }

  function sourceKey(url) {
    var text = String(url || '');
    var flyer = text.match(/aktionsprospekt-[0-9a-z-]+/i);
    if (flyer) return flyer[0].toLowerCase();
    var uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) return uuid[0].toLowerCase();
    return '';
  }

  function storedRevision(store) {
    if (store && store.revision) return String(store.revision);
    return sourceKey(store && store.source);
  }

  function dedupe(offers) {
    var seen = {};
    var out = [];
    offers.forEach(function (offer) {
      var key = offer.name.toLowerCase() + '|' + offer.price;
      if (seen[key]) return;
      seen[key] = true;
      out.push(offer);
    });
    return out;
  }

  function readLidl(fetchImpl, day) {
    var overviewUrl = 'https://endpoints.leaflets.schwarz/v4/overview?client=lidl&client_locale=' + encodeURIComponent('lidl/de-DE');
    return getJson(fetchImpl, overviewUrl).then(function (overview) {
      var flyer = pickLidlFlyer(overview, day);
      if (!flyer) return { ok: false, id: 'lidl' };
      var url = lidlFlyerUrl(flyer);
      if (!url) return { ok: false, id: 'lidl' };
      return getJson(fetchImpl, url).then(function (payload) {
        var body = payload && payload.flyer ? payload.flyer : payload;
        var parsed = lidlOffers(body);
        if (!parsed.offers.length) return { ok: false, id: 'lidl' };
        var from = dayKey(flyer.offerStartDate);
        var until = dayKey(flyer.offerEndDate);
        var slug = String(flyer.flyerUrlAbsolute || '').match(/\/prospekte\/([^/?#]+)/);
        return {
          ok: true,
          id: 'lidl',
          revision: slug ? slug[1].toLowerCase() : '',
          offers: parsed.offers,
          otherCount: parsed.otherCount,
          source: flyer.flyerUrlAbsolute || url,
          note: 'Aktionsprospekt ' + shortRange(from, until) + ', automatisch gelesen.',
          validFrom: from,
          validUntil: until
        };
      });
    }).catch(function () { return { ok: false, id: 'lidl' }; });
  }

  function pennyCategoriesFromHtml(html) {
    var found = [];
    var re = /data-category-id="([^"]+)"\s+data-week="current"/g;
    var match;
    while ((match = re.exec(String(html || '')))) {
      var slug = match[1].split('--').pop();
      if (slug && found.indexOf(slug) === -1) found.push(slug);
    }
    return found;
  }

  function pennyOffer(tile) {
    var price = priceText(tile && tile.price);
    var name = clip(tile && tile.title);
    if (!name || !price) return null;
    var amount = cleanText(tile.quantity || '');
    var benefit = priceText(tile.benefitPrice);
    if (benefit && benefit !== price) {
      amount = amount ? amount + ', mit App ' + benefit.replace('.', ',') + ' €' : 'mit App ' + benefit.replace('.', ',') + ' €';
    }
    return { name: name, price: price, amount: amount, food: tile.type === 'food' };
  }

  function readPenny(fetchImpl, now) {
    var week = pennyWeek(now);
    return getJson(fetchImpl, 'https://www.penny.de/angebote').then(function (html) {
      var fromHtml = typeof html === 'string' ? pennyCategoriesFromHtml(html) : [];
      return fromHtml.length ? fromHtml : PENNY_CATEGORIES.slice();
    }, function () {
      return PENNY_CATEGORIES.slice();
    }).then(function (categories) {
      return Promise.all(categories.map(function (slug) {
        var url = 'https://www.penny.de/.rest/offers/by-category/' + week + '/' + encodeURIComponent(slug);
        return getJson(fetchImpl, url).then(function (data) {
          return (data && data.offerTiles) || [];
        }, function () { return []; });
      })).then(function (groups) {
        var food = [];
        var rest = [];
        groups.forEach(function (tiles) {
          tiles.forEach(function (tile) {
            var offer = pennyOffer(tile);
            if (!offer) return;
            (offer.food ? food : rest).push({ name: offer.name, price: offer.price, amount: offer.amount });
          });
        });
        var offers = dedupe(food.concat(rest)).slice(0, 800);
        if (!offers.length) return { ok: false, id: 'penny' };
        return {
          ok: true,
          id: 'penny',
          revision: 'penny-' + week,
          offers: offers,
          otherCount: 0,
          source: 'https://www.penny.de/angebote',
          note: 'Angebote der Woche ' + week + ', automatisch gelesen.',
          validFrom: '',
          validUntil: ''
        };
      });
    }).catch(function () { return { ok: false, id: 'penny' }; });
  }

  function readAldi(fetchImpl, now) {
    var offers = [];
    function page(offset, total) {
      if (offset > 480 || (total != null && offset >= total)) {
        return Promise.resolve(offers);
      }
      var url = 'https://api.aldi-sued.de/v3/product-search?categoryTree=1588161426582123&limit=60&offset=' + offset;
      return getJson(fetchImpl, url).then(function (data) {
        var rows = (data && data.data) || [];
        var count = data && data.meta && data.meta.pagination ? data.meta.pagination.totalCount : rows.length;
        rows.forEach(function (item) {
          var price = aldiPrice(item.price);
          var name = joinName(item.brandName, item.name);
          if (!name || !price) return;
          var amount = '';
          if (item.price && item.price.perUnitDisplay) amount = cleanText(item.price.perUnitDisplay);
          offers.push({ name: name, price: price, amount: amount });
        });
        if (!rows.length) return offers;
        return page(offset + 60, count);
      });
    }
    return page(0, null).then(function (list) {
      var unique = dedupe(list).slice(0, 800);
      if (!unique.length) return { ok: false, id: 'aldi' };
      return {
        ok: true,
        id: 'aldi',
        revision: 'aldi-' + weekKey(now || new Date()).replace('-W', '-'),
        offers: unique,
        otherCount: 0,
        source: 'https://www.aldi-sued.de/produkte/wochenangebote/k/1588161426582123',
        note: 'Wochenangebote, automatisch gelesen.',
        validFrom: '',
        validUntil: ''
      };
    }).catch(function () { return { ok: false, id: 'aldi' }; });
  }

  function publisherName(publisher) {
    if (!publisher) return '';
    if (typeof publisher === 'string') return publisher;
    return publisher.name || publisher.displayName || publisher.title || '';
  }

  function brochuresFromHtml(html) {
    var text = String(html || '');
    var at = text.indexOf('__NEXT_DATA__');
    if (at < 0) return [];
    var start = text.indexOf('>', at);
    var end = text.indexOf('</script>', start);
    if (start < 0 || end < 0) return [];
    var data;
    try { data = JSON.parse(text.slice(start + 1, end)); } catch (error) { return []; }
    var found = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.publisher && (node.id || node.contentId) && (node.validFrom || node.validUntil || node.title)) {
        var id = String(node.id || node.contentId);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          found.push({
            id: id,
            title: cleanText(node.title || node.name || ''),
            publisher: publisherName(node.publisher),
            validFrom: node.validFrom || '',
            validUntil: node.validUntil || '',
            type: node.type || ''
          });
        }
      }
      if (Array.isArray(node)) node.forEach(walk);
      else Object.keys(node).forEach(function (key) { walk(node[key]); });
    }
    walk(data);
    return found;
  }

  function bonialAmount(node) {
    var desc = node && node.description;
    var para = '';
    if (typeof desc === 'string') para = desc;
    else if (Array.isArray(desc) && desc[0]) para = desc[0].paragraph || desc[0].text || '';
    para = cleanText(para);
    var count = para.match(/^(\d+)\s*ct$/i);
    if (count) return Number(count[1]) > 1 ? count[1] + ' Stück' : '';
    if (para.length > 70) return '';
    return para;
  }

  function dealPrice(deals) {
    var list = deals || [];
    for (var i = 0; i < list.length; i += 1) {
      var deal = list[i] || {};
      var type = String(deal.type || '');
      if (type === 'OTHER' || type === 'PERCENTAGE') continue;
      var price = priceText(deal.min != null ? deal.min : deal.max);
      if (price) return price;
    }
    return '';
  }

  function walkBonial(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.deals) && Array.isArray(node.products) && node.products[0]) {
      var product = node.products[0];
      var price = dealPrice(node.deals);
      var name = joinName(product.brandName || product.brand, product.name || node.name);
      if (name && price) out.push({ name: name, price: price, amount: bonialAmount(node) });
    }
    if (Array.isArray(node)) {
      node.forEach(function (item) { walkBonial(item, out); });
      return;
    }
    Object.keys(node).forEach(function (key) { walkBonial(node[key], out); });
  }

  function bonialUrl(id, tail) {
    return 'https://content-viewer-be.meinprospekt.de/v1/brochures/' + id + tail +
      (tail.indexOf('?') === -1 ? '?' : '&') + 'partner=meinprospekt_web&brochureKey=&' + PLACE;
  }

  function readBonialBrochure(fetchImpl, brochure) {
    function sections(index, collected) {
      if (index >= 8) return Promise.resolve(collected);
      return getJson(fetchImpl, bonialUrl(brochure.id, '/section/' + index + '?')).then(function (data) {
        var found = [];
        walkBonial(data, found);
        return sections(index + 1, collected.concat(found));
      }, function () {
        return collected;
      });
    }
    return sections(0, []).then(function (offers) {
      if (offers.length) return offers;
      return getJson(fetchImpl, bonialUrl(brochure.id, '/pages?')).then(function (data) {
        var found = [];
        walkBonial(data, found);
        return found;
      }, function () { return []; });
    });
  }

  function readChain(fetchImpl, day, id, query, publisherTest) {
    var url = 'https://www.meinprospekt.de/search?query=' + encodeURIComponent(query);
    return getJson(fetchImpl, url).then(function (html) {
      if (typeof html !== 'string') return { ok: false, id: id };
      var brochures = brochuresFromHtml(html).filter(function (brochure) {
        if (!publisherTest(brochure.publisher || '')) return false;
        if (/advent/i.test(brochure.title || '')) return false;
        return coversDay(brochure.validFrom, brochure.validUntil, day);
      });
      var seen = {};
      brochures = brochures.filter(function (brochure) {
        if (seen[brochure.id]) return false;
        seen[brochure.id] = true;
        return true;
      });
      if (!brochures.length) return { ok: false, id: id };
      return Promise.all(brochures.map(function (brochure) {
        return readBonialBrochure(fetchImpl, brochure);
      })).then(function (groups) {
        var offers = dedupe([].concat.apply([], groups)).filter(function (offer) {
          return !/adventskalender/i.test(offer.name);
        }).slice(0, 800);
        if (!offers.length) return { ok: false, id: id };
        var from = brochures.map(function (item) { return dayKey(item.validFrom); }).filter(Boolean).sort()[0] || '';
        var until = brochures.map(function (item) { return dayKey(item.validUntil); }).filter(Boolean).sort().pop() || '';
        return {
          ok: true,
          id: id,
          revision: brochures.map(function (item) { return item.id; }).sort().join(','),
          offers: offers,
          otherCount: 0,
          source: 'https://www.meinprospekt.de/contentViewer/dynamic/' + brochures[0].id,
          note: (brochures[0].title || 'Angebote') + ' ' + shortRange(from, until) + ', automatisch gelesen.',
          validFrom: from,
          validUntil: until
        };
      });
    }).catch(function () { return { ok: false, id: id }; });
  }

  function readDm(fetchImpl, day) {
    return readChain(fetchImpl, day, 'dm', 'dm-drogerie markt', function (name) {
      return /dm/i.test(name) && /drogerie/i.test(name);
    });
  }

  function readRossmann(fetchImpl, day) {
    return readChain(fetchImpl, day, 'rossmann', 'rossmann', function (name) {
      return /rossmann/i.test(name);
    });
  }

  function applyReads(base, reads, now) {
    var next = JSON.parse(JSON.stringify(base));
    var changed = false;
    var groceryFrom = [];
    var groceryUntil = [];
    (reads || []).forEach(function (result) {
      if (!result || !result.ok || !result.offers || !result.offers.length) return;
      var store = null;
      (next.stores || []).forEach(function (item) {
        if (item.id === result.id) store = item;
      });
      if (!store) return;
      if (store.offers.length >= 8 && result.offers.length < 8) return;
      if (result.revision && storedRevision(store) === result.revision && store.offers.length >= result.offers.length) return;
      var before = JSON.stringify(store.offers) + '|' + store.note + '|' + store.source;
      store.offers = result.offers;
      store.note = result.note || store.note;
      store.source = result.source || store.source;
      store.otherCount = result.otherCount || 0;
      if (result.revision) store.revision = result.revision;
      if (JSON.stringify(store.offers) + '|' + store.note + '|' + store.source !== before) changed = true;
      if (result.id === 'lidl' || result.id === 'penny' || result.id === 'aldi' || result.id === 'prechtl') {
        if (result.validFrom) groceryFrom.push(result.validFrom);
        if (result.validUntil) groceryUntil.push(result.validUntil);
      }
    });
    if (changed) {
      next.extractedAt = todayKey(now);
      next.weekKey = weekKey(now);
      if (groceryFrom.length) next.validFrom = groceryFrom.sort()[0];
      if (groceryUntil.length) next.validUntil = groceryUntil.sort().pop();
    }
    return { catalog: next, changed: changed };
  }

  function refresh(base, fetchImpl, now) {
    var date = now || new Date();
    var day = todayKey(date);
    var impl = fetchImpl || root.fetch;
    return Promise.all([
      readLidl(impl, day),
      readPenny(impl, date),
      readAldi(impl, date),
      readDm(impl, day),
      readRossmann(impl, day)
    ]).then(function (reads) {
      return applyReads(base, reads, date);
    });
  }

  return {
    priceText: priceText,
    aldiPrice: aldiPrice,
    pennyWeek: pennyWeek,
    weekKey: weekKey,
    coversDay: coversDay,
    pickLidlFlyer: pickLidlFlyer,
    pennyCategoriesFromHtml: pennyCategoriesFromHtml,
    brochuresFromHtml: brochuresFromHtml,
    applyReads: applyReads,
    refresh: refresh
  };
});
