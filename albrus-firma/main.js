const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let db;
let SQL;
const dbPath = () => path.join(app.getPath('userData'), 'albrus.db');

// ── Veritabanı kaydet ─────────────────────────────────────────
function saveDb() {
  const data = db.export();
  fs.writeFileSync(dbPath(), Buffer.from(data));
}

// ── Veritabanı başlat ─────────────────────────────────────────
async function initDb() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  const p = dbPath();
  if (fs.existsSync(p)) {
    const fileBuffer = fs.readFileSync(p);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS kasalar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      para_birimi TEXT NOT NULL DEFAULT 'IQD',
      bakiye REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS kasa_hareketleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kasa_id INTEGER NOT NULL,
      tarih TEXT NOT NULL,
      tur TEXT NOT NULL,
      tutar REAL NOT NULL,
      aciklama TEXT DEFAULT '',
      belge_no TEXT DEFAULT '',
      cari_id INTEGER,
      proje_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS banka_hesaplari (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      banka_adi TEXT NOT NULL,
      hesap_no TEXT DEFAULT '',
      para_birimi TEXT NOT NULL DEFAULT 'IQD',
      bakiye REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS banka_hareketleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hesap_id INTEGER NOT NULL,
      tarih TEXT NOT NULL,
      tur TEXT NOT NULL,
      tutar REAL NOT NULL,
      aciklama TEXT DEFAULT '',
      belge_no TEXT DEFAULT '',
      cari_id INTEGER,
      proje_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS cariler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      tur TEXT NOT NULL,
      telefon TEXT DEFAULT '',
      adres TEXT DEFAULT '',
      bakiye_IQD REAL DEFAULT 0,
      bakiye_USD REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cari_hareketleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cari_id INTEGER NOT NULL,
      tarih TEXT NOT NULL,
      tur TEXT NOT NULL,
      tutar REAL NOT NULL,
      para_birimi TEXT NOT NULL DEFAULT 'IQD',
      aciklama TEXT DEFAULT '',
      belge_no TEXT DEFAULT '',
      kaynak TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS projeler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      aciklama TEXT DEFAULT '',
      durum TEXT DEFAULT 'aktif',
      baslangic TEXT DEFAULT '',
      bitis TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS kategoriler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      tur TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS faturalar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fatura_no TEXT NOT NULL,
      tur TEXT NOT NULL,
      tarih TEXT NOT NULL,
      cari_id INTEGER,
      para_birimi TEXT NOT NULL DEFAULT 'IQD',
      toplam REAL NOT NULL DEFAULT 0,
      aciklama TEXT DEFAULT '',
      durum TEXT DEFAULT 'acik'
    );

    CREATE TABLE IF NOT EXISTS fatura_kalemleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fatura_id INTEGER NOT NULL,
      aciklama TEXT NOT NULL,
      miktar REAL NOT NULL DEFAULT 1,
      birim_fiyat REAL NOT NULL DEFAULT 0,
      toplam REAL NOT NULL DEFAULT 0
    );
  `);

  // Varsayılan veriler
  const kasaSayisi = getOne('SELECT COUNT(*) as n FROM kasalar').n;
  if (kasaSayisi === 0) {
    run('INSERT INTO kasalar (ad, para_birimi, bakiye) VALUES (?, ?, 0)', ['IQD Kasa', 'IQD']);
    run('INSERT INTO kasalar (ad, para_birimi, bakiye) VALUES (?, ?, 0)', ['USD Kasa', 'USD']);
  }

  const bankaSayisi = getOne('SELECT COUNT(*) as n FROM banka_hesaplari').n;
  if (bankaSayisi === 0) {
    run('INSERT INTO banka_hesaplari (banka_adi, para_birimi, bakiye) VALUES (?, ?, 0)', ['IQD Banka', 'IQD']);
    run('INSERT INTO banka_hesaplari (banka_adi, para_birimi, bakiye) VALUES (?, ?, 0)', ['USD Banka', 'USD']);
  }

  // Stok tabloları
  db.run(`
    CREATE TABLE IF NOT EXISTS stoklar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kod TEXT DEFAULT '',
      ad TEXT NOT NULL,
      birim TEXT DEFAULT 'Pcs',
      kategori TEXT DEFAULT '',
      mevcut_miktar REAL DEFAULT 0,
      min_miktar REAL DEFAULT 0,
      aciklama TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS stok_hareketleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stok_id INTEGER NOT NULL,
      tarih TEXT NOT NULL,
      tur TEXT NOT NULL,
      miktar REAL NOT NULL,
      onceki_miktar REAL NOT NULL DEFAULT 0,
      sonraki_miktar REAL NOT NULL DEFAULT 0,
      fatura_id INTEGER,
      aciklama TEXT DEFAULT ''
    );
  `);

  // Ortak tabloları
  db.run(`
    CREATE TABLE IF NOT EXISTS ortaklar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      soyad TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      hisse_orani REAL DEFAULT 0,
      giris_tarihi TEXT DEFAULT '',
      notlar TEXT DEFAULT '',
      durum TEXT DEFAULT 'aktif'
    );
    CREATE TABLE IF NOT EXISTS ortak_hareketleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ortak_id INTEGER NOT NULL,
      tarih TEXT NOT NULL,
      tur TEXT NOT NULL,
      tutar REAL NOT NULL,
      para_birimi TEXT DEFAULT 'USD',
      odeme_turu TEXT DEFAULT 'kasa',
      kaynak_id INTEGER,
      aciklama TEXT DEFAULT '',
      belge_no TEXT DEFAULT ''
    );
  `);

  // Puantaj tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS puantaj (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personel_id INTEGER NOT NULL,
      yil INTEGER NOT NULL,
      ay INTEGER NOT NULL,
      gun INTEGER NOT NULL,
      durum TEXT DEFAULT '',
      UNIQUE(personel_id, yil, ay, gun)
    );
  `);

  // Personel tabloları
  db.run(`
    CREATE TABLE IF NOT EXISTS personeller (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      soyad TEXT DEFAULT '',
      pozisyon TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      ise_giris TEXT DEFAULT '',
      maas REAL DEFAULT 0,
      para_birimi TEXT DEFAULT 'USD',
      durum TEXT DEFAULT 'aktif'
    );
    CREATE TABLE IF NOT EXISTS maas_odemeleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personel_id INTEGER NOT NULL,
      donem TEXT NOT NULL,
      tarih TEXT NOT NULL,
      brut REAL NOT NULL DEFAULT 0,
      kesinti REAL DEFAULT 0,
      net REAL NOT NULL DEFAULT 0,
      para_birimi TEXT DEFAULT 'USD',
      odeme_turu TEXT DEFAULT 'kasa',
      kaynak_id INTEGER,
      aciklama TEXT DEFAULT ''
    );
  `);

  // Migrations
  try { db.run("ALTER TABLE cariler ADD COLUMN vergi_no TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE fatura_kalemleri ADD COLUMN birim TEXT DEFAULT 'Adet'"); } catch (_) {}
  try { db.run("ALTER TABLE fatura_kalemleri ADD COLUMN marka TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE faturalar ADD COLUMN indirim INTEGER DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE fatura_kalemleri ADD COLUMN stok_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE kasa_hareketleri ADD COLUMN ortak_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE banka_hareketleri ADD COLUMN ortak_id INTEGER"); } catch (_) {}

  const katSayisi = getOne('SELECT COUNT(*) as n FROM kategoriler').n;
  if (katSayisi === 0) {
    ['Proje Ödemesi','Avans','Kira Geliri','Diğer Gelir'].forEach(ad =>
      run('INSERT INTO kategoriler (ad, tur) VALUES (?, ?)', [ad, 'gelir']));
    ['Malzeme','İşçilik','Ekipman','Yakıt','Ofis Gideri','Diğer Gider'].forEach(ad =>
      run('INSERT INTO kategoriler (ad, tur) VALUES (?, ?)', [ad, 'gider']));
    saveDb();
  }
}

