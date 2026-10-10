/* Wochenzettel – EAN/UPC aus einem Kamerabild, falls BarcodeDetector fehlt. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WochenzettelEan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var L = [
    '0001101', '0011001', '0010011', '0111101', '0100011',
    '0110001', '0101111', '0111011', '0110111', '0001011'
  ];
  var G = [
    '0100111', '0110011', '0011011', '0100001', '0011101',
    '0111001', '0000101', '0010001', '0001001', '0010111'
  ];
  var R = [
    '1110010', '1100110', '1101100', '1000010', '1011100',
    '1001110', '1010000', '1000100', '1001000', '1110100'
  ];
  var FAMILY = [
    'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
  ];
  var DIGITS = {};

  function addDigits(list, parity) {
    list.forEach(function (bits, digit) {
      if (!DIGITS[bits]) DIGITS[bits] = [];
      DIGITS[bits].push({ d: digit, p: parity });
    });
  }

  addDigits(L, 'L');
  addDigits(G, 'G');
  addDigits(R, 'R');

  function checksumOk(digits) {
    if (!/^\d+$/.test(digits)) return false;
    var sum = 0;
    var i;
    for (i = 0; i < digits.length - 1; i += 1) {
      var fromRight = digits.length - 1 - i;
      sum += Number(digits[i]) * (fromRight % 2 === 1 ? 3 : 1);
    }
    var check = (10 - (sum % 10)) % 10;
    return check === Number(digits[digits.length - 1]);
  }

  function bits13(code) {
    var parity = FAMILY[Number(code[0])];
    var bits = '101';
    var i;
    for (i = 0; i < 6; i += 1) {
      var digit = Number(code[i + 1]);
      bits += parity[i] === 'L' ? L[digit] : G[digit];
    }
    bits += '01010';
    for (i = 0; i < 6; i += 1) bits += R[Number(code[i + 7])];
    return bits + '101';
  }

  function bits8(code) {
    var bits = '101';
    var i;
    for (i = 0; i < 4; i += 1) bits += L[Number(code[i])];
    bits += '01010';
    for (i = 0; i < 4; i += 1) bits += R[Number(code[i + 4])];
    return bits + '101';
  }

  function encode(code) {
    var digits = String(code == null ? '' : code).replace(/\D/g, '');
    if (digits.length === 12) digits = '0' + digits;
    if (!checksumOk(digits)) return '';
    if (digits.length === 13) return bits13(digits);
    if (digits.length === 8) return bits8(digits);
    return '';
  }

  function matchDigit(bits, mode) {
    var found = DIGITS[bits];
    if (!found) return null;
    for (var i = 0; i < found.length; i += 1) {
      var item = found[i];
      if (mode === 'R' && item.p !== 'R') continue;
      if (mode === 'L' && item.p !== 'L') continue;
      if (mode === 'LG' && item.p === 'R') continue;
      return item;
    }
    return null;
  }

  function alike(a, b) {
    var hi = Math.max(a, b);
    return hi > 0 && Math.min(a, b) * 1.85 >= hi;
  }

  function toRuns(bits) {
    var runs = [];
    var current = bits[0];
    var length = 1;
    var i;
    for (i = 1; i < bits.length; i += 1) {
      if (bits[i] === current) {
        length += 1;
      } else {
        runs.push({ black: current === 1, width: length });
        current = bits[i];
        length = 1;
      }
    }
    runs.push({ black: current === 1, width: length });
    return runs;
  }

  function binarize(gray) {
    var min = 255;
    var max = 0;
    var i;
    for (i = 0; i < gray.length; i += 1) {
      if (gray[i] < min) min = gray[i];
      if (gray[i] > max) max = gray[i];
    }
    if (max - min < 28) return null;
    var mid = (min + max) / 2;
    var out = new Uint8Array(gray.length);
    for (i = 0; i < gray.length; i += 1) out[i] = gray[i] < mid ? 1 : 0;
    return out;
  }

  function binarizeLocal(gray) {
    var width = gray.length;
    var radius = Math.max(12, Math.floor(width / 14));
    var prefix = new Uint32Array(width + 1);
    var min = 255;
    var max = 0;
    var i;
    for (i = 0; i < width; i += 1) {
      prefix[i + 1] = prefix[i] + gray[i];
      if (gray[i] < min) min = gray[i];
      if (gray[i] > max) max = gray[i];
    }
    if (max - min < 28) return null;
    var out = new Uint8Array(width);
    for (i = 0; i < width; i += 1) {
      var from = Math.max(0, i - radius);
      var to = Math.min(width, i + radius + 1);
      var avg = (prefix[to] - prefix[from]) / (to - from);
      out[i] = gray[i] < avg - 8 ? 1 : 0;
    }
    return out;
  }

  function unitsFor(widths) {
    var sum = widths[0] + widths[1] + widths[2] + widths[3];
    if (sum <= 0) return null;
    var units = [];
    var total = 0;
    var k;
    for (k = 0; k < 4; k += 1) {
      units[k] = Math.max(1, Math.round(widths[k] * 7 / sum));
      total += units[k];
    }
    var guard = 0;
    while (total !== 7 && guard < 5) {
      var best = 0;
      var bestErr = -1;
      for (k = 0; k < 4; k += 1) {
        var ideal = widths[k] * 7 / sum;
        var err = Math.abs(ideal - units[k]);
        var canShrink = total > 7 && units[k] > 1;
        var canGrow = total < 7;
        if ((canShrink || canGrow) && err >= bestErr) {
          bestErr = err;
          best = k;
        }
      }
      if (bestErr < 0) return null;
      units[best] += total > 7 ? -1 : 1;
      total = units[0] + units[1] + units[2] + units[3];
      guard += 1;
    }
    if (total !== 7) return null;
    return units;
  }

  function readDigit(runs, index, module, mode) {
    if (index + 3 >= runs.length) return null;
    var widths = [
      runs[index].width,
      runs[index + 1].width,
      runs[index + 2].width,
      runs[index + 3].width
    ];
    var sum = widths[0] + widths[1] + widths[2] + widths[3];
    if (sum < module * 7 * 0.45 || sum > module * 7 * 1.75) return null;
    var units = unitsFor(widths);
    if (!units) return null;
    var bits = '';
    var k;
    var n;
    for (k = 0; k < 4; k += 1) {
      var bit = runs[index + k].black ? '1' : '0';
      for (n = 0; n < units[k]; n += 1) bits += bit;
    }
    var found = matchDigit(bits, mode);
    if (!found) return null;
    return { digit: found.d, parity: found.p, next: index + 4, module: sum / 7 };
  }

  function readGuard(runs, index, pattern, module) {
    var sum = 0;
    var k;
    for (k = 0; k < pattern.length; k += 1) {
      var run = runs[index + k];
      if (!run || run.black !== pattern[k]) return null;
      if (module && (run.width < module * 0.35 || run.width > module * 2.6)) return null;
      sum += run.width;
    }
    var size = sum / pattern.length;
    if (!(size > 0)) return null;
    return { next: index + pattern.length, module: size };
  }

  function readSymbol(runs, start, kind) {
    var guard = readGuard(runs, start, [true, false, true], 0);
    if (!guard) return '';
    var module = guard.module;
    if (module < 0.8) return '';
    if (!alike(runs[start].width, runs[start + 1].width) || !alike(runs[start].width, runs[start + 2].width)) return '';
    if (start > 0) {
      var quiet = runs[start - 1];
      if (quiet.black || quiet.width < module * 1.5) return '';
    }
    var count = kind === 8 ? 4 : 6;
    var index = guard.next;
    var left = '';
    var parity = '';
    var i;
    for (i = 0; i < count; i += 1) {
      var digit = readDigit(runs, index, module, kind === 8 ? 'L' : 'LG');
      if (!digit) return '';
      if (kind === 8 && digit.parity !== 'L') return '';
      left += String(digit.digit);
      parity += digit.parity;
      index = digit.next;
      module = digit.module;
    }
    var center = readGuard(runs, index, [false, true, false, true, false], module);
    if (!center) return '';
    index = center.next;
    module = center.module;
    var right = '';
    for (i = 0; i < count; i += 1) {
      var part = readDigit(runs, index, module, 'R');
      if (!part || part.parity !== 'R') return '';
      right += String(part.digit);
      index = part.next;
      module = part.module;
    }
    var end = readGuard(runs, index, [true, false, true], module);
    if (!end) return '';
    var code = '';
    if (kind === 13) {
      var first = FAMILY.indexOf(parity);
      if (first < 0) return '';
      code = String(first) + left + right;
    } else {
      code = left + right;
    }
    return checksumOk(code) ? code : '';
  }

  function scanRuns(runs) {
    var i;
    for (i = 0; i < runs.length; i += 1) {
      if (!runs[i].black) continue;
      var ean13 = readSymbol(runs, i, 13);
      if (ean13) return ean13;
      var ean8 = readSymbol(runs, i, 8);
      if (ean8) return ean8;
    }
    return '';
  }

  function decodeBits(bits) {
    if (!bits) return '';
    return scanRuns(toRuns(bits));
  }

  function reverseGray(gray) {
    var out = new Uint8Array(gray.length);
    var i;
    for (i = 0; i < gray.length; i += 1) out[i] = gray[gray.length - 1 - i];
    return out;
  }

  function decodeGray(gray) {
    return decodeBits(binarize(gray)) || decodeBits(binarizeLocal(gray)) || '';
  }

  function rowLuma(data, width, y) {
    var gray = new Uint8Array(width);
    var base = y * width * 4;
    var x;
    for (x = 0; x < width; x += 1) {
      var i = base + x * 4;
      gray[x] = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) >> 8;
    }
    return gray;
  }

  function decode(image) {
    if (!image || !image.data || image.width < 20 || image.height < 8) return '';
    var width = image.width | 0;
    var height = image.height | 0;
    var y0 = Math.floor(height * 0.15);
    var y1 = Math.ceil(height * 0.85);
    var step = Math.max(1, Math.floor((y1 - y0) / 28));
    var votes = Object.create(null);
    var y;
    for (y = y0; y < y1; y += step) {
      var gray = rowLuma(image.data, width, y);
      var code = decodeGray(gray) || decodeGray(reverseGray(gray));
      if (code) votes[code] = (votes[code] || 0) + 1;
    }
    var best = '';
    var bestN = 0;
    var key;
    for (key in votes) {
      if (votes[key] > bestN) {
        best = key;
        bestN = votes[key];
      }
    }
    return bestN >= 2 ? best : '';
  }

  return {
    encode: encode,
    decode: decode,
    checksumOk: checksumOk
  };
});
