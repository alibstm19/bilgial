'use strict';

/**
 * BilgiAl — küçük QR kod üreticisi (bağımlılıksız).
 *
 * Yalnız **bayt modu**, hata düzeltme düzeyi **M**, sürüm 1–10 destekler.
 * Telefon eşleştirme adresi (`http://<yerel ip>:<port>/?pair=<kod>`) bu aralığa
 * rahatça sığar; daha büyük metinlerde `null` döner (sessizce bozuk kod üretmez).
 *
 * Sözleşme: `docs/contract-v0.md` §7.10. Test: `tests/qr.test.js`.
 */

const EC_LEVEL = 'M';

/** Sürüm 1–10 için toplam kod sözcüğü (veri + ECC). QR spec Table 1. */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** Düzey M: blok başına ECC kod sözcüğü. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];

/** Düzey M: blok başına veri kod sözcüğü (aynı uzunluktaki bloklar). */
const DATA_PER_BLOCK = [0, 16, 28, 44, 32, 43, 27, 31, 38, 36, 43];

/** Düzey M: (kısa blok sayısı, uzun blok sayısı); uzun blok = DATA_PER_BLOCK + 1. */
const BLOCKS = [
  null,
  [1, 0],
  [1, 0],
  [1, 0],
  [2, 0],
  [2, 0],
  [4, 0],
  [4, 0],
  [2, 2],
  [3, 2],
  [4, 1],
];

/** Hizalama deseni merkezleri (sürüm 2–10). */
const ALIGN = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MAX_VERSION = 10;

/** Düzey M format bilgisi bitleri (2 bit). */
const EC_BITS = 0b00;

function utf8Bytes(text) {
  if (typeof TextEncoder === 'function') return Array.from(new TextEncoder().encode(text));
  return Array.from(Buffer.from(text, 'utf8'));
}

/** Bir sürümde bayt moduna sığan en fazla bayt. */
function dataCapacity(version) {
  const [shortBlocks, longBlocks] = BLOCKS[version];
  return shortBlocks * DATA_PER_BLOCK[version] + longBlocks * (DATA_PER_BLOCK[version] + 1);
}

function dataBits(version) {
  return dataCapacity(version) * 8;
}

/** Veriyi sürüme sığdıran en küçük sürüm; sığmazsa `null`. */
function pickVersion(byteLength) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + byteLength * 8 <= dataBits(version)) return version;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bit tamponu
// ---------------------------------------------------------------------------
function bitBuffer() {
  const bits = [];
  return {
    bits,
    push(value, length) {
      for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
    },
    get length() {
      return bits.length;
    },
  };
}

/** Veri kod sözcüklerini üretir (mod + uzunluk + baytlar + dolgu). */
function makeDataCodewords(version, bytes) {
  const buffer = bitBuffer();
  buffer.push(0b0100, 4); // bayt modu
  buffer.push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) buffer.push(byte, 8);

  const capacity = dataBits(version);
  // Sonlandırıcı en fazla 4 sıfır bit.
  const terminator = Math.min(4, capacity - buffer.length);
  buffer.push(0, terminator);
  // Bayt sınırına tamamla.
  while (buffer.length % 8 !== 0) buffer.push(0, 1);

  const codewords = [];
  for (let i = 0; i < buffer.bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | buffer.bits[i + j];
    codewords.push(value);
  }
  // Dolgu baytları 0xEC, 0x11.
  const pad = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < dataCapacity(version)) {
    codewords.push(pad[padIndex % 2]);
    padIndex += 1;
  }
  return codewords;
}

// ---------------------------------------------------------------------------
// Reed–Solomon (GF(256), polinom 0x11D)
// ---------------------------------------------------------------------------
function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