// ── Fiş yönü yardımcısı ──────────────────────────────────────
const GIRIS_TIPLERI = new Set(['giris', 'tahsilat', 'bankadan-cekilen', 'gelen-havale']);
function isGiris(tur) { return GIRIS_TIPLERI.has(tur); }

// ── sql.js yardımcıları ───────────────────────────────────────
function run(sql, params = []) {
  db.run(sql, params);
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function getOne(sql, params = []) {
  const rows = getAll(sql, params);
  return rows[0] ?? null;
}

function insertAndGet(table, sql, params = []) {
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  return getOne(`SELECT * FROM ${table} WHERE id = ?`, [id]);
}

// ── Pencere ───────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Albrus — Firma Yönetim'
  });
  win.loadFile('renderer/index.html');
}

app.whenReady().then(async () => {
  await initDb();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ════════════════════════════════════════════════════════════
// KASA
// ════════════════════════════════════════════════════════════

ipcMain.handle('kasalar:getir', () =>
  getAll('SELECT * FROM kasalar ORDER BY para_birimi, ad')
);

ipcMain.handle('kasalar:ekle', (_, d) => {
  const r = insertAndGet('kasalar',
    'INSERT INTO kasalar (ad, para_birimi, bakiye) VALUES (?, ?, ?)',
    [d.ad, d.para_birimi, d.bakiye ?? 0]
  );
  saveDb();
  return r;
});

ipcMain.handle('sonraki:fis:no', () => {
  const row = getOne('SELECT MAX(id) as max FROM kasa_hareketleri');
  const next = (row?.max ?? 0) + 1;
  return 'F-' + String(next).padStart(4, '0');
});

ipcMain.handle('kasa:hareketler', (_, kasa_id) =>
  getAll(`
    SELECT kh.*, c.ad as cari_ad, p.ad as proje_ad, o.ad as ortak_ad, o.soyad as ortak_soyad
    FROM kasa_hareketleri kh
    LEFT JOIN cariler c ON c.id = kh.cari_id
    LEFT JOIN projeler p ON p.id = kh.proje_id
    LEFT JOIN ortaklar o ON o.id = kh.ortak_id
    WHERE kh.kasa_id = ?
    ORDER BY kh.tarih DESC, kh.id DESC
  `, [kasa_id])
);

const BANKA_TRANSFER_TUR = new Set(['bankaya-yatirilan', 'bankadan-cekilen']);

ipcMain.handle('kasa:fis:ekle', (_, d) => {
  console.log('[kasa:fis:ekle]', JSON.stringify(d));
  const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [d.kasa_id]);
  if (!kasa) throw new Error('Kasa bulunamadı');
  if (!d.tutar || d.tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır');

  const fis = insertAndGet('kasa_hareketleri',
    'INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, belge_no, cari_id, proje_id, ortak_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(d.kasa_id), d.tarih, d.tur, Number(d.tutar), d.aciklama ?? '', d.belge_no ?? '',
     d.cari_id ? Number(d.cari_id) : null, d.proje_id ? Number(d.proje_id) : null,
     d.ortak_id ? Number(d.ortak_id) : null]
  );

  const yeniBakiye = kasa.bakiye + (isGiris(d.tur) ? fis.tutar : -fis.tutar);
  run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [yeniBakiye, kasa.id]);
  console.log('[kasa:fis:ekle] yeni bakiye:', yeniBakiye);

  // Banka transfer: bankaya-yatirilan veya bankadan-cekilen ise karşı banka hesabını güncelle
  if (BANKA_TRANSFER_TUR.has(d.tur) && d.banka_id) {
    const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [Number(d.banka_id)]);
    if (hesap) {
      const bankaTur   = d.tur === 'bankaya-yatirilan' ? 'giris' : 'cikis';
      const bankaDelta = d.tur === 'bankaya-yatirilan' ? fis.tutar : -fis.tutar;
      const aciklama   = d.tur === 'bankaya-yatirilan'
        ? `Kasadan transfer (${kasa.ad}) #${fis.id}`
        : `Kasaya transfer (${kasa.ad}) #${fis.id}`;
      run('INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no) VALUES (?, ?, ?, ?, ?, ?)',
        [hesap.id, fis.tarih, bankaTur, fis.tutar, aciklama, fis.belge_no ?? '']);
      run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + bankaDelta, hesap.id]);
    }
  }

  if (fis.cari_id) {
    const cariTur = isGiris(d.tur) ? 'alacak' : 'borc';
    run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fis.cari_id, fis.tarih, cariTur, fis.tutar, kasa.para_birimi, fis.aciklama, fis.belge_no, 'kasa']);
    const alan = kasa.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fis.cari_id]);
    const delta = cariTur === 'alacak' ? fis.tutar : -fis.tutar;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, fis.cari_id]);
  }

  saveDb();
  return fis;
});

