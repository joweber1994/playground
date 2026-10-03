/* Symbolische Gleichstrom- und Wechselstromrechnung für lineare Netze.
   Eigene Implementierung: modifizierte Knotenanalyse und rationale Polynome. */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.tf_modeling = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function gcdBig(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  function q(n, d) {
    if (d === undefined) d = 1n;
    if (typeof n === "number") n = BigInt(Math.trunc(n));
    if (typeof d === "number") d = BigInt(Math.trunc(d));
    if (d === 0n) throw new Error("Division durch null");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdBig(n, d);
    return { n: n / g, d: d / g };
  }

  function qIsZero(a) {
    return a.n === 0n;
  }
  function qNeg(a) {
    return q(-a.n, a.d);
  }
  function qAdd(a, b) {
    return q(a.n * b.d + b.n * a.d, a.d * b.d);
  }
  function qSub(a, b) {
    return qAdd(a, qNeg(b));
  }
  function qMul(a, b) {
    return q(a.n * b.n, a.d * b.d);
  }
  function qDiv(a, b) {
    return q(a.n * b.d, a.d * b.n);
  }
  function qInv(a) {
    return q(a.d, a.n);
  }

  function monoKey(parts) {
    const items = [];
    parts.forEach(function (exp, name) {
      if (exp) items.push([name, exp]);
    });
    items.sort(function (a, b) {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    return items
      .map(function (it) {
        return it[1] === 1 ? it[0] : it[0] + "^" + it[1];
      })
      .join("*");
  }

  function parseMono(key) {
    const map = new Map();
    if (!key) return map;
    key.split("*").forEach(function (part) {
      const bits = part.split("^");
      map.set(bits[0], bits[1] ? Number(bits[1]) : 1);
    });
    return map;
  }

  function mulKeys(a, b) {
    const map = parseMono(a);
    parseMono(b).forEach(function (exp, name) {
      map.set(name, (map.get(name) || 0) + exp);
    });
    return monoKey(map);
  }

  function polyZero() {
    return new Map();
  }
  function polyFrom(key, coeff) {
    const p = polyZero();
    if (!qIsZero(coeff)) p.set(key, coeff);
    return p;
  }
  function polyConst(coeff) {
    return polyFrom("", coeff);
  }
  function polyOne() {
    return polyConst(q(1n));
  }
  function polySym(name) {
    return polyFrom(name, q(1n));
  }
  function polyIsZero(p) {
    return p.size === 0;
  }
  function samePoly(a, b) {
    if (a.size !== b.size) return false;
    let same = true;
    a.forEach(function (coeff, key) {
      const other = b.get(key);
      if (!other || other.n !== coeff.n || other.d !== coeff.d) same = false;
    });
    return same;
  }
  function polyClone(p) {
    return new Map(p);
  }

  function polyAdd(a, b) {
    const out = polyClone(a);
    b.forEach(function (coeff, key) {
      const sum = out.has(key) ? qAdd(out.get(key), coeff) : coeff;
      if (qIsZero(sum)) out.delete(key);
      else out.set(key, sum);
    });
    return out;
  }
  function polySub(a, b) {
    return polyAdd(a, polyScaleQ(b, q(-1n)));
  }
  function polyScaleQ(p, factor) {
    if (qIsZero(factor)) return polyZero();
    const out = polyZero();
    p.forEach(function (coeff, key) {
      const next = qMul(coeff, factor);
      if (!qIsZero(next)) out.set(key, next);
    });
    return out;
  }
  function polyMul(a, b) {
    const out = polyZero();
    a.forEach(function (ca, ka) {
      b.forEach(function (cb, kb) {
        const key = mulKeys(ka, kb);
        const coeff = qMul(ca, cb);
        const sum = out.has(key) ? qAdd(out.get(key), coeff) : coeff;
        if (qIsZero(sum)) out.delete(key);
        else out.set(key, sum);
      });
    });
    return out;
  }

  function monoParts(key) {
    const items = [];
    parseMono(key).forEach(function (exp, name) {
      items.push([name, exp]);
    });
    items.sort(function (a, b) {
      return a[0] < b[0] ? -1 : 1;
    });
    return items;
  }

  function cmpMono(a, b) {
    const da = a.reduce(function (s, it) {
      return s + it[1];
    }, 0);
    const db = b.reduce(function (s, it) {
      return s + it[1];
    }, 0);
    if (da !== db) return da - db;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (!a[i]) return -1;
      if (!b[i]) return 1;
      if (a[i][0] !== b[i][0]) return a[i][0] < b[i][0] ? -1 : 1;
      if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
    }
    return 0;
  }

  function leading(p) {
    let best = null;
    p.forEach(function (coeff, key) {
      const mono = monoParts(key);
      if (!best || cmpMono(mono, best.mono) > 0) best = { key: key, coeff: coeff, mono: mono };
    });
    return best;
  }

  function varsOf(p) {
    const set = new Set();
    p.forEach(function (_c, key) {
      parseMono(key).forEach(function (_e, name) {
        set.add(name);
      });
    });
    return Array.from(set).sort();
  }

  function splitKey(key, variable) {
    const map = parseMono(key);
    const exp = map.get(variable) || 0;
    map.delete(variable);
    return { exp: exp, rest: monoKey(map) };
  }

  function toUni(p, variable) {
    const uni = new Map();
    p.forEach(function (coeff, key) {
      const split = splitKey(key, variable);
      const term = polyFrom(split.rest, coeff);
      uni.set(split.exp, uni.has(split.exp) ? polyAdd(uni.get(split.exp), term) : term);
    });
    return uni;
  }

  function fromUni(uni, variable) {
    let out = polyZero();
    uni.forEach(function (coeffPoly, exp) {
      coeffPoly.forEach(function (coeff, key) {
        const vk = exp === 0 ? "" : exp === 1 ? variable : variable + "^" + exp;
        out = polyAdd(out, polyFrom(mulKeys(key, vk), coeff));
      });
    });
    return out;
  }

  function uniDeg(uni) {
    let d = -1;
    uni.forEach(function (coeff, exp) {
      if (!polyIsZero(coeff) && exp > d) d = exp;
    });
    return d;
  }

  function polyExactQuo(a, b) {
    if (polyIsZero(b)) return null;
    if (polyIsZero(a)) return polyZero();
    let rem = a;
    let quo = polyZero();
    const lb = leading(b);
    for (let guard = 0; guard < 80 && !polyIsZero(rem); guard++) {
      const lr = leading(rem);
      const factorMono = new Map(parseMono(lr.key));
      let ok = true;
      lb.mono.forEach(function (exp, index) {
        const name = lb.mono[index][0];
        const need = lb.mono[index][1];
        const have = factorMono.get(name) || 0;
        if (have < need) ok = false;
        else if (have === need) factorMono.delete(name);
        else factorMono.set(name, have - need);
      });
      if (!ok) return null;
      const coeff = qDiv(lr.coeff, lb.coeff);
      const term = polyFrom(monoKey(factorMono), coeff);
      quo = polyAdd(quo, term);
      rem = polySub(rem, polyMul(b, term));
    }
    return polyIsZero(rem) ? quo : null;
  }

  function cancelMonomial(num, den) {
    const mins = new Map();
    let started = false;
    function scan(poly) {
      poly.forEach(function (_coeff, key) {
        const mono = parseMono(key);
        if (!started) {
          mono.forEach(function (exp, name) {
            mins.set(name, exp);
          });
          started = true;
          return;
        }
        Array.from(mins.keys()).forEach(function (name) {
          mins.set(name, Math.min(mins.get(name), mono.get(name) || 0));
        });
      });
    }
    scan(num);
    scan(den);
    const useful = Array.from(mins.entries()).filter(function (pair) {
      return pair[1] > 0;
    });
    if (!useful.length) return { num: num, den: den };
    function strip(poly) {
      const out = polyZero();
      poly.forEach(function (coeff, key) {
        const mono = parseMono(key);
        useful.forEach(function (pair) {
          const left = (mono.get(pair[0]) || 0) - pair[1];
          if (left) mono.set(pair[0], left);
          else mono.delete(pair[0]);
        });
        const nextKey = monoKey(mono);
        const prev = out.get(nextKey);
        const sum = prev ? qAdd(prev, coeff) : coeff;
        if (qIsZero(sum)) out.delete(nextKey);
        else out.set(nextKey, sum);
      });
      return out;
    }
    return { num: strip(num), den: strip(den) };
  }

  function sCoeffs(poly) {
    const uni = toUni(poly, "s");
    const deg = uniDeg(uni);
    const coeffs = [];
    for (let i = 0; i <= deg; i++) coeffs.push(uni.get(i) || polyZero());
    return coeffs;
  }

  function sDegree(coeffs) {
    for (let i = coeffs.length - 1; i >= 0; i--) {
      if (!polyIsZero(coeffs[i])) return i;
    }
    return -1;
  }

  function sTrim(coeffs) {
    const deg = sDegree(coeffs);
    return deg < 0 ? [] : coeffs.slice(0, deg + 1);
  }

  function sSub(a, b) {
    const n = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < n; i++) out.push(polySub(a[i] || polyZero(), b[i] || polyZero()));
    return sTrim(out);
  }

  function fromS(coeffs) {
    let out = polyZero();
    coeffs.forEach(function (coeffPoly, exp) {
      coeffPoly.forEach(function (coeff, key) {
        const sk = exp === 0 ? "" : exp === 1 ? "s" : "s^" + exp;
        out = polyAdd(out, polyFrom(mulKeys(key, sk), coeff));
      });
    });
    return out;
  }

  function sPrem(a, b) {
    let rem = a.slice();
    const db = sDegree(b);
    let guard = 0;
    while (sDegree(rem) >= db && db >= 0 && guard++ < 40) {
      const dr = sDegree(rem);
      const left = rem.map(function (coeff) {
        return polyMul(coeff, b[db]);
      });
      const right = [];
      for (let i = 0; i < dr - db; i++) right.push(polyZero());
      b.forEach(function (coeff) {
        right.push(polyMul(coeff, rem[dr]));
      });
      rem = sSub(left, right);
    }
    return rem;
  }

  function sGcd(a, b) {
    let A = sCoeffs(a);
    let B = sCoeffs(b);
    if (sDegree(A) < sDegree(B)) {
      const swap = A;
      A = B;
      B = swap;
    }
    while (sDegree(B) >= 0) {
      const rem = sPrem(A, B);
      A = B;
      B = rem;
    }
    return fromS(A);
  }

  function rat(num, den) {
    if (!den) den = polyOne();
    if (polyIsZero(num)) return { num: polyZero(), den: polyOne() };
    let cancelled = cancelMonomial(num, den);
    num = cancelled.num;
    den = cancelled.den;
    if (varsOf(num).indexOf("s") >= 0 || varsOf(den).indexOf("s") >= 0) {
      const g = sGcd(num, den);
      if (sDegree(sCoeffs(g)) > 0) {
        const nq = polyExactQuo(num, g);
        const dq = polyExactQuo(den, g);
        if (nq && dq && !polyIsZero(dq)) {
          num = nq;
          den = dq;
          cancelled = cancelMonomial(num, den);
          num = cancelled.num;
          den = cancelled.den;
        }
      }
    }
    if (samePoly(num, den)) return { num: polyOne(), den: polyOne() };
    if (samePoly(num, polyScaleQ(den, q(-1n)))) return { num: polyConst(q(-1n)), den: polyOne() };
    const lead = leading(den);
    if (lead && lead.coeff.n < 0n) {
      num = polyScaleQ(num, q(-1n));
      den = polyScaleQ(den, q(-1n));
    }
    return { num: num, den: den };
  }

  function ratZero() {
    return rat(polyZero(), polyOne());
  }
  function ratOne() {
    return rat(polyOne(), polyOne());
  }
  function ratSym(name) {
    return rat(polySym(name), polyOne());
  }
  function ratQ(coeff) {
    return rat(polyConst(coeff), polyOne());
  }
  function ratIsZero(r) {
    return polyIsZero(r.num);
  }
  function ratNeg(r) {
    return rat(polyScaleQ(r.num, q(-1n)), r.den);
  }
  function ratAdd(a, b) {
    return rat(polyAdd(polyMul(a.num, b.den), polyMul(b.num, a.den)), polyMul(a.den, b.den));
  }
  function ratSub(a, b) {
    return ratAdd(a, ratNeg(b));
  }
  function ratMul(a, b) {
    return rat(polyMul(a.num, b.num), polyMul(a.den, b.den));
  }
  function ratDiv(a, b) {
    if (ratIsZero(b)) throw new Error("Division durch null");
    return rat(polyMul(a.num, b.den), polyMul(a.den, b.num));
  }

  function formatCoeff(coeff, withMono) {
    const sign = coeff.n < 0n ? "-" : "";
    const n = coeff.n < 0n ? -coeff.n : coeff.n;
    const body = coeff.d === 1n ? n.toString() : n.toString() + "/" + coeff.d.toString();
    if (withMono && body === "1") return sign;
    return sign + body;
  }

  function formatMono(key) {
    if (!key) return "";
    return key
      .split("*")
      .map(function (part) {
        const bits = part.split("^");
        if (!bits[1]) return bits[0];
        return bits[0] + "^" + bits[1];
      })
      .join("*");
  }

  function formatPoly(p) {
    if (polyIsZero(p)) return "0";
    const terms = [];
    p.forEach(function (coeff, key) {
      terms.push({ key: key, coeff: coeff, mono: monoParts(key) });
    });
    terms.sort(function (a, b) {
      return cmpMono(a.mono, b.mono);
    });
    return terms
      .map(function (term, index) {
        const mono = formatMono(term.key);
        const mag = formatCoeff(q(term.coeff.n < 0n ? -term.coeff.n : term.coeff.n, term.coeff.d), !!mono);
        const negative = term.coeff.n < 0n;
        const piece = mag === "" || mag === "-" ? (negative ? "-" : "") + mono : mono ? mag + "*" + mono : mag;
        if (index === 0) return negative && mag !== "-" ? piece : piece;
        return (negative ? " - " : " + ") + (mag === "-" ? mono : mono ? (mag === "" ? mono : mag.replace(/^-/, "") + "*" + mono) : mag.replace(/^-/, ""));
      })
      .join("");
  }

  function wrap(text) {
    if (text.indexOf(" + ") >= 0 || text.indexOf(" - ") >= 0) return "(" + text + ")";
    return text;
  }

  function formatRat(r) {
    let num = formatPoly(r.num);
    const den = formatPoly(r.den);
    if (den === "1") return num;
    let sign = "";
    if (num.charAt(0) === "-" && num.indexOf(" ") < 0) {
      sign = "-";
      num = num.slice(1);
    }
    return sign + wrap(num) + " / " + wrap(den);
  }

  function parseDecimal(text) {
    const m = text.match(/^(\d+)(?:\.(\d+))?([pnumkMG])?$/);
    if (!m) return null;
    const whole = m[1];
    const frac = m[2] || "";
    const suffix = m[3] || "";
    const scale = { p: -12, n: -9, u: -6, m: -3, k: 3, M: 6, G: 9 }[suffix] || 0;
    const digits = whole + frac;
    let n = BigInt(digits);
    let d = 1n;
    for (let i = 0; i < frac.length; i++) d *= 10n;
    if (scale >= 0) {
      for (let i = 0; i < scale; i++) n *= 10n;
    } else {
      for (let i = 0; i < -scale; i++) d *= 10n;
    }
    return q(n, d);
  }

  function parseValue(text) {
    const raw = String(text == null ? "" : text).trim();
    if (!raw) return { error: "Wert fehlt" };
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
      if (raw === "s") return { error: "s steht für die komplexe Frequenz und kann kein Bauteilwert sein" };
      return { value: ratSym(raw) };
    }
    const num = parseDecimal(raw);
    if (!num) return { error: "Wert " + raw + " ist weder Symbol noch Zahl" };
    return { value: ratQ(num) };
  }

  function solveNetlist(components) {
    const nodes = new Set();
    components.forEach(function (c) {
      Object.keys(c.pins).forEach(function (pin) {
        nodes.add(c.pins[pin]);
      });
    });
    if (!nodes.has("0")) return { ok: false, error: "Die Schaltung braucht eine Masse." };
    const nodeList = Array.from(nodes).filter(function (n) {
      return n !== "0";
    });
    const extras = [];
    components.forEach(function (c) {
      if (c.type === "V" || c.type === "O") extras.push(c);
    });
    const index = new Map();
    nodeList.forEach(function (n, i) {
      index.set(n, i);
    });
    const n = nodeList.length + extras.length;
    if (!n) return { ok: false, error: "Es gibt keinen Knoten außer Masse." };
    const A = [];
    const z = [];
    for (let r = 0; r < n; r++) {
      A.push([]);
      for (let c = 0; c < n; c++) A[r].push(ratZero());
      z.push(ratZero());
    }
    function stamp(rowName, colName, value) {
      if (rowName === "0" || colName === "0" || rowName == null || colName == null) return;
      const row = typeof rowName === "number" ? rowName : index.get(rowName);
      const col = typeof colName === "number" ? colName : index.get(colName);
      if (row === undefined || col === undefined) return;
      A[row][col] = ratAdd(A[row][col], value);
    }
    function rhs(rowName, value) {
      if (rowName === "0" || rowName == null) return;
      const row = typeof rowName === "number" ? rowName : index.get(rowName);
      if (row === undefined) return;
      z[row] = ratAdd(z[row], value);
    }

    try {
      for (let i = 0; i < components.length; i++) {
        const c = components[i];
        const parsed = c.type === "GND" ? { value: ratZero() } : parseValue(c.value);
        if (parsed.error) return { ok: false, error: c.name + ": " + parsed.error };
        const value = parsed.value;
        if (c.type === "R") {
          const g = ratDiv(ratOne(), value);
          stamp(c.pins.a, c.pins.a, g);
          stamp(c.pins.b, c.pins.b, g);
          stamp(c.pins.a, c.pins.b, ratNeg(g));
          stamp(c.pins.b, c.pins.a, ratNeg(g));
        } else if (c.type === "C") {
          const g = ratMul(ratSym("s"), value);
          stamp(c.pins.a, c.pins.a, g);
          stamp(c.pins.b, c.pins.b, g);
          stamp(c.pins.a, c.pins.b, ratNeg(g));
          stamp(c.pins.b, c.pins.a, ratNeg(g));
        } else if (c.type === "L") {
          const g = ratDiv(ratOne(), ratMul(ratSym("s"), value));
          stamp(c.pins.a, c.pins.a, g);
          stamp(c.pins.b, c.pins.b, g);
          stamp(c.pins.a, c.pins.b, ratNeg(g));
          stamp(c.pins.b, c.pins.a, ratNeg(g));
        } else if (c.type === "G") {
          stamp(c.pins.p, c.pins.cp, value);
          stamp(c.pins.p, c.pins.cn, ratNeg(value));
          stamp(c.pins.n, c.pins.cp, ratNeg(value));
          stamp(c.pins.n, c.pins.cn, value);
        } else if (c.type === "I") {
          rhs(c.pins.n, value);
          rhs(c.pins.p, ratNeg(value));
        } else if (c.type === "V") {
          const k = nodeList.length + extras.findIndex(function (e) {
            return e === c;
          });
          stamp(c.pins.p, k, ratOne());
          stamp(c.pins.n, k, ratNeg(ratOne()));
          stamp(k, c.pins.p, ratOne());
          stamp(k, c.pins.n, ratNeg(ratOne()));
          rhs(k, value);
        } else if (c.type === "O") {
          const k = nodeList.length + extras.findIndex(function (e) {
            return e === c;
          });
          stamp(k, c.pins.inp, ratOne());
          stamp(k, c.pins.inn, ratNeg(ratOne()));
          stamp(c.pins.out, k, ratOne());
        } else if (c.type !== "GND") {
          return { ok: false, error: "Unbekanntes Bauteil " + c.type };
        }
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const sol = gauss(A, z);
    if (!sol) {
      return { ok: false, error: "Die Schaltung ist nicht bestimmt. Masse, Verbindungen oder eine Quelle fehlen." };
    }
    const voltages = {};
    nodeList.forEach(function (name, i) {
      voltages[name] = { text: formatRat(sol[i]), rat: sol[i] };
    });
    const source = components.find(function (c) {
      return c.type === "V";
    });
    const ratios = {};
    if (source) {
      const parsed = parseValue(source.value);
      if (parsed.value && !ratIsZero(parsed.value)) {
        nodeList.forEach(function (name) {
          try {
            const ratio = ratDiv(voltages[name].rat, parsed.value);
            ratios[name] = { text: formatRat(ratio), rat: ratio, to: source.value };
          } catch (err) {
            ratios[name] = { text: voltages[name].text, rat: voltages[name].rat, to: source.value };
          }
        });
      }
    }
    return { ok: true, voltages: voltages, ratios: ratios, source: source ? source.value : null };
  }

  function gauss(A, z) {
    const n = A.length;
    const M = A.map(function (row, r) {
      return row.map(cloneRat).concat([cloneRat(z[r])]);
    });
    for (let col = 0; col < n; col++) {
      let piv = -1;
      for (let r = col; r < n; r++) {
        if (!ratIsZero(M[r][col])) {
          piv = r;
          break;
        }
      }
      if (piv < 0) return null;
      if (piv !== col) {
        const tmp = M[col];
        M[col] = M[piv];
        M[piv] = tmp;
      }
      const div = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] = ratDiv(M[col][c], div);
      for (let r = 0; r < n; r++) {
        if (r === col || ratIsZero(M[r][col])) continue;
        const f = M[r][col];
        for (let c = col; c <= n; c++) M[r][c] = ratSub(M[r][c], ratMul(f, M[col][c]));
      }
    }
    return M.map(function (row) {
      return row[n];
    });
  }

  function cloneRat(r) {
    return { num: polyClone(r.num), den: polyClone(r.den) };
  }

  const PIN = {
    R: [
      { id: "a", x: -2, y: 0 },
      { id: "b", x: 2, y: 0 },
    ],
    C: [
      { id: "a", x: -2, y: 0 },
      { id: "b", x: 2, y: 0 },
    ],
    L: [
      { id: "a", x: -2, y: 0 },
      { id: "b", x: 2, y: 0 },
    ],
    V: [
      { id: "p", x: 0, y: -2 },
      { id: "n", x: 0, y: 2 },
    ],
    I: [
      { id: "p", x: 0, y: -2 },
      { id: "n", x: 0, y: 2 },
    ],
    G: [
      { id: "p", x: -2, y: -1 },
      { id: "n", x: -2, y: 1 },
      { id: "cp", x: 2, y: -1 },
      { id: "cn", x: 2, y: 1 },
    ],
    O: [
      { id: "inp", x: -2, y: -1 },
      { id: "inn", x: -2, y: 1 },
      { id: "out", x: 2, y: 0 },
    ],
    GND: [{ id: "g", x: 0, y: 0 }],
  };

  function rotPoint(x, y, rot) {
    const turns = ((rot || 0) / 90) % 4;
    let px = x;
    let py = y;
    for (let i = 0; i < (turns + 4) % 4; i++) {
      const nx = -py;
      py = px;
      px = nx;
    }
    return { x: px, y: py };
  }

  function pinPositions(comp) {
    return (PIN[comp.type] || []).map(function (pin) {
      const p = rotPoint(pin.x, pin.y, comp.rot || 0);
      return { id: pin.id, x: comp.x + p.x, y: comp.y + p.y, compId: comp.id };
    });
  }

  function onSegment(x, y, a, b) {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (a.x === b.x) return x === a.x && y >= minY && y <= maxY;
    if (a.y === b.y) return y === a.y && x >= minX && x <= maxX;
    return false;
  }

  function solveSchematic(state) {
    const pins = [];
    (state.components || []).forEach(function (comp) {
      pinPositions(comp).forEach(function (pin) {
        pins.push(pin);
      });
    });
    if (!pins.length) return { ok: false, error: "Die Fläche ist leer." };
    const parent = pins.map(function (_p, i) {
      return i;
    });
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function unite(i, j) {
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        if (pins[i].x === pins[j].x && pins[i].y === pins[j].y) unite(i, j);
      }
    }
    let groundIndex = -1;
    pins.forEach(function (pin, index) {
      if (pin.id !== "g") return;
      if (groundIndex < 0) groundIndex = index;
      else unite(groundIndex, index);
    });
    const wires = state.wires || [];
    function pointOnWire(x, y, wire) {
      for (let s = 1; s < wire.points.length; s++) {
        if (onSegment(x, y, wire.points[s - 1], wire.points[s])) return true;
      }
      return false;
    }
    const pinsOnWire = wires.map(function (wire) {
      const on = [];
      pins.forEach(function (pin, index) {
        if (pointOnWire(pin.x, pin.y, wire)) on.push(index);
      });
      return on;
    });
    const wireParent = wires.map(function (_wire, index) {
      return index;
    });
    function wireFind(i) {
      while (wireParent[i] !== i) {
        wireParent[i] = wireParent[wireParent[i]];
        i = wireParent[i];
      }
      return i;
    }
    function wireUnite(i, j) {
      const a = wireFind(i);
      const b = wireFind(j);
      if (a !== b) wireParent[b] = a;
    }
    for (let i = 0; i < wires.length; i++) {
      for (let j = i + 1; j < wires.length; j++) {
        const touch =
          wires[i].points.some(function (point) {
            return pointOnWire(point.x, point.y, wires[j]);
          }) ||
          wires[j].points.some(function (point) {
            return pointOnWire(point.x, point.y, wires[i]);
          });
        if (touch) wireUnite(i, j);
      }
    }
    const pinsByWire = new Map();
    wires.forEach(function (_wire, index) {
      const root = wireFind(index);
      pinsOnWire[index].forEach(function (pinIndex) {
        if (!pinsByWire.has(root)) pinsByWire.set(root, []);
        pinsByWire.get(root).push(pinIndex);
      });
    });
    pinsByWire.forEach(function (group) {
      for (let k = 1; k < group.length; k++) unite(group[0], group[k]);
    });

    const groups = new Map();
    pins.forEach(function (pin, index) {
      const root = find(index);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(pin);
    });

    const names = new Map();
    let auto = 1;
    let groundRoot = null;
    groups.forEach(function (group, root) {
      if (group.some(function (pin) {
        return pin.id === "g";
      })) groundRoot = root;
    });
    if (groundRoot === null) return { ok: false, error: "Setze ein Massesymbol." };
    names.set(groundRoot, "0");
    const labels = state.labels || [];
    let labelError = null;
    groups.forEach(function (group, root) {
      const hits = labels.filter(function (label) {
        return group.some(function (pin) {
          return pin.x === label.x && pin.y === label.y;
        });
      });
      if (root === groundRoot) return;
      if (hits.length > 1) labelError = "Ein Netz trägt zwei Namen.";
      else if (hits.length === 1) names.set(root, hits[0].text);
      else names.set(root, "n" + auto++);
    });
    if (labelError) return { ok: false, error: labelError };

    const netOf = new Map();
    groups.forEach(function (group, root) {
      group.forEach(function (pin) {
        netOf.set(pin.compId + ":" + pin.id, names.get(root));
      });
    });

    const components = state.components.map(function (comp) {
      const pinsOut = {};
      (PIN[comp.type] || []).forEach(function (pin) {
        pinsOut[pin.id] = netOf.get(comp.id + ":" + pin.id);
      });
      return { type: comp.type, name: comp.name, value: comp.value, pins: pinsOut };
    });
    return solveNetlist(components);
  }

  function examples() {
    return {
      teiler: {
        components: [
          { id: "v", type: "V", name: "Vin", value: "vin", x: 2, y: 4, rot: 0 },
          { id: "r1", type: "R", name: "R1", value: "R1", x: 6, y: 2, rot: 0 },
          { id: "r2", type: "R", name: "R2", value: "R2", x: 8, y: 4, rot: 90 },
          { id: "g1", type: "GND", name: "0", value: "", x: 2, y: 6, rot: 0 },
          { id: "g2", type: "GND", name: "0b", value: "", x: 8, y: 6, rot: 0 },
        ],
        wires: [{ id: "w1", points: [{ x: 2, y: 2 }, { x: 4, y: 2 }] }],
        labels: [
          { id: "l1", x: 2, y: 2, text: "in" },
          { id: "l2", x: 8, y: 2, text: "out" },
        ],
      },
      tiefpass: {
        components: [
          { id: "v", type: "V", name: "Vin", value: "vin", x: 2, y: 4, rot: 0 },
          { id: "r1", type: "R", name: "R1", value: "R", x: 7, y: 2, rot: 0 },
          { id: "c1", type: "C", name: "C1", value: "C", x: 9, y: 4, rot: 90 },
          { id: "g1", type: "GND", name: "0", value: "", x: 2, y: 6, rot: 0 },
          { id: "g2", type: "GND", name: "0b", value: "", x: 9, y: 6, rot: 0 },
        ],
        wires: [{ id: "w1", points: [{ x: 2, y: 2 }, { x: 5, y: 2 }] }],
        labels: [
          { id: "l1", x: 2, y: 2, text: "in" },
          { id: "l2", x: 9, y: 2, text: "out" },
        ],
      },
      inverter: {
        components: [
          { id: "v", type: "V", name: "Vin", value: "vin", x: 2, y: 4, rot: 0 },
          { id: "rin", type: "R", name: "Rin", value: "Rin", x: 6, y: 2, rot: 0 },
          { id: "rf", type: "R", name: "Rf", value: "Rf", x: 12, y: 2, rot: 0 },
          { id: "op", type: "O", name: "Op", value: "1", x: 11, y: 5, rot: 0 },
          { id: "g1", type: "GND", name: "0", value: "", x: 2, y: 6, rot: 0 },
          { id: "g2", type: "GND", name: "0b", value: "", x: 10, y: 8, rot: 0 },
        ],
        wires: [
          { id: "w1", points: [{ x: 2, y: 2 }, { x: 4, y: 2 }] },
          { id: "w2", points: [{ x: 8, y: 2 }, { x: 10, y: 2 }] },
          { id: "w3", points: [{ x: 9, y: 6 }, { x: 7, y: 6 }, { x: 7, y: 2 }, { x: 8, y: 2 }] },
          { id: "w4", points: [{ x: 9, y: 4 }, { x: 10, y: 4 }, { x: 10, y: 8 }] },
          { id: "w5", points: [{ x: 13, y: 5 }, { x: 13, y: 2 }, { x: 14, y: 2 }] },
        ],
        labels: [
          { id: "l1", x: 2, y: 2, text: "in" },
          { id: "l2", x: 14, y: 2, text: "out" },
        ],
      },
    };
  }

  function evalRat(r, env) {
    function ev(p) {
      let sum = 0;
      p.forEach(function (coeff, key) {
        let term = Number(coeff.n) / Number(coeff.d);
        parseMono(key).forEach(function (exp, name) {
          term *= Math.pow(env[name], exp);
        });
        sum += term;
      });
      return sum;
    }
    return ev(r.num) / ev(r.den);
  }

  return {
    solveNetlist: solveNetlist,
    solveSchematic: solveSchematic,
    parseValue: parseValue,
    formatRat: formatRat,
    evalRat: evalRat,
    examples: examples,
    ratDiv: ratDiv,
    ratSym: ratSym,
    PIN: PIN,
    pinPositions: pinPositions,
  };
});
