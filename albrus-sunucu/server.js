// ALBRUS SUNUCU — çoklu kullanıcı / uzaktan erişim için merkezi API
// Node built-in http + sql.js. İş mantığı core.js'ten (main.js'ten üretilir → tek kaynak).
// Çalıştırma:  node albrus-sunucu/server.js   (varsayılan port 4000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('../albrus-firma/node_modules/sql.js');
const createCore = require('./core.js');

const PORT = process.env.PORT || 4000;
const SECRET = process.env.ALBRUS_SECRET || 'albrus-degistir-bu-sirri-uretimde';
const DB_PATH = path.join(__dirname, 'data.db');

let SQL, db, H;
function saveDb() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
function run(sql, params = []) { db.run(sql, params); }
function getAll(sql, params = []) {
  const st = db.prepare(sql); st.bind(params); const rows = [];
  while (st.step()) rows.push(st.getAsObject()); st.free(); return rows;
}
function getOne(sql, params = []) { const r = getAll(sql, params); return r[0] || null; }
function insertAndGet(table, sql, params = []) {
  db.run(sql, params);
  const id = getOne('SELECT last_insert_rowid() AS id').id;
  return getOne(`SELECT * FROM ${table} WHERE id = ?`, [id]);
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ── Token ──
function tokenUret(u) {
  const payload = Buffer.from(JSON.stringify({ uid: u.id, rol: u.rol, exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function tokenCoz(t) {
  if (!t) return null;
  const [p, s] = String(t).split('.');
  if (!p || !s || s !== crypto.createHmac('sha256', SECRET).update(p).digest('base64url')) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp < Date.now() ? null : o; } catch { return null; }
}

// ── Şema + ilk kurulum ──
function semaKur() {
  db.run(createCore.SEMA);   // main.js'ten gelen TÜM tablolar
  for (const alt of (createCore.MIGRATIONS || [])) { try { db.run(alt); } catch (_) {} }  // sonradan eklenen kolonlar
  db.run(`CREATE TABLE IF NOT EXISTS kullanicilar (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kullanici_adi TEXT UNIQUE NOT NULL,
    ad TEXT DEFAULT '', sifre_hash TEXT NOT NULL, rol TEXT DEFAULT 'kullanici',
    izinler TEXT DEFAULT '[]', aktif INTEGER DEFAULT 1)`);
  if (!getOne('SELECT 1 FROM kullanicilar LIMIT 1')) {
    run("INSERT INTO kullanicilar (kullanici_adi, ad, sifre_hash, rol, izinler) VALUES ('admin','Yönetici',?,'admin','[]')", [sha256('admin')]);
  }
  if (!getOne('SELECT 1 FROM kasalar LIMIT 1')) {
    run("INSERT INTO kasalar (ad, para_birimi) VALUES ('IQD Kasa','IQD'), ('USD Kasa','USD')");
  }
  if (!getOne("SELECT 1 FROM ayarlar WHERE anahtar='usd_iqd_kuru'")) {
    run("INSERT INTO ayarlar (anahtar, deger) VALUES ('usd_iqd_kuru','1310')");
  }
  saveDb();
}

// ── Kanal → modül (RBAC). null = her giriş yapana açık ──
function kanalModul(ch) {
  if (ch.startsWith('kasa') || ch === 'hesap:transfer' || ch === 'sonraki:fis:no') return 'kasa';
  if (ch.startsWith('banka')) return 'banka';
  if (ch.startsWith('cari')) return 'cariler';
  if (ch.startsWith('fatura') || ch === 'sonraki:fatura:no') return 'faturalar';
  if (ch.startsWith('stok')) return 'stok';
  if (ch.startsWith('proje')) return 'projeler';
  if (ch.startsWith('personel') || ch.startsWith('puantaj') || ch.startsWith('maas')) return 'personel';
  if (ch.startsWith('ortak')) return 'ortaklar';
  if (ch.startsWith('cek')) return 'cek';
  if (/^(hakedis|yesil|icmal|ilave|kesinti|arkakapak|progress)/.test(ch)) return 'hakedis';
  return null; // ayar, dashboard, kategoriler, rapor:* → herkese
}
function izinVar(user, modul) {
  if (!modul) return true;
  if (user.rol === 'admin') return true;
  try { return JSON.parse(user.izinler || '[]').includes(modul); } catch { return false; }
}
// Yazma içeren kanallar admin-dışı için ayar:kaydet'i kısıtla (firma/lisans/sunucu ayarı admin işi)
const KORUMALI_AYAR = new Set(['firma_adi']);

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  res.end(JSON.stringify(obj));
}
function body(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(d ? JSON.parse(d) : {}); } catch { r({}); } }); }); }
function authUser(req) {
  const p = tokenCoz((req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''));
  return p ? getOne('SELECT * FROM kullanicilar WHERE id = ? AND aktif = 1', [p.uid]) : null;
}

