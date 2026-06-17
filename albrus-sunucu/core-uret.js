// core.js ÜRETİCİ — main.js'ten tüm veri handler'larını + şema + yardımcıları çıkarır.
// main.js değişince çalıştır:  node albrus-sunucu/core-uret.js
// Böylece sunucu, masaüstü ile AYNI iş mantığını kullanır (tek kaynak: main.js).

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'albrus-firma', 'main.js'), 'utf8');

// Electron'a özgü (sunucuda çalışamaz) — atlanır; istemci bunları yerelde çağırır
const ELECTRON = new Set(['print:pdf', 'export:xls', 'xlsx:onizle', 'win:focus',
  'db:konum', 'db:yedekle', 'db:geri-yukle', 'lisans:durum', 'lisans:aktiflestir']);

// String/yorum-duyarlı: idx'teki '(' ile eşleşen ')' indexini bul
function matchParen(s, open) {
  let depth = 0, i = open, str = null;
  for (; i < s.length; i++) {
    const c = s[i], p = s[i - 1];
    if (str) {
      if (c === str && p !== '\\') str = null;
      else if (str === '`' && c === '$' && s[i + 1] === '{') { /* basit */ }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Tüm ipcMain.handle(...) çağrılarını yakala
const handlers = [];
const re = /ipcMain\.handle\(/g; let m;
while ((m = re.exec(src))) {
  const open = m.index + 'ipcMain.handle'.length;   // '(' konumu
  const close = matchParen(src, open);
  if (close < 0) continue;
  const inner = src.slice(open + 1, close);          // "'ch', fn"
  const chM = /^\s*['"]([^'"]+)['"]\s*,/.exec(inner);
  if (!chM) continue;
  const ch = chM[1];
  if (ELECTRON.has(ch)) continue;
  const fn = inner.slice(chM[0].length).trim();      // handler fonksiyonu (verbatim)
  handlers.push({ ch, fn });
  re.lastIndex = close;
}

// Yardımcı fonksiyon/sabitleri main.js'ten al (handler'lar bunları kullanıyor)
function grab(reg) { const r = reg.exec(src); return r ? r[0] : ''; }
const GIRIS = grab(/const GIRIS_TIPLERI = new Set\([^;]*\);/s);
const BANKA = grab(/const BANKA_TRANSFER_TUR = new Set\([^;]*\);/s);
function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const open = src.indexOf('(', i);
  const bodyOpen = src.indexOf('{', matchParen(src, open));
  // gövde { } eşle
  let depth = 0, j = bodyOpen, str = null;
  for (; j < src.length; j++) {
    const c = src[j], p = src[j - 1];
    if (str) { if (c === str && p !== '\\') str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
const HELPERS = ['isGiris', 'yesilOncekiToplam', 'hesaplaIcmal', 'tutarToplam', 'cekHareketGeriAl'].map(grabFn).filter(Boolean).join('\n\n');

// Şema — CREATE TABLE içeren TÜM db.run(`...`) bloklarını topla (şema 8 bloğa bölünmüş)
let SEMA = '';
const semaRe = /db\.run\(`([\s\S]*?)`\)/g; let sm;
while ((sm = semaRe.exec(src))) {
  if (/CREATE TABLE/.test(sm[1])) SEMA += sm[1] + '\n';
}
// Migration'lar — db.run("ALTER TABLE ...") ifadeleri (sonradan eklenen kolonlar)
const MIGRATIONS = [];
const altRe = /db\.run\(\s*"(ALTER TABLE[^"]+)"\s*\)/g; let am;
while ((am = altRe.exec(src))) MIGRATIONS.push(am[1]);

const out = `// OTOMATİK ÜRETİLDİ — elle düzenleme! Kaynak: albrus-firma/main.js
// Yeniden üret:  node albrus-sunucu/core-uret.js
module.exports = function createCore(ctx) {
  const { run, getAll, getOne, insertAndGet, saveDb } = ctx;
  ${GIRIS}
  ${BANKA}
  ${HELPERS}
  const H = {};
${handlers.map(h => `  H[${JSON.stringify(h.ch)}] = ${h.fn};`).join('\n')}
  return H;
};
module.exports.SEMA = ${JSON.stringify(SEMA)};
module.exports.MIGRATIONS = ${JSON.stringify(MIGRATIONS)};
`;

fs.writeFileSync(path.join(__dirname, 'core.js'), out);
console.log('core.js üretildi:', handlers.length, 'handler,', MIGRATIONS.length, 'migration,', HELPERS ? 'yardımcılar var' : 'yardımcı YOK', SEMA ? ', şema var' : ', ŞEMA YOK');
console.log('Kanallar:', handlers.map(h => h.ch).join(', '));