ipcMain.handle('kasa:fis:sil', (_, id) => {
  const fis = getOne('SELECT * FROM kasa_hareketleri WHERE id = ?', [id]);
  if (!fis) return false;
  const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [fis.kasa_id]);
  const delta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
  run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kasa.bakiye + delta, kasa.id]);

  // Banka transfer tersine çevir
  if (BANKA_TRANSFER_TUR.has(fis.tur)) {
    const bankaHareket = getOne(
      `SELECT * FROM banka_hareketleri WHERE aciklama LIKE ? ORDER BY id DESC LIMIT 1`,
      [`%#${fis.id}`]
    );
    if (bankaHareket) {
      const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [bankaHareket.hesap_id]);
      if (hesap) {
        const bankaDelta = bankaHareket.tur === 'giris' ? -bankaHareket.tutar : bankaHareket.tutar;
        run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + bankaDelta, hesap.id]);
      }
      run('DELETE FROM banka_hareketleri WHERE id = ?', [bankaHareket.id]);
    }
  }

  if (fis.cari_id) {
    const alan = kasa.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fis.cari_id]);
    const cariDelta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + cariDelta, fis.cari_id]);
  }
  run('DELETE FROM kasa_hareketleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// BANKA
// ════════════════════════════════════════════════════════════

ipcMain.handle('banka:hesaplar', () =>
  getAll('SELECT * FROM banka_hesaplari ORDER BY para_birimi, banka_adi')
);

ipcMain.handle('banka:hesap:ekle', (_, d) => {
  const r = insertAndGet('banka_hesaplari',
    'INSERT INTO banka_hesaplari (banka_adi, hesap_no, para_birimi, bakiye) VALUES (?, ?, ?, ?)',
    [d.banka_adi, d.hesap_no ?? '', d.para_birimi, d.bakiye ?? 0]
  );
  saveDb();
  return r;
});

ipcMain.handle('banka:hesap:guncelle', (_, d) => {
  run('UPDATE banka_hesaplari SET banka_adi = ?, hesap_no = ?, para_birimi = ? WHERE id = ?',
    [d.banka_adi, d.hesap_no ?? '', d.para_birimi, d.id]);
  saveDb();
  return getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [d.id]);
});

ipcMain.handle('banka:hesap:sil', (_, id) => {
  const hareketSayisi = getOne('SELECT COUNT(*) as n FROM banka_hareketleri WHERE hesap_id = ?', [id]).n;
  if (hareketSayisi > 0) throw new Error('Bu hesapta hareket var, silinemez.');
  run('DELETE FROM banka_hesaplari WHERE id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('banka:hareketler', (_, hesap_id) =>
  getAll(`
    SELECT bh.*, c.ad as cari_ad, p.ad as proje_ad, o.ad as ortak_ad, o.soyad as ortak_soyad
    FROM banka_hareketleri bh
    LEFT JOIN cariler c ON c.id = bh.cari_id
    LEFT JOIN projeler p ON p.id = bh.proje_id
    LEFT JOIN ortaklar o ON o.id = bh.ortak_id
    WHERE bh.hesap_id = ?
    ORDER BY bh.tarih DESC, bh.id DESC
  `, [hesap_id])
);

ipcMain.handle('banka:fis:ekle', (_, d) => {
  const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [d.hesap_id]);
  if (!hesap) throw new Error('Banka hesabı bulunamadı');
  if (!d.tutar || d.tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır');
  const fis = insertAndGet('banka_hareketleri',
    'INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no, cari_id, proje_id, ortak_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(d.hesap_id), d.tarih, d.tur, Number(d.tutar), d.aciklama ?? '', d.belge_no ?? '',
     d.cari_id ? Number(d.cari_id) : null, d.proje_id ? Number(d.proje_id) : null,
     d.ortak_id ? Number(d.ortak_id) : null]
  );
  const yeniBakiye = hesap.bakiye + (isGiris(d.tur) ? fis.tutar : -fis.tutar);
  run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [yeniBakiye, hesap.id]);

  if (fis.cari_id) {
    const cariTur = isGiris(d.tur) ? 'alacak' : 'borc';
    run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fis.cari_id, fis.tarih, cariTur, fis.tutar, hesap.para_birimi, fis.aciklama, fis.belge_no, 'banka']);
    const alan = hesap.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fis.cari_id]);
    const delta = cariTur === 'alacak' ? fis.tutar : -fis.tutar;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, fis.cari_id]);
  }

  saveDb();
  return fis;
});