/** Veriyi bloklara böler, ECC üretir ve QR sırasıyla serpiştirir. */
function interleave(version, dataCodewords) {
  const [shortBlocks, longBlocks] = BLOCKS[version];
  const shortLen = DATA_PER_BLOCK[version];
  const eccLen = ECC_PER_BLOCK[version];
  const divisor = rsDivisor(eccLen);

  const blocks = [];
  let offset = 0;
  for (let i = 0; i < shortBlocks + longBlocks; i += 1) {
    const len = shortLen + (i >= shortBlocks ? 1 : 0);
    const data = dataCodewords.slice(offset, offset + len);
    offset += len;
    blocks.push({ data, ecc: rsRemainder(data, divisor) });
  }

  const result = [];
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i]);
    }
  }
  for (let i = 0; i < eccLen; i += 1) {
    for (const block of blocks) result.push(block.ecc[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matris
// ---------------------------------------------------------------------------
function emptyGrid(size) {
  return {
    size,
    cells: Array.from({ length: size }, () => new Array(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function setModule(grid, x, y, dark, isFunction) {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return;
  grid.cells[y][x] = dark ? 1 : 0;
  if (isFunction) grid.reserved[y][x] = true;
}

function drawFinder(grid, cx, cy) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setModule(grid, x, y, dist !== 2 && dist !== 4, true);
    }
  }
}

function drawAlignment(grid, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setModule(grid, cx + dx, cy + dy, dist !== 1, true);
    }
  }
}

function drawFunctionPatterns(grid, version) {
  const size = grid.size;
  // Zamanlama desenleri.
  for (let i = 0; i < size; i += 1) {
    setModule(grid, 6, i, i % 2 === 0, true);
    setModule(grid, i, 6, i % 2 === 0, true);
  }
  // Bulucu desenleri (+ ayırıcılar).
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  // Hizalama desenleri (bulucularla çakışanlar atlanır).
  const centers = ALIGN[version] || [];
  for (let i = 0; i < centers.length; i += 1) {
    for (let j = 0; j < centers.length; j += 1) {
      const last = centers.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      drawAlignment(grid, centers[i], centers[j]);
    }
  }
  // Karanlık modül.
  setModule(grid, 8, size - 8, true, true);
  // Format bilgisi alanları (maskeden bağımsız rezerve edilir).
  drawFormatBits(grid, 0, true);
  if (version >= 7) drawVersionBits(grid, version);
}

/** 15 bitlik format bilgisi: 5 bit veri + 10 bit BCH, 0x5412 ile maskelenir. */
function formatBits(mask) {
  const data = (EC_BITS << 3) | mask;
  let rest = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if (((rest >>> i) & 1) === 1) rest ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rest) ^ 0x5412;
}

function drawFormatBits(grid, mask, reserveOnly) {
  const size = grid.size;
  const bits = reserveOnly ? 0 : formatBits(mask);
  const get = (index) => (reserveOnly ? false : ((bits >>> index) & 1) === 1);
  // Sol üst blok.
  for (let i = 0; i <= 5; i += 1) setModule(grid, 8, i, get(i), true);
  setModule(grid, 8, 7, get(6), true);
  setModule(grid, 8, 8, get(7), true);
  setModule(grid, 7, 8, get(8), true);
  for (let i = 9; i < 15; i += 1) setModule(grid, 14 - i, 8, get(i), true);
  // Sağ üst ve sol alt kopyalar.
  for (let i = 0; i < 8; i += 1) setModule(grid, size - 1 - i, 8, get(i), true);
  for (let i = 8; i < 15; i += 1) setModule(grid, 8, size - 15 + i, get(i), true);
}

/** 18 bitlik sürüm bilgisi (sürüm ≥ 7): 6 bit veri + 12 bit BCH (0x1F25). */
function versionBits(version) {
  let rest = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if (((rest >>> i) & 1) === 1) rest ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rest;
}

function drawVersionBits(grid, version) {
  const bits = versionBits(version);
  const size = grid.size;
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setModule(grid, a, b, bit, true);
    setModule(grid, b, a, bit, true);
  }
}

/** Veri bitlerini zikzak sırayla yerleştirir (maskeden önce). */
function placeData(grid, codewords) {
  const size = grid.size;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (grid.reserved[y][x]) continue;
        let value = 0;
        if (bitIndex < totalBits) {
          value = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
        }
        grid.cells[y][x] = value;
        bitIndex += 1;
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid, mask) {
  const fn = MASKS[mask];
  for (let y = 0; y < grid.size; y += 1) {
    for (let x = 0; x < grid.size; x += 1) {
      if (grid.reserved[y][x]) continue;
      if (fn(x, y)) grid.cells[y][x] ^= 1;
    }
  }
}

