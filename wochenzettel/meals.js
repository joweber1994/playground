/* Wochenzettel – Zutaten und Vorschläge.
   Reine Funktionen, ohne DOM. Im Browser als WochenzettelMeals, unter Node als Modul. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WochenzettelMeals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var PROSPEKT_URL = 'https://www.prechtl.de/aktuelles/';
  var PORTIONS = 2;

  var GROUPS = [
    { id: 'fleisch', label: 'Fleisch' },
    { id: 'fisch', label: 'Fisch' },
    { id: 'kuehl', label: 'Kühlregal' },
    { id: 'gemuese', label: 'Gemüse und Obst' },
    { id: 'vorrat', label: 'Vorrat' }
  ];

  var INGREDIENTS = [
    { id: 'hackfleisch', name: 'Hackfleisch', group: 'fleisch', offer: true, aliases: ['hack', 'rinderhack'] },
    { id: 'haehnchen', name: 'Hähnchen', group: 'fleisch', offer: true, aliases: ['haehnchen', 'huhn', 'hähnchenbrust'] },
    { id: 'pute', name: 'Pute', group: 'fleisch', offer: true, aliases: ['putenbrust', 'putengeschnetzeltes'] },
    { id: 'schnitzel', name: 'Schnitzel', group: 'fleisch', offer: true, aliases: ['schweineschnitzel'] },
    { id: 'gulasch', name: 'Gulasch', group: 'fleisch', offer: true, aliases: ['gulaschfleisch'] },
    { id: 'gyros', name: 'Gyros', group: 'fleisch', offer: true, aliases: [] },
    { id: 'bratwurst', name: 'Bratwurst', group: 'fleisch', offer: true, aliases: ['würstchen'] },
    { id: 'speck', name: 'Speck', group: 'fleisch', offer: true, aliases: ['bauchspeck'] },
    { id: 'schinken', name: 'Schinken', group: 'fleisch', offer: true, aliases: ['kochschinken'] },
    { id: 'lachs', name: 'Lachs', group: 'fisch', offer: true, aliases: ['lachsfilet'] },
    { id: 'fisch', name: 'Fischfilet', group: 'fisch', offer: true, aliases: ['fischstäbchen', 'seelachs'] },
    { id: 'thunfisch', name: 'Thunfisch', group: 'fisch', offer: true, aliases: ['tunfisch'] },
    { id: 'eier', name: 'Eier', group: 'kuehl', offer: true, pantry: true, pantryDefault: true, aliases: ['ei'] },
    { id: 'kaese', name: 'Käse', group: 'kuehl', offer: true, aliases: ['gouda', 'emmentaler', 'mozzarella'] },
    { id: 'milch', name: 'Milch', group: 'kuehl', offer: true, pantry: true, pantryDefault: false, aliases: [] },
    { id: 'sahne', name: 'Sahne', group: 'kuehl', offer: true, aliases: ['schlagsahne', 'sahne'] },
    { id: 'schmand', name: 'Schmand', group: 'kuehl', offer: true, aliases: ['schmand', 'saure sahne'] },
    { id: 'joghurt', name: 'Joghurt', group: 'kuehl', offer: true, aliases: [] },
    { id: 'butter', name: 'Butter', group: 'kuehl', offer: true, pantry: true, pantryDefault: false, aliases: [] },
    { id: 'paprika', name: 'Paprika', group: 'gemuese', offer: true, aliases: [] },
    { id: 'zucchini', name: 'Zucchini', group: 'gemuese', offer: true, aliases: [] },
    { id: 'brokkoli', name: 'Brokkoli', group: 'gemuese', offer: true, aliases: ['broccoli'] },
    { id: 'champignons', name: 'Champignons', group: 'gemuese', offer: true, aliases: ['pilze'] },
    { id: 'spinat', name: 'Spinat', group: 'gemuese', offer: true, aliases: ['blattspinat'] },
    { id: 'karotte', name: 'Karotten', group: 'gemuese', offer: true, aliases: ['möhren', 'karotte'] },
    { id: 'kartoffeln', name: 'Kartoffeln', group: 'gemuese', offer: true, aliases: ['kartoffel', 'erdäpfel'] },
    { id: 'lauch', name: 'Lauch', group: 'gemuese', offer: true, aliases: ['porree'] },
    { id: 'salat', name: 'Salat', group: 'gemuese', offer: true, aliases: ['kopfsalat', 'feldsalat'] },
    { id: 'gurke', name: 'Gurke', group: 'gemuese', offer: true, aliases: ['gurken'] },
    { id: 'aepfel', name: 'Äpfel', group: 'gemuese', offer: true, aliases: ['äpfel', 'apfel'] },
    { id: 'zwiebel', name: 'Zwiebeln', group: 'gemuese', offer: true, pantry: true, pantryDefault: true, aliases: ['zwiebel'] },
    { id: 'nudeln', name: 'Nudeln', group: 'vorrat', offer: true, pantry: true, pantryDefault: true, aliases: ['pasta', 'spaghetti', 'penne'] },
    { id: 'reis', name: 'Reis', group: 'vorrat', offer: true, pantry: true, pantryDefault: true, aliases: [] },
    { id: 'spaetzle', name: 'Spätzle', group: 'vorrat', offer: true, aliases: ['spaetzle'] },
    { id: 'passata', name: 'Passierte Tomaten', group: 'vorrat', offer: true, aliases: ['passata', 'passierte', 'passiert', 'tomatensauce', 'mutti'] },
    { id: 'bohnen', name: 'Bohnen', group: 'vorrat', offer: true, aliases: ['kidneybohnen', 'bohnen'] },
    { id: 'linsen', name: 'Linsen', group: 'vorrat', offer: true, pantry: true, pantryDefault: false, aliases: [] },
    { id: 'mais', name: 'Mais', group: 'vorrat', offer: true, aliases: [] },
    { id: 'sauerkraut', name: 'Sauerkraut', group: 'vorrat', offer: true, aliases: [] },
    { id: 'knoblauch', name: 'Knoblauch', group: 'gemuese', offer: false, pantry: true, pantryDefault: true, aliases: [] },
    { id: 'oel', name: 'Öl', group: 'vorrat', offer: false, pantry: true, pantryDefault: true, aliases: ['öl', 'olivenöl'] },
    { id: 'salz', name: 'Salz', group: 'vorrat', offer: false, pantry: true, pantryDefault: true, aliases: [] },
    { id: 'pfeffer', name: 'Pfeffer', group: 'vorrat', offer: false, pantry: true, pantryDefault: true, aliases: [] },
    { id: 'mehl', name: 'Mehl', group: 'vorrat', offer: false, pantry: true, pantryDefault: true, aliases: [] },
    { id: 'bruehe', name: 'Brühe', group: 'vorrat', offer: false, pantry: true, pantryDefault: true, aliases: ['brühe', 'gemüsebrühe'] },
    { id: 'zucker', name: 'Zucker', group: 'vorrat', offer: false, pantry: true, pantryDefault: true, aliases: [] }
  ];

  function ing(id, amount) {
    return { id: id, amount: amount };
  }

  var RECIPES = [
    {
      id: 'hackpfanne',
      title: 'Hackpfanne mit Paprika',
      minutes: 30,
      steps: [
        'Zwiebeln anbraten, Hackfleisch dazu und krümelig braten.',
        'Paprika zugeben und mit Brühe kurz schmoren.',
        'Mit Reis oder den Beilagen servieren. Für zwei Personen.'
      ],
      ingredients: [ing('hackfleisch', '400 g'), ing('paprika', '2'), ing('zwiebel', '1'), ing('reis', '200 g'), ing('oel', '1 EL'), ing('bruehe', '100 ml')]
    },
    {
      id: 'bolognese',
      title: 'Spaghetti Bolognese',
      minutes: 40,
      steps: [
        'Zwiebeln und Karotten würfeln und mit dem Hackfleisch anbraten.',
        'Passierte Tomaten angießen und 20 Minuten leise köcheln.',
        'Spaghetti dazu. Reicht für zwei.'
      ],
      ingredients: [ing('hackfleisch', '400 g'), ing('nudeln', '200 g'), ing('passata', '1 Packung'), ing('zwiebel', '1'), ing('karotte', '2'), ing('oel', '1 EL')]
    },
    {
      id: 'frikadellen',
      title: 'Frikadellen mit Salat',
      minutes: 30,
      steps: [
        'Hackfleisch mit Zwiebel, Salz und Pfeffer vermengen und flache Taler formen.',
        'In Öl von beiden Seiten braun braten.',
        'Salat waschen und dazu essen.'
      ],
      ingredients: [ing('hackfleisch', '400 g'), ing('zwiebel', '1'), ing('salat', '1'), ing('oel', '2 EL'), ing('salz', '1 Prise'), ing('pfeffer', '1 Prise')]
    },
    {
      id: 'paprika-gefuellt',
      title: 'Gefüllte Paprika',
      minutes: 45,
      steps: [
        'Paprika aushöhlen. Hackfleisch mit Reis und Zwiebel füllen.',
        'In eine Form setzen, passierte Tomaten angießen.',
        'Mit Käse belegen und im Ofen garen.'
      ],
      ingredients: [ing('paprika', '4'), ing('hackfleisch', '300 g'), ing('reis', '100 g'), ing('passata', '1 Packung'), ing('kaese', '80 g'), ing('zwiebel', '1')]
    },
    {
      id: 'haehnchen-brokkoli',
      title: 'Hähnchen mit Brokkoli',
      minutes: 30,
      steps: [
        'Hähnchen in Streifen schneiden und anbraten.',
        'Brokkoli dazu und mit etwas Brühe gar ziehen lassen.',
        'Reis separat kochen. Für zwei Teller.'
      ],
      ingredients: [ing('haehnchen', '400 g'), ing('brokkoli', '1'), ing('reis', '200 g'), ing('bruehe', '100 ml'), ing('oel', '1 EL'), ing('knoblauch', '1 Zehe')]
    },
    {
      id: 'putenrahm',
      title: 'Putengeschnetzeltes',
      minutes: 30,
      steps: [
        'Pute in Streifen anbraten, Champignons und Zwiebel dazu.',
        'Mit Sahne ablöschen und kurz einkochen.',
        'Mit Reis servieren.'
      ],
      ingredients: [ing('pute', '400 g'), ing('champignons', '200 g'), ing('sahne', '200 ml'), ing('zwiebel', '1'), ing('reis', '200 g'), ing('oel', '1 EL')]
    },
    {
      id: 'schnitzel',
      title: 'Schnitzel mit Kartoffeln',
      minutes: 35,
      steps: [
        'Kartoffeln kochen.',
        'Schnitzel salzen, pfeffern und in Öl goldbraun braten.',
        'Zusammen anrichten.'
      ],
      ingredients: [ing('schnitzel', '2'), ing('kartoffeln', '600 g'), ing('oel', '3 EL'), ing('salz', '1 Prise'), ing('pfeffer', '1 Prise')]
    },
    {
      id: 'gulasch',
      title: 'Gulasch mit Nudeln',
      minutes: 45,
      steps: [
        'Zwiebeln anbraten, Gulasch dazu und scharf anrösten.',
        'Mit Brühe ablöschen und weich schmoren.',
        'Nudeln dazu. Für zwei Teller.'
      ],
      ingredients: [ing('gulasch', '500 g'), ing('nudeln', '200 g'), ing('zwiebel', '1'), ing('paprika', '1'), ing('bruehe', '200 ml')]
    },
    {
      id: 'gyros',
      title: 'Gyros mit Tzatziki',
      minutes: 25,
      steps: [
        'Gyros mit Paprika und Zwiebel in der Pfanne braten.',
        'Joghurt mit geriebener Gurke und Knoblauch verrühren.',
        'Beides zusammen essen. Für zwei.'
      ],
      ingredients: [ing('gyros', '400 g'), ing('paprika', '1'), ing('zwiebel', '1'), ing('joghurt', '250 g'), ing('gurke', '1/2'), ing('knoblauch', '1 Zehe')]
    },
    {
      id: 'bratwurst',
      title: 'Bratwurst mit Sauerkraut',
      minutes: 30,
      steps: [
        'Bratwürste anbraten.',
        'Sauerkraut erwärmen, Kartoffeln dazu kochen oder braten.',
        'Zusammen servieren.'
      ],
      ingredients: [ing('bratwurst', '4'), ing('sauerkraut', '1 Glas'), ing('kartoffeln', '500 g'), ing('oel', '1 EL')]
    },
    {
      id: 'lachs',
      title: 'Lachs mit Kartoffeln',
      minutes: 30,
      steps: [
        'Kartoffeln in Scheiben teilen und mit Öl im Ofen rösten.',
        'Lachs salzen und die letzten zehn Minuten dazulegen.',
        'Für zwei Personen.'
      ],
      ingredients: [ing('lachs', '2 Filets'), ing('kartoffeln', '600 g'), ing('oel', '1 EL'), ing('salz', '1 Prise')]
    },
    {
      id: 'fisch-pueree',
      title: 'Fischfilet mit Kartoffelpüree',
      minutes: 35,
      steps: [
        'Kartoffeln kochen, mit Milch und Butter stampfen.',
        'Fischfilet in der Pfanne garen.',
        'Püree und Fisch zusammen anrichten.'
      ],
      ingredients: [ing('fisch', '2'), ing('kartoffeln', '600 g'), ing('milch', '80 ml'), ing('butter', '20 g'), ing('salz', '1 Prise')]
    },
    {
      id: 'thunfischpasta',
      title: 'Thunfischpasta',
      minutes: 20,
      steps: [
        'Nudeln kochen.',
        'Thunfisch mit passierten Tomaten kurz erwärmen.',
        'Unter die Nudeln heben.'
      ],
      ingredients: [ing('thunfisch', '1 Dose'), ing('nudeln', '200 g'), ing('passata', '1/2 Packung'), ing('zwiebel', '1'), ing('oel', '1 EL')]
    },
    {
      id: 'kaesespaetzle',
      title: 'Käsespätzle',
      minutes: 25,
      steps: [
        'Spätzle nach Packung garen.',
        'Zwiebeln goldbraun braten.',
        'Spätzle mit Käse schichten und mit den Zwiebeln servieren.'
      ],
      ingredients: [ing('spaetzle', '500 g'), ing('kaese', '150 g'), ing('zwiebel', '2'), ing('butter', '20 g')]
    },
    {
      id: 'flammkuchen',
      title: 'Flammkuchen',
      minutes: 25,
      steps: [
        'Boden mit Schmand bestreichen.',
        'Speck und Zwiebelringe darauf verteilen.',
        'Im heißen Ofen knusprig backen. Für zwei als Hauptgericht.'
      ],
      ingredients: [ing('schmand', '200 g'), ing('speck', '100 g'), ing('zwiebel', '2')]
    },
    {
      id: 'gratin',
      title: 'Kartoffelgratin',
      minutes: 50,
      steps: [
        'Kartoffeln in feine Scheiben schneiden.',
        'Mit Sahne, Salz und Käse in eine Form schichten.',
        'Im Ofen goldbraun backen.'
      ],
      ingredients: [ing('kartoffeln', '700 g'), ing('sahne', '300 ml'), ing('kaese', '80 g'), ing('knoblauch', '1 Zehe'), ing('salz', '1 Prise')]
    },
    {
      id: 'gemuesepfanne',
      title: 'Gemüsepfanne mit Reis',
      minutes: 25,
      steps: [
        'Reis kochen.',
        'Paprika und Zucchini mit Zwiebel und Knoblauch anbraten.',
        'Zum Reis geben.'
      ],
      ingredients: [ing('paprika', '2'), ing('zucchini', '1'), ing('reis', '200 g'), ing('zwiebel', '1'), ing('knoblauch', '1 Zehe'), ing('oel', '1 EL')]
    },
    {
      id: 'linsensuppe',
      title: 'Linsensuppe',
      minutes: 40,
      steps: [
        'Zwiebel, Karotten und Kartoffeln würfeln.',
        'Mit Linsen und Brühe weich kochen.',
        'Zwei tiefe Teller.'
      ],
      ingredients: [ing('linsen', '200 g'), ing('karotte', '2'), ing('kartoffeln', '300 g'), ing('zwiebel', '1'), ing('bruehe', '800 ml')]
    },
    {
      id: 'lauchsuppe',
      title: 'Kartoffel-Lauch-Suppe',
      minutes: 35,
      steps: [
        'Lauch und Kartoffeln in Brühe weich kochen.',
        'Fein pürieren und mit einem Schuss Sahne verfeinern.',
        'Für zwei Teller.'
      ],
      ingredients: [ing('lauch', '2 Stangen'), ing('kartoffeln', '400 g'), ing('bruehe', '700 ml'), ing('sahne', '100 ml')]
    },
    {
      id: 'spinat-eier',
      title: 'Spinat mit Eiern',
      minutes: 20,
      steps: [
        'Spinat mit Knoblauch in der Pfanne zusammenfallen lassen.',
        'Eier darüber stocken oder als Rührei darunter ziehen.',
        'Mit Salz und Pfeffer. Für zwei.'
      ],
      ingredients: [ing('spinat', '400 g'), ing('eier', '4'), ing('knoblauch', '1 Zehe'), ing('oel', '1 EL'), ing('salz', '1 Prise'), ing('pfeffer', '1 Prise')]
    },
    {
      id: 'apfelpfannkuchen',
      title: 'Apfelpfannkuchen',
      minutes: 25,
      steps: [
        'Mehl, Milch, Eier und eine Prise Zucker zu einem Teig rühren.',
        'Apfelscheiben im Teig in der Pfanne goldbraun backen.',
        'Zwei Portionen.'
      ],
      ingredients: [ing('aepfel', '2'), ing('eier', '2'), ing('milch', '200 ml'), ing('mehl', '100 g'), ing('zucker', '1 EL'), ing('butter', '20 g')]
    },
    {
      id: 'nudelauflauf',
      title: 'Nudelauflauf mit Schinken',
      minutes: 40,
      steps: [
        'Nudeln knapp gar kochen.',
        'Mit Schinken, Sahne und Käse mischen.',
        'Im Ofen überbacken.'
      ],
      ingredients: [ing('nudeln', '200 g'), ing('schinken', '100 g'), ing('sahne', '200 ml'), ing('kaese', '100 g')]
    },
    {
      id: 'chili',
      title: 'Chili mit Bohnen',
      minutes: 35,
      steps: [
        'Hackfleisch mit Zwiebel und Paprika anbraten.',
        'Bohnen, Mais und passierte Tomaten dazu und köcheln.',
        'Für zwei, am nächsten Tag noch besser.'
      ],
      ingredients: [ing('hackfleisch', '300 g'), ing('bohnen', '1 Dose'), ing('mais', '1 Dose'), ing('passata', '1 Packung'), ing('paprika', '1'), ing('zwiebel', '1')]
    }
  ];

  var byId = {};
  INGREDIENTS.forEach(function (item) { byId[item.id] = item; });

  function ingredient(id) {
    return byId[id] || null;
  }

  function offerIngredients() {
    return INGREDIENTS.filter(function (item) { return item.offer; });
  }

  function pantryIngredients() {
    return INGREDIENTS.filter(function (item) { return item.pantry; });
  }

  function defaultPantry() {
    return pantryIngredients().filter(function (item) { return item.pantryDefault; }).map(function (item) { return item.id; });
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

  function knownIds(ids, allowed) {
    var set = {};
    allowed.forEach(function (id) { set[id] = true; });
    var out = [];
    (ids || []).forEach(function (id) {
      if (set[id] && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  function freshState(now) {
    return {
      weekKey: weekKey(now || new Date()),
      offers: [],
      pantry: defaultPantry(),
      picked: null
    };
  }

  function normalizeState(saved, now) {
    var blank = freshState(now || new Date());
    if (!saved || typeof saved !== 'object') return { state: blank, weekChanged: false };
    var sameWeek = saved.weekKey === blank.weekKey;
    var offerIds = offerIngredients().map(function (item) { return item.id; });
    var pantryIds = pantryIngredients().map(function (item) { return item.id; });
    var recipeIds = RECIPES.map(function (item) { return item.id; });
    return {
      weekChanged: !!saved.weekKey && !sameWeek,
      state: {
        weekKey: blank.weekKey,
        offers: sameWeek ? knownIds(saved.offers, offerIds) : [],
        pantry: Array.isArray(saved.pantry) ? knownIds(saved.pantry, pantryIds) : blank.pantry,
        picked: sameWeek && Array.isArray(saved.picked) ? knownIds(saved.picked, recipeIds) : null
      }
    };
  }

  function tokens(text) {
    return String(text || '').toLowerCase().split(/[^a-zäöüß]+/).filter(function (part) { return part.length > 0; });
  }

  function termHits(token, term) {
    var needle = String(term || '').toLowerCase();
    if (!needle || !token) return false;
    if (token === needle) return true;
    if (needle.length < 4 || token.length < 4) return false;
    if (token === 'lachse' && needle === 'lachs') return false;
    if (token === 'preis' && needle === 'reis') return false;
    if (token === 'leberkäse' && needle === 'käse') return false;
    if (token.indexOf(needle) === 0) {
      var rest = token.slice(needle.length);
      var blocked = { 'sauce': 1, 'saucen': 1, 'saft': 1, 'schorle': 1, 'mix': 1, 'joghurt': 1, 'kuchen': 1, 'nudeln': 1, 'nudel': 1, 'suppe': 1, 'fladen': 1 };
      if (rest && blocked[rest]) return false;
      return true;
    }
    if (needle.indexOf(token) === 0 && needle.length - token.length <= 2) return true;
    var suffix = { 'käse': 1, 'milch': 1, 'wurst': 1, 'speck': 1, 'schinken': 1, 'fleisch': 1, 'brot': 1, 'sahne': 1, 'butter': 1, 'schnitzel': 1, 'joghurt': 1, 'reis': 1 };
    if (suffix[needle] && token.length > needle.length && token.lastIndexOf(needle) === token.length - needle.length) return true;
    return false;
  }

  function idsFromOffers(offers) {
    var found = [];
    (offers || []).forEach(function (offer) {
      var text = offer && typeof offer === 'object' ? offer.name : offer;
      matchOfferText(text).forEach(function (id) {
        if (found.indexOf(id) === -1) found.push(id);
      });
    });
    return found;
  }

  function matchNames(text, items) {
    var words = tokens(text);
    var found = [];
    items.forEach(function (item) {
      var terms = [item.name].concat(item.aliases || []);
      var hit = words.some(function (word) {
        return terms.some(function (term) { return termHits(word, term); });
      });
      if (hit) found.push(item.id);
    });
    if (found.indexOf('reis') !== -1 && words.indexOf('schoko') !== -1) {
      found = found.filter(function (id) { return id !== 'reis'; });
    }
    if (found.indexOf('salat') !== -1 && words.indexOf('mit') !== -1) {
      found = found.filter(function (id) { return id !== 'salat'; });
    }
    return found;
  }

  function matchOfferText(text) {
    return matchNames(text, offerIngredients());
  }

  function matchStockText(text) {
    return matchNames(text, INGREDIENTS);
  }

  var OFFER_CATEGORIES = [
    { id: 'alle', label: 'Alle' },
    { id: 'fleisch', label: 'Fleisch' },
    { id: 'fisch', label: 'Fisch' },
    { id: 'gemuese', label: 'Gemüse und Obst' },
    { id: 'kuehl', label: 'Kühlregal' },
    { id: 'backwaren', label: 'Brot' },
    { id: 'vorrat', label: 'Vorrat' },
    { id: 'fertig', label: 'Fertig' },
    { id: 'getraenke', label: 'Getränke' },
    { id: 'suesses', label: 'Snacks' },
    { id: 'sonstiges', label: 'Weiteres' }
  ];

  var CATEGORY_RULES = [
    { id: 'getraenke', mode: 'suffix', terms: ['saft', 'schorle', 'drink', 'cola', 'bier', 'pils', 'sekt', 'wasser'] },
    { id: 'suesses', mode: 'suffix', terms: ['kuchen', 'torte', 'keks', 'riegel', 'chips'] },
    { id: 'kuehl', mode: 'suffix', terms: ['käse', 'milch', 'joghurt', 'butter', 'quark'] },
    { id: 'fleisch', mode: 'suffix', terms: ['wurst', 'schinken', 'speck', 'fleisch', 'haxe'] },
    { id: 'fertig', mode: 'suffix', terms: ['suppe', 'eintopf', 'pizza'] },
    { id: 'getraenke', mode: 'prefix', terms: ['cola', 'bier', 'wein', 'wasser', 'saft', 'whisky', 'whiskey', 'sekt', 'champagner', 'likör', 'vodka', 'gin', 'prosecco', 'smoothie', 'energy', 'mineral', 'glühwein', 'pastis', 'aperitif', 'radler', 'spritz', 'kaffee', 'tee', 'teekanne', 'espresso', 'cappuccino', 'caffe', 'limonade', 'limo', 'brause', 'softdrink', 'eistee', 'schorle', 'comet', 'pepsi', 'volvic', 'lavazza', 'amecke', 'williams', 'chardonnay', 'pinot', 'riesling', 'sauvignon', 'merlot', 'burgunder', 'matcha', 'vin', 'pfefferer', 'bubbly'] },
    { id: 'suesses', mode: 'contains', terms: ['nuss', 'mandel', 'cashew', 'erdnuss'] },
    { id: 'suesses', mode: 'prefix', terms: ['schoko', 'schokolade', 'choco', 'keks', 'bonbon', 'gummi', 'haribo', 'praline', 'chips', 'snack', 'riegel', 'milka', 'nutella', 'kinder', 'twix', 'eis', 'nougat', 'kakao', 'cacao', 'muffin', 'donut', 'cookie', 'waffel', 'adventskalender', 'ferrero', 'storck', 'snickers', 'oreo', 'merci', 'duplo', 'hanuta', 'prinzen', 'toblerone', 'beukelaer', 'konfitüre', 'konfiture', 'marmelade', 'schnitten', 'mikado', 'pastille', 'churros', 'pastel', 'magdalena', 'knabber', 'studentenfutter', 'tortilla', 'chio', 'flips', 'funny', 'pom', 'erdnüsse', 'peanut'] },
    { id: 'fisch', mode: 'contains', terms: ['muschel'] },
    { id: 'fleisch', mode: 'contains', terms: ['geräuchert', 'räucher'] },
    { id: 'suesses', mode: 'contains', terms: ['pastill', 'honig'] },
    { id: 'fisch', mode: 'prefix', terms: ['fisch', 'lachs', 'thunfisch', 'seelachs', 'garnele', 'muschel', 'muscheln', 'forelle', 'saibling', 'hering', 'dorade', 'sushi', 'kabeljau', 'scholle', 'krebs', 'tintenfisch'] },
    { id: 'fleisch', mode: 'prefix', terms: ['fleisch', 'wurst', 'schinken', 'speck', 'schnitzel', 'hack', 'gulasch', 'hähnchen', 'haehnchen', 'huhn', 'pute', 'puten', 'rind', 'schwein', 'lamm', 'salami', 'leberkäse', 'steak', 'bratwurst', 'wiener', 'mortadella', 'aufschnitt', 'mett', 'haxe', 'roulade', 'gyros', 'burger', 'hackfleisch', 'filet', 'geflügel', 'ente', 'frikadelle', 'leberwurst', 'cabanossi', 'schaschlik', 'eisbein', 'ossobuco', 'bresaola', 'salsiccia', 'chorizo', 'tyrolini', 'geräuchert', 'rohpolnisch'] },
    { id: 'gemuese', mode: 'suffix', terms: ['traube', 'trauben', 'beere', 'beeren'] },
    { id: 'gemuese', mode: 'prefix', terms: ['apfel', 'äpfel', 'banane', 'traube', 'salat', 'tomate', 'gurke', 'paprika', 'zwiebel', 'kartoffel', 'möhre', 'karotte', 'brokkoli', 'champignon', 'pilz', 'orange', 'mango', 'birne', 'beere', 'zitrone', 'kiwi', 'ananas', 'melone', 'kohl', 'spinat', 'zucchini', 'fenchel', 'zwetschge', 'feige', 'obst', 'gemüse', 'avocado', 'ingwer', 'knoblauch', 'lauch', 'erdbeere', 'himbeere', 'kirsche', 'pfirsich', 'pflaume', 'mandarine', 'clementine', 'grapefruit', 'limette', 'kürbis', 'spargel', 'pitahaya', 'kumato', 'patatas'] },
    { id: 'kuehl', mode: 'prefix', terms: ['käse', 'kaese', 'milch', 'joghurt', 'jogurt', 'butter', 'sahne', 'quark', 'schmand', 'mozzarella', 'ei', 'eier', 'frischkäse', 'margarine', 'kiri', 'rama', 'arla', 'cremefine', 'almighurt', 'parmigiano', 'grana', 'padano', 'hummus'] },
    { id: 'backwaren', mode: 'prefix', terms: ['brot', 'brötchen', 'semmel', 'toast', 'baguette', 'croissant', 'aufback', 'knödel', 'knoedel', 'laugen', 'wecken', 'vinschgerl', 'kornspitz', 'backwelt', 'chinois', 'tostado'] },
    { id: 'backwaren', mode: 'suffix', terms: ['brot', 'brote', 'brötchen', 'semmel'] },
    { id: 'vorrat', mode: 'prefix', terms: ['nudel', 'pasta', 'reis', 'mehl', 'öl', 'olivenöl', 'zucker', 'sauce', 'ketchup', 'mayo', 'mayonnaise', 'essig', 'müsli', 'muesli', 'hafer', 'passata', 'passiert', 'mutti', 'tomatenmark', 'linse', 'linsen', 'mais', 'pesto', 'couscous', 'gewürz', 'pfeffer', 'salz', 'senf', 'brühe', 'konserve', 'rapso', 'ebly', 'weizen', 'dip'] },
    { id: 'vorrat', mode: 'suffix', terms: ['reis', 'nudel', 'nudeln', 'öl', 'mehl', 'zucker'] },
    { id: 'fertig', mode: 'prefix', terms: ['pizza', 'flammkuchen', 'maultasche', 'fertiggericht', 'mikrowelle', 'terrine', 'tortellini', 'ravioli', 'lasagne', 'auflauf', 'pfannengericht', 'noodle', 'soba'] }
  ];

  function categoryTermHits(token, term, mode) {
    if (!token || !term) return false;
    if (token === 'preis' && term === 'reis') return false;
    if (token === 'schwein' && term === 'wein') return false;
    if (token === 'eisbein' && term === 'eis') return false;
    if (token === 'lachse' && term === 'lachs') return false;
    if (token === 'leberkäse' && term === 'käse') return false;
    if (token === 'pfefferer' && term === 'pfeffer') return false;
    if (token === term) return true;
    if (mode === 'suffix') {
      var minLength = term === 'öl' ? 2 : 3;
      return term.length >= minLength && token.length > term.length && token.lastIndexOf(term) === token.length - term.length;
    }
    if (term.length < 4 || token.length < 4) return false;
    if (mode === 'contains') return term.length >= 4 && token.indexOf(term) !== -1;
    if (token.indexOf(term) !== 0) return false;
    var rest = token.slice(term.length);
    if (rest === 'kuchen' || rest === 'torte') return false;
    return true;
  }

  function offerCategory(name) {
    var text = String(name || '').toLowerCase();
    if (text.indexOf('hot dog') !== -1) return 'fleisch';
    if (text.indexOf('la mia') !== -1) return 'fertig';
    var words = tokens(name);
    for (var i = 0; i < CATEGORY_RULES.length; i += 1) {
      var rule = CATEGORY_RULES[i];
      var hit = words.some(function (word) {
        return rule.terms.some(function (term) {
          return categoryTermHits(word, term, rule.mode);
        });
      });
      if (hit) return rule.id;
    }
    var ids = matchOfferText(name);
    if (ids.length) {
      var info = ingredient(ids[0]);
      if (info && info.group) return info.group;
    }
    return 'sonstiges';
  }

  function offerCategoryById(id) {
    for (var i = 0; i < OFFER_CATEGORIES.length; i += 1) {
      if (OFFER_CATEGORIES[i].id === id) return OFFER_CATEGORIES[i];
    }
    return OFFER_CATEGORIES[0];
  }

  function hasId(list, id) {
    return list.indexOf(id) !== -1;
  }

  function covered(item, offers, pantry) {
    return hasId(offers, item.id) || hasId(pantry, item.id);
  }

  function describeRecipe(recipe, offers, pantry) {
    var hits = [];
    var missing = [];
    var ingredients = [];
    (recipe.ingredients || []).forEach(function (item) {
      var info = ingredient(item.id);
      var row = { id: item.id, name: info ? info.name : item.id, amount: item.amount };
      ingredients.push(row);
      if (covered(item, offers, pantry)) {
        if (hasId(offers, item.id) && info && info.offer) hits.push(row);
      } else {
        missing.push(row);
      }
    });
    return {
      id: recipe.id,
      title: recipe.title,
      minutes: recipe.minutes,
      steps: Array.isArray(recipe.steps) ? recipe.steps : [],
      ingredients: ingredients,
      hits: hits,
      missing: missing,
      custom: !!recipe.custom,
      edited: !!recipe.edited
    };
  }

  var DAYS = [
    { id: 'mo', label: 'Montag' },
    { id: 'di', label: 'Dienstag' },
    { id: 'mi', label: 'Mittwoch' },
    { id: 'do', label: 'Donnerstag' },
    { id: 'fr', label: 'Freitag' },
    { id: 'sa', label: 'Samstag' },
    { id: 'so', label: 'Sonntag' }
  ];

  function cleanCustomRecipes(raw) {
    var out = [];
    var seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (recipe) {
      if (!recipe || typeof recipe !== 'object' || !recipe.custom) return;
      var id = String(recipe.id || '').trim();
      if (!/^c[0-9]{1,8}$/.test(id) || seen[id]) return;
      var title = String(recipe.title || '').trim().replace(/\s+/g, ' ');
      if (!title || title.length > 80) return;
      var minutes = Math.floor(Number(recipe.minutes));
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) minutes = 20;
      var steps = [];
      (Array.isArray(recipe.steps) ? recipe.steps : []).forEach(function (step) {
        var text = String(step || '').trim().replace(/\s+/g, ' ');
        if (!text || text.length > 240 || steps.length >= 8) return;
        steps.push(text);
      });
      var ingredients = [];
      var seenIng = {};
      (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).forEach(function (item) {
        if (!item || !ingredient(item.id) || seenIng[item.id] || ingredients.length >= 12) return;
        var amount = String(item.amount || '').trim().replace(/\s+/g, ' ');
        if (!amount || amount.length > 40) amount = '1';
        seenIng[item.id] = true;
        ingredients.push({ id: item.id, amount: amount });
      });
      if (!ingredients.length) return;
      var rev = Math.floor(Number(recipe.rev));
      if (!Number.isFinite(rev) || rev < 0) rev = 0;
      seen[id] = true;
      out.push({
        id: id,
        title: title,
        minutes: minutes,
        steps: steps,
        ingredients: ingredients,
        custom: true,
        rev: rev,
        deleted: !!recipe.deleted
      });
    });
    return out;
  }

  function nextRecipeId(recipes) {
    var n = 0;
    cleanCustomRecipes(recipes).forEach(function (recipe) {
      var match = /^c(\d+)$/.exec(recipe.id);
      if (match) n = Math.max(n, Number(match[1]));
    });
    return 'c' + (n + 1);
  }

  function cleanEvenings(raw) {
    var byDay = {};
    if (!Array.isArray(raw)) return [];
    raw.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var day = String(row.day || '');
      var known = false;
      DAYS.forEach(function (item) { if (item.id === day) known = true; });
      if (!known) return;
      var recipeId = String(row.recipeId || '').trim();
      if (recipeId.length > 40) recipeId = '';
      var cook = String(row.cook || '').trim().replace(/\s+/g, ' ');
      if (cook.length > 24) cook = cook.slice(0, 24);
      var rev = Math.floor(Number(row.rev));
      if (!Number.isFinite(rev) || rev < 0) rev = 0;
      if (!byDay[day] || rev >= byDay[day].rev) {
        byDay[day] = { day: day, recipeId: recipeId, cook: cook, rev: rev };
      }
    });
    return DAYS.map(function (item) { return byDay[item.id]; }).filter(function (row) { return !!row; });
  }

  function foldText(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function revNum(value) {
    var rev = Math.floor(Number(value));
    if (!Number.isFinite(rev) || rev < 0) return 0;
    return rev;
  }

  function cleanInventory(raw) {
    var out = [];
    var seenId = {};
    var seenName = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var id = String(row.id || '').trim();
      if (!/^v[0-9]{1,8}$/.test(id) || seenId[id]) return;
      var name = foldText(row.name);
      if (!name || name.length > 80) return;
      var key = name.toLowerCase();
      if (seenName[key]) return;
      var amount = foldText(row.amount);
      if (amount.length > 80) amount = amount.slice(0, 80);
      seenId[id] = true;
      seenName[key] = true;
      out.push({ id: id, name: name, amount: amount, rev: revNum(row.rev), deleted: !!row.deleted });
    });
    return out;
  }

  function nextInventoryId(rows) {
    var n = 0;
    cleanInventory(rows).forEach(function (row) {
      var match = /^v(\d+)$/.exec(row.id);
      if (match) n = Math.max(n, Number(match[1]));
    });
    return 'v' + (n + 1);
  }

  function addInventory(rows, name, amount, now) {
    var list = cleanInventory(rows);
    var clean = foldText(name);
    if (!clean) return { ok: false, reason: 'empty', inventory: list };
    if (clean.length > 80) return { ok: false, reason: 'long', inventory: list };
    var qty = foldText(amount);
    if (qty.length > 80) return { ok: false, reason: 'amount', inventory: list };
    var key = clean.toLowerCase();
    var existing = null;
    var tomb = null;
    list.forEach(function (item) {
      if (item.name.toLowerCase() !== key) return;
      if (item.deleted) tomb = item;
      else existing = item;
    });
    var rev = revNum(now);
    if (existing) {
      var nextAmount = qty || existing.amount;
      if (existing.amount === nextAmount) return { ok: true, already: true, inventory: list, id: existing.id };
      var merged = list.map(function (item) {
        if (item.id !== existing.id) return item;
        return { id: item.id, name: item.name, amount: nextAmount, rev: rev || item.rev, deleted: false };
      });
      return { ok: true, merged: true, inventory: merged, id: existing.id };
    }
    if (tomb) {
      var revived = list.map(function (item) {
        if (item.id !== tomb.id) return item;
        return { id: item.id, name: item.name, amount: qty || tomb.amount, rev: rev || item.rev, deleted: false };
      });
      return { ok: true, merged: true, inventory: revived, id: tomb.id };
    }
    return {
      ok: true,
      created: true,
      inventory: list,
      draft: { name: clean, amount: qty, rev: rev, deleted: false }
    };
  }

  function coveredIds(rows) {
    var ids = [];
    cleanInventory(rows).forEach(function (row) {
      if (row.deleted) return;
      matchStockText(row.name).forEach(function (id) {
        if (ids.indexOf(id) === -1) ids.push(id);
      });
    });
    return ids;
  }

  function seedInventory(pantryIds) {
    var rows = [];
    (pantryIds || []).forEach(function (id) {
      var info = ingredient(id);
      if (!info) return;
      rows.push({
        id: 'v' + (rows.length + 1),
        name: info.name,
        amount: '',
        rev: 1,
        deleted: false
      });
    });
    return rows;
  }

  function ensureInventory(saved, pantryIds) {
    var set = !!(saved && saved.inventorySet === true);
    var list = saved && Array.isArray(saved.inventory) ? saved.inventory : null;
    if (set) return cleanInventory(list || []);
    if (list && list.length) return cleanInventory(list);
    return seedInventory(pantryIds);
  }

  function absorbIds(inventory, ids, now) {
    var next = cleanInventory(inventory);
    (ids || []).forEach(function (id) {
      if (coveredIds(next).indexOf(id) !== -1) return;
      var info = ingredient(id);
      if (!info) return;
      var result = addInventory(next, info.name, '', now);
      if (!result.ok) return;
      if (result.created) {
        next = result.inventory.concat([Object.assign({ id: nextInventoryId(result.inventory) }, result.draft)]);
      } else {
        next = result.inventory;
      }
    });
    return next;
  }

  function recipeById(id) {
    for (var i = 0; i < RECIPES.length; i += 1) {
      if (RECIPES[i].id === id) return RECIPES[i];
    }
    return null;
  }

  function cleanOverrides(raw) {
    var out = [];
    var seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var id = String(row.id || '').trim();
      var base = recipeById(id);
      if (!base || seen[id]) return;
      var title = foldText(row.title);
      if (!title || title.length > 80) return;
      var minutes = Math.floor(Number(row.minutes));
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) minutes = base.minutes || 20;
      var steps = [];
      (Array.isArray(row.steps) ? row.steps : []).forEach(function (step) {
        var text = foldText(step);
        if (!text || text.length > 240 || steps.length >= 8) return;
        steps.push(text);
      });
      var ingredients = [];
      var seenIng = {};
      (Array.isArray(row.ingredients) ? row.ingredients : []).forEach(function (item) {
        if (!item || !ingredient(item.id) || seenIng[item.id] || ingredients.length >= 12) return;
        var amount = foldText(item.amount);
        if (!amount || amount.length > 40) amount = '1';
        seenIng[item.id] = true;
        ingredients.push({ id: item.id, amount: amount });
      });
      if (!ingredients.length) return;
      seen[id] = true;
      out.push({
        id: id,
        title: title,
        minutes: minutes,
        steps: steps,
        ingredients: ingredients,
        rev: revNum(row.rev),
        deleted: !!row.deleted
      });
    });
    return out;
  }

  function saveOverride(overrides, draft) {
    var current = cleanOverrides(overrides);
    var row = cleanOverrides([draft])[0];
    if (!row) return { ok: false, reason: 'invalid', overrides: current };
    row.deleted = false;
    if (draft && draft.rev != null) row.rev = revNum(draft.rev);
    var next = current.filter(function (item) { return item.id !== row.id; });
    next.push(row);
    return { ok: true, overrides: next };
  }

  function resetOverride(overrides, id, now) {
    var current = cleanOverrides(overrides);
    var rev = revNum(now);
    return current.map(function (row) {
      if (row.id !== id) return row;
      return {
        id: row.id,
        title: row.title,
        minutes: row.minutes,
        steps: row.steps.slice(),
        ingredients: row.ingredients.map(function (item) { return { id: item.id, amount: item.amount }; }),
        rev: rev,
        deleted: true
      };
    });
  }

  function applyOverride(recipe, overrides) {
    var row = null;
    cleanOverrides(overrides).forEach(function (item) {
      if (item.id === recipe.id && !item.deleted) row = item;
    });
    if (!row) return recipe;
    return {
      id: recipe.id,
      title: row.title,
      minutes: row.minutes,
      steps: row.steps.slice(),
      ingredients: row.ingredients.map(function (item) { return { id: item.id, amount: item.amount }; }),
      custom: false,
      edited: true
    };
  }

  function suggest(offers, pantry, extras, overrides) {
    var selected = offers || [];
    var home = pantry || [];
    var custom = cleanCustomRecipes(extras).filter(function (recipe) { return !recipe.deleted; });
    var recipes = RECIPES.map(function (recipe) {
      return applyOverride(recipe, overrides);
    }).concat(custom);
    if (!selected.length && !custom.length) return [];
    return recipes.map(function (recipe) {
      return describeRecipe(recipe, selected, home);
    }).filter(function (recipe) {
      return recipe.hits.length > 0 || recipe.custom;
    }).sort(function (a, b) {
      if (b.hits.length !== a.hits.length) return b.hits.length - a.hits.length;
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      return a.title.localeCompare(b.title, 'de');
    });
  }

  function chosenIds(suggestions, picked) {
    if (picked == null) return [];
    var present = {};
    suggestions.forEach(function (recipe) { present[recipe.id] = true; });
    return picked.filter(function (id) { return present[id]; });
  }

  function shoppingList(suggestions, picked) {
    var wanted = {};
    chosenIds(suggestions, picked).forEach(function (id) { wanted[id] = true; });
    var groups = [];
    var index = {};
    suggestions.forEach(function (recipe) {
      if (!wanted[recipe.id]) return;
      recipe.missing.forEach(function (item) {
        if (!index[item.id]) {
          index[item.id] = { id: item.id, name: item.name, amounts: [], meals: [] };
          groups.push(index[item.id]);
        }
        if (index[item.id].amounts.indexOf(item.amount) === -1) index[item.id].amounts.push(item.amount);
        if (index[item.id].meals.indexOf(recipe.title) === -1) index[item.id].meals.push(recipe.title);
      });
    });
    groups.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    return groups;
  }

  function addShopRow(bucket, list, item, recipe) {
    if (!bucket[item.id]) {
      bucket[item.id] = { id: item.id, name: item.name, amounts: [], meals: [], stores: [] };
      list.push(bucket[item.id]);
    }
    var row = bucket[item.id];
    if (row.amounts.indexOf(item.amount) === -1) row.amounts.push(item.amount);
    if (row.meals.indexOf(recipe.title) === -1) row.meals.push(recipe.title);
    return row;
  }

  function shopPlan(suggestions, picked, sources) {
    var wanted = {};
    chosenIds(suggestions, picked).forEach(function (id) { wanted[id] = true; });
    var offerBucket = {};
    var missingBucket = {};
    var offerList = [];
    var missing = [];
    (suggestions || []).forEach(function (recipe) {
      if (!wanted[recipe.id]) return;
      (recipe.hits || []).forEach(function (item) {
        addShopRow(offerBucket, offerList, item, recipe);
      });
      (recipe.missing || []).forEach(function (item) {
        addShopRow(missingBucket, missing, item, recipe);
      });
    });
    var places = sources || [];
    offerList.forEach(function (item) {
      places.forEach(function (source) {
        if ((source.offers || []).indexOf(item.id) !== -1) {
          item.stores.push({ id: source.id, name: source.name });
        }
      });
    });
    var groups = [];
    var byKey = {};
    offerList.forEach(function (item) {
      var key = item.stores.map(function (store) { return store.id; }).join('+') || 'offen';
      if (!byKey[key]) {
        byKey[key] = {
          id: key,
          label: item.stores.length ? item.stores.map(function (store) { return store.name; }).join(' oder ') : 'Im Angebot',
          items: []
        };
        groups.push(byKey[key]);
      }
      byKey[key].items.push(item);
    });
    function sourceIndex(id) {
      for (var i = 0; i < places.length; i += 1) {
        if (places[i].id === id) return i;
      }
      return 99;
    }
    groups.sort(function (a, b) {
      var aMulti = a.id.indexOf('+') !== -1;
      var bMulti = b.id.indexOf('+') !== -1;
      if (aMulti !== bMulti) return aMulti ? 1 : -1;
      if (!aMulti) return sourceIndex(a.id) - sourceIndex(b.id);
      return a.label.localeCompare(b.label, 'de');
    });
    groups.forEach(function (group) {
      group.items.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    });
    missing.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    return { offers: groups, missing: missing };
  }

  return {
    PROSPEKT_URL: PROSPEKT_URL,
    PORTIONS: PORTIONS,
    GROUPS: GROUPS,
    OFFER_CATEGORIES: OFFER_CATEGORIES,
    offerCategory: offerCategory,
    offerCategoryById: offerCategoryById,
    INGREDIENTS: INGREDIENTS,
    RECIPES: RECIPES,
    DAYS: DAYS,
    ingredient: ingredient,
    offerIngredients: offerIngredients,
    pantryIngredients: pantryIngredients,
    defaultPantry: defaultPantry,
    weekKey: weekKey,
    freshState: freshState,
    normalizeState: normalizeState,
    matchOfferText: matchOfferText,
    matchStockText: matchStockText,
    idsFromOffers: idsFromOffers,
    suggest: suggest,
    cleanInventory: cleanInventory,
    addInventory: addInventory,
    nextInventoryId: nextInventoryId,
    coveredIds: coveredIds,
    seedInventory: seedInventory,
    ensureInventory: ensureInventory,
    absorbIds: absorbIds,
    cleanOverrides: cleanOverrides,
    saveOverride: saveOverride,
    resetOverride: resetOverride,
    cleanCustomRecipes: cleanCustomRecipes,
    nextRecipeId: nextRecipeId,
    cleanEvenings: cleanEvenings,
    chosenIds: chosenIds,
    shoppingList: shoppingList,
    shopPlan: shopPlan
  };
});
