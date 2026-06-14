// Bağımlılıksız minimal XLSX okuyucu — zip merkezi dizinini okuyup sheet+sharedStrings'i çözer
const fs = require('fs');
const zlib = require('zlib');

function readZipEntries(buf) {
  // EOCD bul
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP EOCD bulunamadı');
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries[name] = { method, compSize, localOff };
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, e) {
  // yerel başlık: 30 + nameLen + extraLen
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + e.compSize);
  if (e.method === 0) return data;
  return zlib.inflateRawSync(data);
}

function colToNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t, s = '';
    while ((t = tRe.exec(m[1]))) s += t[1];
    out.push(decodeXml(s));
  }
  return out;
}

function decodeXml(s) {
  return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'");
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rIdx = parseInt(rm[1], 10) - 1;
    const cells = [];
    const cRe = /<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>|<c[^>]*r="([A-Z]+)\d+"([^>]*)\/>/g;
    let cm;
    while ((cm = cRe.exec(rm[2]))) {
      const col = cm[1] || cm[4];
      const attrs = (cm[2] || cm[5]) || '';
      const inner = cm[3] || '';
      const ci = colToNum(col);
      let val = '';
      const isShared = /t="s"/.test(attrs);
      const isInline = /t="inlineStr"/.test(attrs);
      const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (isInline) { const tM = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); val = tM ? decodeXml(tM[1]) : ''; }
      else if (vM) { val = isShared ? (shared[parseInt(vM[1],10)] ?? '') : vM[1]; }
      cells[ci] = val;
    }
    rows[rIdx] = cells;
  }
  return rows;
}

function readWorkbook(path) {
  const buf = fs.readFileSync(path);
  const entries = readZipEntries(buf);
  const shared = entries['xl/sharedStrings.xml']
    ? parseSharedStrings(extractEntry(buf, entries['xl/sharedStrings.xml']).toString('utf8')) : [];
  // workbook.xml → sheet adları + rId; workbook.xml.rels → rId → dosya
  const wbXml = entries['xl/workbook.xml'] ? extractEntry(buf, entries['xl/workbook.xml']).toString('utf8') : '';
  const relsXml = entries['xl/_rels/workbook.xml.rels'] ? extractEntry(buf, entries['xl/_rels/workbook.xml.rels']).toString('utf8') : '';
  const relMap = {};
  let rm; const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  while ((rm = relRe.exec(relsXml))) relMap[rm[1]] = rm[2];
  const sheets = [];
  let sm; const shRe = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g;
  while ((sm = shRe.exec(wbXml))) {
    let target = relMap[sm[2]] || '';
    if (target && !target.startsWith('xl/')) target = 'xl/' + target.replace(/^\//,'');
    sheets.push({ name: decodeXml(sm[1]), path: target });
  }
  return { buf, entries, shared, sheets };
}

function sheetRows(wb, sheetPath) {
  const e = wb.entries[sheetPath];
  if (!e) return [];
  return parseSheet(extractEntry(wb.buf, e).toString('utf8'), wb.shared);
}

module.exports = { readWorkbook, sheetRows };

// CLI test: node xlsx-read.js <path> [sheetIndex]
if (require.main === module) {
  const path = process.argv[2];
  const wb = readWorkbook(path);
  console.log('SHEETS:');
  wb.sheets.forEach((s, i) => console.log('  [' + i + '] ' + s.name + ' -> ' + s.path));
  const idx = process.argv[3] ? parseInt(process.argv[3], 10) : 0;
  if (wb.sheets[idx]) {
    console.log('\n=== ' + wb.sheets[idx].name + ' (ilk 25 satır) ===');
    const rows = sheetRows(wb, wb.sheets[idx].path);
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
      const cells = (rows[r] || []).map(c => (c === undefined ? '' : String(c).slice(0,22)));
      console.log(r + ': ' + cells.join(' | '));
    }
  }
}