ipcMain.handle('banka:fis:sil', (_, id) => {
  const fis = getOne('SELECT * FROM banka_hareketleri WHERE id = ?', [id]);
  if (!fis) return false;
  const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [fis.hesap_id]);
  const delta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
  run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + delta, hesap.id]);

  if (fis.cari_id) {
    const alan = hesap.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fis.cari_id]);
    const cariDelta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + cariDelta, fis.cari_id]);
  }

  run('DELETE FROM banka_hareketleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// CARİLER
// ════════════════════════════════════════════════════════════

ipcMain.handle('cariler:getir', (_, f) => {
  if (f?.tur) return getAll('SELECT * FROM cariler WHERE tur = ? ORDER BY ad', [f.tur]);
  return getAll('SELECT * FROM cariler ORDER BY ad');
});

ipcMain.handle('cariler:ekle', (_, d) => {
  const r = insertAndGet('cariler',
    'INSERT INTO cariler (ad, tur, telefon, adres, vergi_no) VALUES (?, ?, ?, ?, ?)',
    [d.ad, d.tur, d.telefon ?? '', d.adres ?? '', d.vergi_no ?? '']
  );
  saveDb();
  return r;
});

ipcMain.handle('cariler:guncelle', (_, d) => {
  run('UPDATE cariler SET ad = ?, tur = ?, telefon = ?, adres = ?, vergi_no = ? WHERE id = ?',
    [d.ad, d.tur, d.telefon ?? '', d.adres ?? '', d.vergi_no ?? '', d.id]);
  saveDb();
  return getOne('SELECT * FROM cariler WHERE id = ?', [d.id]);
});

ipcMain.handle('cari:ekstre', (_, cari_id) =>
  getAll('SELECT * FROM cari_hareketleri WHERE cari_id = ? ORDER BY tarih DESC, id DESC', [cari_id])
);

// ════════════════════════════════════════════════════════════
// PROJELER
// ════════════════════════════════════════════════════════════

ipcMain.handle('projeler:getir', () =>
  getAll('SELECT * FROM projeler ORDER BY id DESC')
);

ipcMain.handle('projeler:ekle', (_, d) => {
  const r = insertAndGet('projeler',
    'INSERT INTO projeler (ad, aciklama, durum, baslangic, bitis) VALUES (?, ?, ?, ?, ?)',
    [d.ad, d.aciklama ?? '', d.durum ?? 'aktif', d.baslangic ?? '', d.bitis ?? '']
  );
  saveDb();
  return r;
});

// ════════════════════════════════════════════════════════════
// FATURA
// ════════════════════════════════════════════════════════════

ipcMain.handle('sonraki:fatura:no', (_, tur) => {
  const prefix = tur === 'satis' ? 'SAT' : 'AL';
  const row = getOne('SELECT COUNT(*) as n FROM faturalar WHERE tur = ?', [tur]);
  const next = (row?.n ?? 0) + 1;
  return prefix + '-' + String(next).padStart(4, '0');
});

ipcMain.handle('faturalar:getir', (_, f) => {
  let sql = `
    SELECT f.*, c.ad as cari_ad
    FROM faturalar f
    LEFT JOIN cariler c ON c.id = f.cari_id
  `;
  const params = [];
  const conds = [];
  if (f?.tur)     { conds.push('f.tur = ?');     params.push(f.tur); }
  if (f?.cari_id) { conds.push('f.cari_id = ?'); params.push(f.cari_id); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY f.tarih DESC, f.id DESC';
  return getAll(sql, params);
});

ipcMain.handle('fatura:getir', (_, id) => {
  const fatura = getOne(`
    SELECT f.*, c.ad as cari_ad, c.vergi_no as cari_vergi_no, c.adres as cari_adres, c.telefon as cari_tel
    FROM faturalar f LEFT JOIN cariler c ON c.id = f.cari_id
    WHERE f.id = ?
  `, [id]);
  if (!fatura) return null;
  fatura.kalemler = getAll('SELECT * FROM fatura_kalemleri WHERE fatura_id = ? ORDER BY id', [id]);
  return fatura;
});

ipcMain.handle('fatura:ekle', (_, d) => {
  if (!d.kalemler?.length) throw new Error('En az bir kalem girilmelidir.');
  const toplam = d.kalemler.reduce((s, k) => s + Math.round(k.miktar * k.birim_fiyat), 0);

  const indirim = Math.abs(d.indirim ?? 0);
  const grandToplam = Math.max(0, toplam - indirim);

  const fatura = insertAndGet('faturalar',
    'INSERT INTO faturalar (fatura_no, tur, tarih, cari_id, para_birimi, toplam, indirim, aciklama, durum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [d.fatura_no, d.tur, d.tarih,
     d.cari_id ? Number(d.cari_id) : null,
     d.para_birimi, toplam, indirim, d.aciklama ?? '', 'acik']
  );

  for (const k of d.kalemler) {
    const kt = Math.round(k.miktar * k.birim_fiyat);
    run('INSERT INTO fatura_kalemleri (fatura_id, aciklama, birim, marka, miktar, birim_fiyat, toplam, stok_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fatura.id, k.aciklama, k.birim ?? 'Adet', k.marka ?? '', k.miktar, k.birim_fiyat, kt, k.stok_id ?? null]);
    if (d.tur === 'alis' && k.stok_id) {
      const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [k.stok_id]);
      if (stok) {
        const yeni = stok.mevcut_miktar + k.miktar;
        run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [yeni, k.stok_id]);
        run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, fatura_id, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [k.stok_id, d.tarih, 'giris', k.miktar, stok.mevcut_miktar, yeni, fatura.id, d.fatura_no]);
      }
    }
  }

  if (fatura.cari_id) {
    const cariTur = d.tur === 'satis' ? 'borc' : 'alacak';
    run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fatura.cari_id, fatura.tarih, cariTur, grandToplam, fatura.para_birimi, fatura.aciklama, fatura.fatura_no, 'fatura']);
    const alan = fatura.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fatura.cari_id]);
    const delta = cariTur === 'borc' ? grandToplam : -grandToplam;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, fatura.cari_id]);
  }

  saveDb();
  return fatura;
});