// ── Mobil PWA statik dosyaları (albrus-sunucu/mobil) ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8' };
function statik(res, yol) {
  let dosya = yol === '/' ? 'index.html' : yol.replace(/^\/(mobil\/)?/, '');
  dosya = dosya.replace(/\.\.+/g, '');                 // dizin çıkışını engelle
  const tam = path.join(__dirname, 'mobil', dosya);
  if (!tam.startsWith(path.join(__dirname, 'mobil')) || !fs.existsSync(tam)) return json(res, 404, { hata: 'Bulunamadı' });
  const ext = path.extname(tam).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  res.end(fs.readFileSync(tam));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  const url = new URL(req.url, 'http://x');
  const yol = url.pathname;
  try {
    if (yol === '/api/saglik') return json(res, 200, { ok: true, sunucu: 'albrus', sürüm: 2 });
    // Mobil PWA dosyaları (giriş gerektirmez; veri /api/invoke ile token'lı gelir)
    if (req.method === 'GET' && (yol === '/' || yol === '/manifest.json' || yol === '/sw.js' || yol.startsWith('/mobil')))
      return statik(res, yol);

    if (yol === '/api/login' && req.method === 'POST') {
      const b = await body(req);
      const u = getOne('SELECT * FROM kullanicilar WHERE kullanici_adi = ? AND aktif = 1', [b.kullanici || '']);
      if (!u || u.sifre_hash !== sha256(b.sifre || '')) return json(res, 401, { hata: 'Kullanıcı adı veya parola hatalı.' });
      return json(res, 200, { token: tokenUret(u), kullanici: { id: u.id, ad: u.ad, kullanici_adi: u.kullanici_adi, rol: u.rol, izinler: JSON.parse(u.izinler || '[]') } });
    }

    const user = authUser(req);
    if (!user) return json(res, 401, { hata: 'Giriş gerekli.' });

    // Kullanıcı yönetimi (admin)
    if (yol === '/api/kullanicilar' && req.method === 'GET') {
      if (user.rol !== 'admin') return json(res, 403, { hata: 'Yetkiniz yok.' });
      return json(res, 200, getAll('SELECT id, kullanici_adi, ad, rol, izinler, aktif FROM kullanicilar ORDER BY id').map(u => ({ ...u, izinler: JSON.parse(u.izinler || '[]') })));
    }
    if (yol === '/api/kullanici' && req.method === 'POST') {
      if (user.rol !== 'admin') return json(res, 403, { hata: 'Yetkiniz yok.' });
      const b = await body(req);
      const izin = JSON.stringify(Array.isArray(b.izinler) ? b.izinler : []);
      if (b.id) {
        if (b.sifre) run('UPDATE kullanicilar SET ad=?, rol=?, izinler=?, aktif=?, sifre_hash=? WHERE id=?', [b.ad || '', b.rol || 'kullanici', izin, b.aktif ? 1 : 0, sha256(b.sifre), b.id]);
        else run('UPDATE kullanicilar SET ad=?, rol=?, izinler=?, aktif=? WHERE id=?', [b.ad || '', b.rol || 'kullanici', izin, b.aktif ? 1 : 0, b.id]);
      } else {
        if (getOne('SELECT 1 FROM kullanicilar WHERE kullanici_adi=?', [b.kullanici_adi])) return json(res, 400, { hata: 'Bu kullanıcı adı zaten var.' });
        run('INSERT INTO kullanicilar (kullanici_adi, ad, sifre_hash, rol, izinler) VALUES (?,?,?,?,?)', [b.kullanici_adi, b.ad || '', sha256(b.sifre || '1234'), b.rol || 'kullanici', izin]);
      }
      saveDb();
      return json(res, 200, { ok: true });
    }

    // ── Genel köprü: tüm veri kanalları (core.js handler'ları) ──
    if (yol === '/api/invoke' && req.method === 'POST') {
      const { channel, args } = await body(req);
      if (!H[channel]) return json(res, 404, { hata: 'Bilinmeyen kanal: ' + channel });
      if (!izinVar(user, kanalModul(channel))) return json(res, 403, { hata: 'Bu bölüm için yetkiniz yok.' });
      // ayar yazımı: kritik ayarları yalnız admin değiştirsin
      if (channel === 'ayar:kaydet' && user.rol !== 'admin' && KORUMALI_AYAR.has((args || [])[0])) return json(res, 403, { hata: 'Bu ayarı yalnız yönetici değiştirebilir.' });
      const sonuc = H[channel](null, ...(args || []));
      return json(res, 200, { sonuc });
    }

    return json(res, 404, { hata: 'Bulunamadı: ' + yol });
  } catch (e) {
    return json(res, 400, { hata: e.message });
  }
});

(async () => {
  SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  H = createCore({ run, getAll, getOne, insertAndGet, saveDb });
  semaKur();
  server.listen(PORT, () => {
    console.log(`ALBRUS sunucu çalışıyor → http://localhost:${PORT}  (sürüm 2, ${Object.keys(H).length} kanal)`);
    console.log(`İlk giriş: kullanıcı "admin", parola "admin".`);
  });
})();