/** Standart ceza kuralları (N1=3, N2=3, N3=40, N4=10). */
function penalty(grid) {
  const size = grid.size;
  const at = (x, y) => (grid.cells[y][x] === 1 ? 1 : 0);
  let score = 0;

  const lineScore = (get) => {
    let total = 0;
    for (let a = 0; a < size; a += 1) {
      let runColor = -1;
      let runLength = 0;
      for (let b = 0; b < size; b += 1) {
        const color = get(a, b);
        if (color === runColor) {
          runLength += 1;
        } else {
          if (runLength >= 5) total += 3 + (runLength - 5);
          runColor = color;
          runLength = 1;
        }
      }
      if (runLength >= 5) total += 3 + (runLength - 5);
    }
    return total;
  };
  score += lineScore((y, x) => at(x, y));
  score += lineScore((x, y) => at(x, y));

  // 2x2 aynı renk blokları.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  }

  // 1:1:3:1:1 bulucu benzeri desen.
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const matches = (get, a, b) => {
    for (let k = 0; k < pattern.length; k += 1) {
      if (get(a, b + k) !== pattern[k]) return false;
    }
    // Önünde/sonunda 4 açık modül var mı?
    const before = (b - 4 >= 0);
    const after = (b + 11 <= size);
    let clearBefore = true;
    let clearAfter = true;
    if (before) {
      for (let k = 1; k <= 4; k += 1) if (get(a, b - k) !== 0) clearBefore = false;
    }
    if (after) {
      for (let k = 7; k <= 10; k += 1) if (get(a, b + k) !== 0) clearAfter = false;
    }
    return (before && clearBefore) || (after && clearAfter);
  };
  for (let a = 0; a < size; a += 1) {
    for (let b = 0; b + 7 <= size; b += 1) {
      if (matches((y, x) => at(x, y), a, b)) score += 40;
      if (matches((x, y) => at(x, y), a, b)) score += 40;
    }
  }

  // Koyu modül oranı.
  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) dark += at(x, y);
  }
  const total = size * size;
  const percent = (dark * 100) / total;
  const step = Math.floor(Math.abs(percent - 50) / 5);
  score += step * 10;
  return score;
}

function cloneGrid(grid) {
  return {
    size: grid.size,
    cells: grid.cells.map((row) => row.slice()),
    reserved: grid.reserved.map((row) => row.slice()),
  };
}

/**
 * Metni QR matrisine çevirir.
 * @param {string} text
 * @returns {{version:number,size:number,ecLevel:string,mask:number,modules:boolean[][]}|null}
 */
function encode(text, options) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  if (version === null) return null;
  const size = version * 4 + 17;

  const data = makeDataCodewords(version, bytes);
  const codewords = interleave(version, data);

  const base = emptyGrid(size);
  drawFunctionPatterns(base, version);
  placeData(base, codewords);

  // Test/görsel karşılaştırma için maske sabitlenebilir; normalde ceza puanı seçer.
  const forced = options && Number.isInteger(options.mask) ? options.mask : null;
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    if (forced !== null && mask !== forced) continue;
    const candidate = cloneGrid(base);
    applyMask(candidate, mask);
    drawFormatBits(candidate, mask, false);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { mask, score, grid: candidate };
  }

  const modules = best.grid.cells.map((row) => row.map((value) => value === 1));
  return { version, size, ecLevel: EC_LEVEL, mask: best.mask, modules };
}

/**
 * Matrisi tek bir SVG `path` çizimine çevirir (4 modül sessiz kenar).
 * @param {boolean[][]} modules
 * @param {{border?:number}} [options]
 * @returns {{size:number,path:string}}
 */
function toSvgPath(modules, options) {
  const border = options && Number.isInteger(options.border) ? options.border : 4;
  const rows = Array.isArray(modules) ? modules.length : 0;
  if (rows === 0) return { size: 0, path: '' };
  const size = rows + border * 2;
  const parts = [];
  for (let y = 0; y < rows; y += 1) {
    const row = modules[y] || [];
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run += 1;
      parts.push(`M${x + border} ${y + border}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return { size, path: parts.join('') };
}

module.exports = {
  EC_LEVEL,
  MAX_VERSION,
  TOTAL_CODEWORDS,
  ECC_PER_BLOCK,
  DATA_PER_BLOCK,
  BLOCKS,
  ALIGN,
  dataCapacity,
  pickVersion,
  formatBits,
  versionBits,
  rsDivisor,
  rsRemainder,
  interleave,
  encode,
  toSvgPath,
  MASKS,
};