ipcMain.handle('fatura:guncelle', (_, id, d) => {
  const eski = getOne('SELECT * FROM faturalar WHERE id = ?', [id]);
  if (!eski) throw new Error('Fatura bulunamadı.');

  // Eski cari etkisini geri al
  if (eski.cari_id) {
    const eskiGrand = Math.max(0, eski.toplam - (eski.indirim ?? 0));
    const eskiCariTur = eski.tur === 'satis' ? 'borc' : 'alacak';
    const alan = eski.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [eski.cari_id]);
    const geriDelta = eskiCariTur === 'borc' ? -eskiGrand : eskiGrand;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + geriDelta, eski.cari_id]);
    run('DELETE FROM cari_hareketleri WHERE belge_no = ? AND kaynak = ?', [eski.fatura_no, 'fatura']);
  }

  const yeniToplam = d.kalemler.reduce((s, k) => s + Math.round(k.miktar * k.birim_fiyat), 0);
  const yeniIndirim = Math.abs(d.indirim ?? 0);
  const yeniGrand = Math.max(0, yeniToplam - yeniIndirim);

  run('UPDATE faturalar SET fatura_no=?, tur=?, tarih=?, cari_id=?, para_birimi=?, toplam=?, indirim=?, aciklama=? WHERE id=?',
    [d.fatura_no, d.tur, d.tarih,
     d.cari_id ? Number(d.cari_id) : null,
     d.para_birimi, yeniToplam, yeniIndirim, d.aciklama ?? '', id]);

  run('DELETE FROM fatura_kalemleri WHERE fatura_id = ?', [id]);
  for (const k of d.kalemler) {
    const kt = Math.round(k.miktar * k.birim_fiyat);
    run('INSERT INTO fatura_kalemleri (fatura_id, aciklama, birim, marka, miktar, birim_fiyat, toplam) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, k.aciklama, k.birim ?? 'Adet', k.marka ?? '', k.miktar, k.birim_fiyat, kt]);
  }

  if (d.cari_id) {
    const cariTur = d.tur === 'satis' ? 'borc' : 'alacak';
    run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [Number(d.cari_id), d.tarih, cariTur, yeniGrand, d.para_birimi, d.aciklama, d.fatura_no, 'fatura']);
    const alan = d.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [Number(d.cari_id)]);
    const delta = cariTur === 'borc' ? yeniGrand : -yeniGrand;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, Number(d.cari_id)]);
  }

  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// STOK
// ════════════════════════════════════════════════════════════

ipcMain.handle('stoklar:getir', () =>
  getAll('SELECT * FROM stoklar ORDER BY ad')
);

ipcMain.handle('stoklar:ekle', (_, d) => {
  const r = insertAndGet('stoklar',
    'INSERT INTO stoklar (kod, ad, birim, kategori, mevcut_miktar, min_miktar, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [d.kod ?? '', d.ad, d.birim ?? 'Pcs', d.kategori ?? '', d.mevcut_miktar ?? 0, d.min_miktar ?? 0, d.aciklama ?? '']
  );
  saveDb();
  return r;
});

ipcMain.handle('stoklar:guncelle', (_, id, d) => {
  run('UPDATE stoklar SET kod=?, ad=?, birim=?, kategori=?, mevcut_miktar=?, min_miktar=?, aciklama=? WHERE id=?',
    [d.kod ?? '', d.ad, d.birim ?? 'Pcs', d.kategori ?? '', d.mevcut_miktar ?? 0, d.min_miktar ?? 0, d.aciklama ?? '', id]);
  saveDb();
  return true;
});

