// ALBRUS SUNUCU — çoklu kullanıcı / uzaktan erişim için merkezi API
// Node built-in http + sql.js (ekstra kurulum yok). Bulutta veya ofis PC'sinde çalışır.
// Çalıştırma:  node albrus-sunucu/server.js   (varsayılan port 4000)
// Ortam değişkenleri: PORT, ALBRUS_SECRET (token imza sırrı)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('../albrus-firma/node_modules/sql.js');

const PORT = process.env.PORT || 4000;
const SECRET = process.env.ALBRUS_SECRET || 'albrus-degistir-bu-sirri-uretimde';
const DB_PATH = path.join(__dirname, 'data.db');

let SQL, db;
function saveDb() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
function run(sql, params = []) { db.run(sql, params); }
function getAll(sql, params = []) {
  const st = db.prepare(sql); st.bind(params); const rows = [];
  while (st.step()) rows.push(st.getAsObject()); st.free(); return rows;
}
function getOne(sql, params = []) { const r = getAll(sql, params); return r[0] || null; }
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ── Token (imzalı, oturum saklamaya gerek yok) ──
function tokenUret(user) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, rol: user.rol, exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function tokenCoz(token) {
  if (!token) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const beklenen = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig !== beklenen) return null;
  try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString()); if (p.exp < Date.now()) return null; return p; }
  catch (_) { return null; }
}

// ── Şema + ilk kurulum ──
function semaKur() {
  run(`CREATE TABLE IF NOT EXISTS kullanicilar (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kullanici_adi TEXT UNIQUE NOT NULL,
    ad TEXT DEFAULT '', sifre_hash TEXT NOT NULL, rol TEXT DEFAULT 'kullanici',
    izinler TEXT DEFAULT '[]', aktif INTEGER DEFAULT 1)`);
  run(`CREATE TABLE IF NOT EXISTS kasalar (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ad TEXT NOT NULL, para_birimi TEXT DEFAULT 'IQD', bakiye REAL DEFAULT 0)`);
  run(`CREATE TABLE IF NOT EXISTS kasa_hareketleri (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kasa_id INTEGER NOT NULL, tarih TEXT, tur TEXT,
    tutar REAL DEFAULT 0, aciklama TEXT DEFAULT '', kullanici_id INTEGER)`);
  // ilk admin + varsayılan kasalar
  if (!getOne('SELECT 1 FROM kullanicilar LIMIT 1')) {
    run("INSERT INTO kullanicilar (kullanici_adi, ad, sifre_hash, rol, izinler) VALUES ('admin','Yönetici',?,'admin','[]')", [sha256('admin')]);
    run("INSERT INTO kasalar (ad, para_birimi) VALUES ('IQD Kasa','IQD'), ('USD Kasa','USD')");
    saveDb();
  }
}

const TUM_MODULLER = ['kasa', 'banka', 'cariler', 'faturalar', 'stok', 'projeler', 'personel', 'ortaklar', 'cek', 'hakedis', 'raporlar', 'ayarlar'];
function izinVar(user, modul) {
  if (user.rol === 'admin') return true;
  try { return JSON.parse(user.izinler || '[]').includes(modul); } catch (_) { return false; }
}

// ── HTTP yardımcıları ──
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } }); });
}
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const p = tokenCoz(h.replace(/^Bearer\s+/i, ''));
  if (!p) return null;
  return getOne('SELECT * FROM kullanicilar WHERE id = ? AND aktif = 1', [p.uid]);
}

// ── Sunucu ──
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  const url = new URL(req.url, 'http://x');
  const yol = url.pathname;

  try {
    // sağlık
    if (yol === '/api/saglik') return json(res, 200, { ok: true, sunucu: 'albrus', sürüm: 1 });

    // giriş
    if (yol === '/api/login' && req.method === 'POST') {
      const b = await body(req);
      const u = getOne('SELECT * FROM kullanicilar WHERE kullanici_adi = ? AND aktif = 1', [b.kullanici || '']);
      if (!u || u.sifre_hash !== sha256(b.sifre || '')) return json(res, 401, { hata: 'Kullanıcı adı veya parola hatalı.' });
      return json(res, 200, { token: tokenUret(u), kullanici: { id: u.id, ad: u.ad, kullanici_adi: u.kullanici_adi, rol: u.rol, izinler: JSON.parse(u.izinler || '[]') } });
    }

    // buradan sonrası kimlik ister
    const user = authUser(req);
    if (!user) return json(res, 401, { hata: 'Giriş gerekli.' });

    // kullanıcı yönetimi (sadece admin)
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

    // ── KASA (örnek modül, RBAC korumalı) ──
    if (yol === '/api/kasalar' && req.method === 'GET') {
      if (!izinVar(user, 'kasa')) return json(res, 403, { hata: 'Kasa yetkiniz yok.' });
      return json(res, 200, getAll('SELECT * FROM kasalar ORDER BY id'));
    }
    if (yol === '/api/kasa/hareketler' && req.method === 'GET') {
      if (!izinVar(user, 'kasa')) return json(res, 403, { hata: 'Kasa yetkiniz yok.' });
      return json(res, 200, getAll('SELECT * FROM kasa_hareketleri WHERE kasa_id = ? ORDER BY id DESC', [Number(url.searchParams.get('kasa_id')) || 0]));
    }
    if (yol === '/api/kasa/fis' && req.method === 'POST') {
      if (!izinVar(user, 'kasa')) return json(res, 403, { hata: 'Kasa yetkiniz yok.' });
      const b = await body(req);
      const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [b.kasa_id]);
      if (!kasa) return json(res, 400, { hata: 'Kasa bulunamadı.' });
      const giris = b.tur === 'tahsilat' || b.tur === 'giris';
      const tutar = Number(b.tutar) || 0;
      run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, kullanici_id) VALUES (?,?,?,?,?,?)',
        [b.kasa_id, b.tarih || new Date().toISOString().slice(0, 10), b.tur || 'tahsilat', tutar, b.aciklama || '', user.id]);
      run('UPDATE kasalar SET bakiye = bakiye + ? WHERE id = ?', [giris ? tutar : -tutar, b.kasa_id]);
      saveDb();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { hata: 'Bulunamadı: ' + yol });
  } catch (e) {
    return json(res, 500, { hata: e.message });
  }
});

(async () => {
  SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  semaKur();
  server.listen(PORT, () => {
    console.log(`ALBRUS sunucu çalışıyor → http://localhost:${PORT}`);
    console.log(`İlk giriş: kullanıcı "admin", parola "admin" (sonra değiştirin).`);
  });
})();