ipcMain.handle('stoklar:sil', (_, id) => {
  run('DELETE FROM stoklar WHERE id = ?', [id]);
  run('DELETE FROM stok_hareketleri WHERE stok_id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('stok:hareketler', (_, stokId) =>
  getAll('SELECT * FROM stok_hareketleri WHERE stok_id = ? ORDER BY tarih DESC, id DESC', [stokId])
);

ipcMain.handle('fatura:sil', (_, id) => {
  const fatura = getOne('SELECT * FROM faturalar WHERE id = ?', [id]);
  if (!fatura) return false;
  if (fatura.cari_id) {
    const cariTur = fatura.tur === 'satis' ? 'borc' : 'alacak';
    const alan = fatura.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fatura.cari_id]);
    const delta = cariTur === 'borc' ? -fatura.toplam : fatura.toplam;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, fatura.cari_id]);
  }
  run('DELETE FROM fatura_kalemleri WHERE fatura_id = ?', [id]);
  run('DELETE FROM faturalar WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// PDF PRINT
// ════════════════════════════════════════════════════════════

ipcMain.handle('print:pdf', async (_, htmlContent) => {
  const printWin = new BrowserWindow({
    show: false,
    width: 900, height: 700,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; padding: 0; background: #fff; color: #000; }
      * { box-sizing: border-box; }
    </style>
  </head><body>${htmlContent}</body></html>`;

  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));

  const pdfData = await printWin.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'default' }
  });

  printWin.close();

  const pdfPath = path.join(os.tmpdir(), `albrus-${Date.now()}.pdf`);
  fs.writeFileSync(pdfPath, pdfData);
  shell.openPath(pdfPath);
  return true;
});

// ════════════════════════════════════════════════════════════
// KATEGORİLER
// ════════════════════════════════════════════════════════════

ipcMain.handle('kategoriler:getir', (_, tur) => {
  if (tur) return getAll('SELECT * FROM kategoriler WHERE tur = ? ORDER BY ad', [tur]);
  return getAll('SELECT * FROM kategoriler ORDER BY tur, ad');
});

// ════════════════════════════════════════════════════════════
// PERSONEL
// ════════════════════════════════════════════════════════════

ipcMain.handle('personeller:getir', () =>
  getAll('SELECT * FROM personeller ORDER BY ad, soyad')
);

ipcMain.handle('personeller:ekle', (_, d) => {
  const r = insertAndGet('personeller',
    'INSERT INTO personeller (ad, soyad, pozisyon, telefon, ise_giris, maas, para_birimi, durum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [d.ad, d.soyad ?? '', d.pozisyon ?? '', d.telefon ?? '', d.ise_giris ?? '', d.maas ?? 0, d.para_birimi ?? 'USD', d.durum ?? 'aktif']
  );
  saveDb();
  return r;
});

ipcMain.handle('personeller:guncelle', (_, id, d) => {
  run('UPDATE personeller SET ad=?, soyad=?, pozisyon=?, telefon=?, ise_giris=?, maas=?, para_birimi=?, durum=? WHERE id=?',
    [d.ad, d.soyad ?? '', d.pozisyon ?? '', d.telefon ?? '', d.ise_giris ?? '', d.maas ?? 0, d.para_birimi ?? 'USD', d.durum ?? 'aktif', id]);
  saveDb();
  return getOne('SELECT * FROM personeller WHERE id = ?', [id]);
});

ipcMain.handle('personeller:sil', (_, id) => {
  const n = getOne('SELECT COUNT(*) as n FROM maas_odemeleri WHERE personel_id = ?', [id]).n;
  if (n > 0) throw new Error('Bu personelin ödeme kaydı var, silinemez.');
  run('DELETE FROM personeller WHERE id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('maas:odemeleri:getir', (_, f) => {
  let sql = `
    SELECT mo.*, p.ad as personel_ad, p.soyad as personel_soyad, p.pozisyon
    FROM maas_odemeleri mo
    JOIN personeller p ON p.id = mo.personel_id
  `;
  const params = [];
  const conds = [];
  if (f?.personel_id) { conds.push('mo.personel_id = ?'); params.push(f.personel_id); }
  if (f?.donem)       { conds.push('mo.donem = ?');       params.push(f.donem); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY mo.tarih DESC, mo.id DESC';
  return getAll(sql, params);
});

ipcMain.handle('maas:odeme:ekle', (_, d) => {
  const personel = getOne('SELECT * FROM personeller WHERE id = ?', [d.personel_id]);
  if (!personel) throw new Error('Personel bulunamadı.');

  const brut = Number(d.brut) || 0;
  const kesinti = Number(d.kesinti) || 0;
  const net = Math.max(0, brut - kesinti);

  const odeme = insertAndGet('maas_odemeleri',
    'INSERT INTO maas_odemeleri (personel_id, donem, tarih, brut, kesinti, net, para_birimi, odeme_turu, kaynak_id, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [d.personel_id, d.donem, d.tarih, brut, kesinti, net,
     d.para_birimi ?? 'USD', d.odeme_turu ?? 'kasa',
     d.kaynak_id ? Number(d.kaynak_id) : null, d.aciklama ?? '']
  );

  const belgeNo = `MAA-${String(odeme.id).padStart(4, '0')}`;
  const aciklama = `Maaş — ${personel.ad} ${personel.soyad} (${d.donem})`;

  if (d.odeme_turu === 'banka' && d.kaynak_id) {
    const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [Number(d.kaynak_id)]);
    if (hesap) {
      run('INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no) VALUES (?, ?, ?, ?, ?, ?)',
        [hesap.id, d.tarih, 'cikis', net, aciklama, belgeNo]);
      run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye - net, hesap.id]);
    }
  } else if (d.kaynak_id) {
    const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [Number(d.kaynak_id)]);
    if (kasa) {
      run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, belge_no) VALUES (?, ?, ?, ?, ?, ?)',
        [kasa.id, d.tarih, 'odeme', net, aciklama, belgeNo]);
      run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kasa.bakiye - net, kasa.id]);
    }
  }

  saveDb();
  return odeme;
});

ipcMain.handle('maas:odeme:sil', (_, id) => {
  const odeme = getOne('SELECT * FROM maas_odemeleri WHERE id = ?', [id]);
  if (!odeme) return false;
  const belgeNo = `MAA-${String(id).padStart(4, '0')}`;

  if (odeme.odeme_turu === 'banka') {
    const bh = getOne('SELECT * FROM banka_hareketleri WHERE belge_no = ? ORDER BY id DESC LIMIT 1', [belgeNo]);
    if (bh) {
      const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [bh.hesap_id]);
      if (hesap) run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + odeme.net, hesap.id]);
      run('DELETE FROM banka_hareketleri WHERE id = ?', [bh.id]);
    }
  } else {
    const kh = getOne('SELECT * FROM kasa_hareketleri WHERE belge_no = ? ORDER BY id DESC LIMIT 1', [belgeNo]);
    if (kh) {
      const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [kh.kasa_id]);
      if (kasa) run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kasa.bakiye + odeme.net, kasa.id]);
      run('DELETE FROM kasa_hareketleri WHERE id = ?', [kh.id]);
    }
  }

  run('DELETE FROM maas_odemeleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// PUANTAJ
// ════════════════════════════════════════════════════════════

ipcMain.handle('puantaj:getir', (_, personel_id, yil, ay) =>
  getAll('SELECT gun, durum FROM puantaj WHERE personel_id = ? AND yil = ? AND ay = ? ORDER BY gun',
    [personel_id, yil, ay])
);

ipcMain.handle('puantaj:guncelle', (_, personel_id, yil, ay, gun, durum) => {
  if (durum === '') {
    run('DELETE FROM puantaj WHERE personel_id = ? AND yil = ? AND ay = ? AND gun = ?',
      [personel_id, yil, ay, gun]);
  } else {
    run('INSERT OR REPLACE INTO puantaj (personel_id, yil, ay, gun, durum) VALUES (?, ?, ?, ?, ?)',
      [personel_id, yil, ay, gun, durum]);
  }
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// ORTAKLAR
// ════════════════════════════════════════════════════════════

ipcMain.handle('ortaklar:getir', () => {
  const ortaklar = getAll('SELECT * FROM ortaklar ORDER BY ad, soyad');
  return ortaklar.map(o => {
    const totals = getAll(
      'SELECT tur, para_birimi, SUM(tutar) as toplam FROM ortak_hareketleri WHERE ortak_id = ? GROUP BY tur, para_birimi',
      [o.id]
    );
    const net = {};
    totals.forEach(t => {
      if (!net[t.para_birimi]) net[t.para_birimi] = 0;
      if (t.tur === 'sermaye_girisi') net[t.para_birimi] += t.toplam;
      else net[t.para_birimi] -= t.toplam;
    });
    return { ...o, net };
  });
});

ipcMain.handle('ortaklar:ekle', (_, d) => {
  const row = insertAndGet('ortaklar',
    `INSERT INTO ortaklar (ad, soyad, telefon, email, hisse_orani, giris_tarihi, notlar, durum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.ad, d.soyad||'', d.telefon||'', d.email||'', d.hisse_orani||0, d.giris_tarihi||'', d.notlar||'', d.durum||'aktif']);
  saveDb();
  return row;
});

ipcMain.handle('ortaklar:guncelle', (_, id, d) => {
  run(`UPDATE ortaklar SET ad=?, soyad=?, telefon=?, email=?, hisse_orani=?, giris_tarihi=?, notlar=?, durum=? WHERE id=?`,
    [d.ad, d.soyad||'', d.telefon||'', d.email||'', d.hisse_orani||0, d.giris_tarihi||'', d.notlar||'', d.durum||'aktif', id]);
  saveDb();
  return true;
});

ipcMain.handle('ortaklar:sil', (_, id) => {
  const count = getOne('SELECT COUNT(*) as n FROM ortak_hareketleri WHERE ortak_id = ?', [id]).n;
  if (count > 0) throw new Error('Bu ortağın hareketleri mevcut; önce hareketleri silin.');
  run('DELETE FROM ortaklar WHERE id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('ortak:hareketler:getir', (_, filter = {}) => {
  let q = `SELECT oh.*, o.ad as ortak_ad, o.soyad as ortak_soyad
    FROM ortak_hareketleri oh
    JOIN ortaklar o ON o.id = oh.ortak_id
    WHERE 1=1`;
  const params = [];
  if (filter.ortak_id) { q += ' AND oh.ortak_id = ?'; params.push(filter.ortak_id); }
  q += ' ORDER BY oh.tarih DESC, oh.id DESC';
  return getAll(q, params);
});

ipcMain.handle('ortak:hareket:ekle', (_, d) => {
  const ortak = getOne('SELECT * FROM ortaklar WHERE id = ?', [d.ortak_id]);
  if (!ortak) throw new Error('Ortak bulunamadı.');
  const girisMi = d.tur === 'sermaye_girisi';
  const turLabel = d.tur === 'sermaye_girisi' ? 'Sermaye Girişi' : d.tur === 'cekim' ? 'Çekim' : 'Kâr Dağılımı';
  const aciklama = d.aciklama || `${turLabel} — ${ortak.ad}${ortak.soyad ? ' ' + ortak.soyad : ''}`;

  run(`INSERT INTO ortak_hareketleri (ortak_id, tarih, tur, tutar, para_birimi, odeme_turu, kaynak_id, aciklama, belge_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
    [d.ortak_id, d.tarih, d.tur, d.tutar, d.para_birimi||'USD', d.odeme_turu||'kasa', d.kaynak_id||null, d.aciklama||'']);
  const newId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  const belgeNo = `ORT-${String(newId).padStart(4, '0')}`;
  run('UPDATE ortak_hareketleri SET belge_no = ? WHERE id = ?', [belgeNo, newId]);

  if (d.odeme_turu === 'banka' && d.kaynak_id) {
    const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [d.kaynak_id]);
    if (!hesap) throw new Error('Banka hesabı bulunamadı.');
    run(`INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no, ortak_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [hesap.id, d.tarih, girisMi ? 'giris' : 'cikis', d.tutar, aciklama, belgeNo, d.ortak_id]);
    run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?',
      [girisMi ? hesap.bakiye + d.tutar : hesap.bakiye - d.tutar, hesap.id]);
  } else if (d.kaynak_id) {
    const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [d.kaynak_id]);
    if (!kasa) throw new Error('Kasa bulunamadı.');
    run(`INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, belge_no, ortak_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [kasa.id, d.tarih, girisMi ? 'tahsilat' : 'odeme', d.tutar, aciklama, belgeNo, d.ortak_id]);
    run('UPDATE kasalar SET bakiye = ? WHERE id = ?',
      [girisMi ? kasa.bakiye + d.tutar : kasa.bakiye - d.tutar, kasa.id]);
  }
  saveDb();
  return true;
});

ipcMain.handle('ortak:hareket:sil', (_, id) => {
  const h = getOne('SELECT * FROM ortak_hareketleri WHERE id = ?', [id]);
  if (!h) return false;
  const girisMi = h.tur === 'sermaye_girisi';
  if (h.belge_no) {
    if (h.odeme_turu === 'banka') {
      const bh = getOne('SELECT * FROM banka_hareketleri WHERE belge_no = ? ORDER BY id DESC LIMIT 1', [h.belge_no]);
      if (bh) {
        const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [bh.hesap_id]);
        if (hesap) run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?',
          [girisMi ? hesap.bakiye - h.tutar : hesap.bakiye + h.tutar, hesap.id]);
        run('DELETE FROM banka_hareketleri WHERE id = ?', [bh.id]);
      }
    } else {
      const kh = getOne('SELECT * FROM kasa_hareketleri WHERE belge_no = ? ORDER BY id DESC LIMIT 1', [h.belge_no]);
      if (kh) {
        const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [kh.kasa_id]);
        if (kasa) run('UPDATE kasalar SET bakiye = ? WHERE id = ?',
          [girisMi ? kasa.bakiye - h.tutar : kasa.bakiye + h.tutar, kasa.id]);
        run('DELETE FROM kasa_hareketleri WHERE id = ?', [kh.id]);
      }
    }
  }
  run('DELETE FROM ortak_hareketleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════

ipcMain.handle('dashboard:ozet', () => {
  const kasalar  = getAll('SELECT * FROM kasalar ORDER BY para_birimi, ad');
  const bankalar = getAll('SELECT * FROM banka_hesaplari ORDER BY para_birimi, banka_adi');

  const ayBas = new Date();
  ayBas.setDate(1);
  const ayBasStr = ayBas.toISOString().split('T')[0];

  const ayHar = getAll(
    "SELECT tur, k.para_birimi, SUM(kh.tutar) as toplam FROM kasa_hareketleri kh JOIN kasalar k ON k.id = kh.kasa_id WHERE kh.tarih >= ? GROUP BY kh.tur, k.para_birimi",
    [ayBasStr]
  );
  const gelirMap = {}, giderMap = {};
  ayHar.forEach(r => {
    if (isGiris(r.tur)) gelirMap[r.para_birimi] = (gelirMap[r.para_birimi] || 0) + r.toplam;
    else                giderMap[r.para_birimi] = (giderMap[r.para_birimi] || 0) + r.toplam;
  });

  const sonHareketler = getAll(`
    SELECT kh.id, kh.tarih, kh.tur, kh.tutar, kh.aciklama, k.para_birimi, k.ad as kasa_ad,
           c.ad as cari_ad, p.ad as proje_ad
    FROM kasa_hareketleri kh
    JOIN kasalar k ON k.id = kh.kasa_id
    LEFT JOIN cariler c ON c.id = kh.cari_id
    LEFT JOIN projeler p ON p.id = kh.proje_id
    ORDER BY kh.tarih DESC, kh.id DESC
    LIMIT 15
  `);

  return {
    kasalar,
    bankalar,
    aylikGelir: Object.entries(gelirMap).map(([para_birimi, toplam]) => ({ para_birimi, toplam })),
    aylikGider: Object.entries(giderMap).map(([para_birimi, toplam]) => ({ para_birimi, toplam })),
    sonHareketler
  };
});
