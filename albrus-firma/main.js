const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const { readWorkbook, sheetRows } = require('./xlsx-read');

// ── Lisans (Ed25519 imza doğrulama — sadece public key gömülü, anahtar üretilemez) ──
const LISANS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgFk6z/Kh146yqs0C5rlRcM28az4Zfc/IeTtk6yLHKmk=
-----END PUBLIC KEY-----`;

// Bu bilgisayara özgü kimlik (Windows MachineGuid → sabit; yoksa MAC+hostname)
function makineKimligi() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' });
      const m = /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(out);
      if (m) return crypto.createHash('sha256').update(m[1]).digest('hex').slice(0, 16).toUpperCase();
    }
  } catch (_) {}
  const macs = Object.values(os.networkInterfaces()).flat()
    .filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00').map(n => n.mac);
  return crypto.createHash('sha256').update((macs[0] || '') + os.hostname()).digest('hex').slice(0, 16).toUpperCase();
}

// Lisans anahtarı = bu makine kimliğinin özel anahtarla imzalanmış hali (base64)
function lisansGecerliMi(key) {
  if (!key) return false;
  try {
    const sig = Buffer.from(String(key).replace(/\s+/g, ''), 'base64');
    return crypto.verify(null, Buffer.from(makineKimligi()), LISANS_PUBLIC_KEY, sig);
  } catch (_) { return false; }
}

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
    CREATE TABLE IF NOT EXISTS personel_hareketleri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personel_id INTEGER NOT NULL,
      tarih TEXT NOT NULL,
      tur TEXT NOT NULL,
      tutar REAL NOT NULL DEFAULT 0,
      kaynak TEXT DEFAULT '',
      yil INTEGER DEFAULT NULL,
      ay INTEGER DEFAULT NULL,
      gun INTEGER DEFAULT NULL,
      aciklama TEXT DEFAULT ''
    );
  `);

  // Ayarlar (anahtar-değer) + döviz kuru
  db.run(`
    CREATE TABLE IF NOT EXISTS ayarlar (
      anahtar TEXT PRIMARY KEY,
      deger TEXT
    );
  `);
  if (!getOne("SELECT 1 FROM ayarlar WHERE anahtar = 'usd_iqd_kuru'")) {
    run("INSERT INTO ayarlar (anahtar, deger) VALUES ('usd_iqd_kuru', '1310')");
  }

  // Migrations
  try { db.run("ALTER TABLE cariler ADD COLUMN vergi_no TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE fatura_kalemleri ADD COLUMN birim TEXT DEFAULT 'Adet'"); } catch (_) {}
  try { db.run("ALTER TABLE fatura_kalemleri ADD COLUMN marka TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE faturalar ADD COLUMN indirim INTEGER DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE fatura_kalemleri ADD COLUMN stok_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE kasa_hareketleri ADD COLUMN ortak_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE banka_hareketleri ADD COLUMN ortak_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE personel_hareketleri ADD COLUMN yil INTEGER DEFAULT NULL"); } catch (_) {}
  try { db.run("ALTER TABLE personel_hareketleri ADD COLUMN ay INTEGER DEFAULT NULL"); } catch (_) {}
  try { db.run("ALTER TABLE personel_hareketleri ADD COLUMN gun INTEGER DEFAULT NULL"); } catch (_) {}
  try { db.run("ALTER TABLE puantaj ADD COLUMN mesai_saat REAL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE faturalar ADD COLUMN belge_turu TEXT DEFAULT 'fatura'"); } catch (_) {}
  try { db.run("ALTER TABLE maas_odemeleri ADD COLUMN prim REAL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE maas_odemeleri ADD COLUMN kesinti_neden TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE stoklar ADD COLUMN barkod TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE stoklar ADD COLUMN alis_fiyat REAL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE cariler ADD COLUMN fatura_no_prefix TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE stoklar ADD COLUMN satis_fiyat REAL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE stoklar ADD COLUMN para_birimi TEXT DEFAULT 'USD'"); } catch (_) {}
  try { db.run("ALTER TABLE faturalar ADD COLUMN odenen REAL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE faturalar ADD COLUMN vade TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE kasa_hareketleri ADD COLUMN kategori_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE banka_hareketleri ADD COLUMN kategori_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE personeller ADD COLUMN proje_id INTEGER"); } catch (_) {}

  // Stok grupları
  db.run(`
    CREATE TABLE IF NOT EXISTS stok_gruplan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad TEXT NOT NULL,
      kod TEXT DEFAULT '',
      aciklama TEXT DEFAULT ''
    );
  `);
  try { db.run("ALTER TABLE stoklar ADD COLUMN grup_id INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE stok_gruplan ADD COLUMN parent_id INTEGER"); } catch (_) {}

  // Başlangıç stok grupları — eksik olanları ekle
  const grupAd = ['Elektrik', 'Mekanik', 'İnşaat', 'Hizmet', 'Maintenance'];
  const grupKod = ['ELK', 'MEK', 'INS', 'HIZ', 'MNT'];
  const mevcutGruplar = getAll('SELECT ad FROM stok_gruplan').map(g => g.ad);
  for (let i = 0; i < grupAd.length; i++) {
    if (!mevcutGruplar.includes(grupAd[i])) {
      db.run("INSERT INTO stok_gruplan (ad, kod) VALUES (?, ?)", [grupAd[i], grupKod[i]]);
    }
  }

  // Migration: kategori text'ini grup_id'ye dönüştür
  const mevcut_kategoriler = getAll("SELECT DISTINCT kategori FROM stoklar WHERE kategori IS NOT NULL AND kategori != ''");
  for (const kat of mevcut_kategoriler) {
    const grup = getOne('SELECT id FROM stok_gruplan WHERE ad = ?', [kat.kategori]);
    if (grup) {
      db.run('UPDATE stoklar SET grup_id = ? WHERE kategori = ?', [grup.id, kat.kategori]);
    }
  }
  // Migration: Hala NULL olan stokları Elektrik'e ata
  const elektrik_grup_id = getOne('SELECT id FROM stok_gruplan WHERE ad = ?', ['Elektrik'])?.id;
  if (elektrik_grup_id) {
    db.run('UPDATE stoklar SET grup_id = ? WHERE grup_id IS NULL', [elektrik_grup_id]);
  }

  // Hakediş — BOQ/poz listesi + dönemler + yeşil defter satırları
  db.run(`
    CREATE TABLE IF NOT EXISTS hakedis_pozlar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proje_id INTEGER NOT NULL,
      grup TEXT DEFAULT '',
      poz_no TEXT DEFAULT '',
      tanim TEXT NOT NULL,
      birim TEXT DEFAULT 'Adet',
      kesif_miktar REAL DEFAULT 0,
      bf_iscilik REAL DEFAULT 0,
      bf_malzeme REAL DEFAULT 0,
      sira INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS hakedisler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proje_id INTEGER NOT NULL,
      hakedis_no INTEGER NOT NULL DEFAULT 1,
      tarih TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS hakedis_satirlar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hakedis_id INTEGER NOT NULL,
      poz_id INTEGER NOT NULL,
      bu_miktar REAL DEFAULT 0,
      UNIQUE(hakedis_id, poz_id)
    );
    CREATE TABLE IF NOT EXISTS ilave_isler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hakedis_id INTEGER NOT NULL,
      tutanak_no TEXT DEFAULT '',
      tutanak_tarih TEXT DEFAULT '',
      imalat_adi TEXT DEFAULT '',
      kirilim TEXT DEFAULT '',
      birim TEXT DEFAULT '',
      miktar REAL DEFAULT 0,
      birim_fiyat REAL DEFAULT 0,
      parite REAL DEFAULT 0,
      sira INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kesintiler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hakedis_id INTEGER NOT NULL,
      tarih TEXT DEFAULT '',
      aciklama TEXT DEFAULT '',
      birim TEXT DEFAULT '',
      miktar REAL DEFAULT 0,
      birim_fiyat REAL DEFAULT 0,
      parite REAL DEFAULT 0,
      sira INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS progress_report (
      hakedis_id INTEGER PRIMARY KEY,
      subcontractor TEXT DEFAULT '',
      works_name TEXT DEFAULT '',
      type_manuf TEXT DEFAULT '',
      nusha TEXT DEFAULT '',
      ppc_type TEXT DEFAULT '',
      project_name TEXT DEFAULT '',
      project_location TEXT DEFAULT '',
      scope TEXT DEFAULT '',
      employer TEXT DEFAULT '',
      contract_no TEXT DEFAULT '',
      subcontractor_full TEXT DEFAULT '',
      contract_value REAL DEFAULT 0,
      change_order TEXT DEFAULT '',
      guarantee TEXT DEFAULT '',
      site_delivery_date TEXT DEFAULT '',
      time_completion TEXT DEFAULT '',
      additional_days TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );
  `);

  // Çek / Senet
  db.run(`
    CREATE TABLE IF NOT EXISTS cek_senet (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tip TEXT NOT NULL DEFAULT 'cek',
      yon TEXT NOT NULL DEFAULT 'alinan',
      cari_id INTEGER,
      tutar REAL NOT NULL DEFAULT 0,
      para_birimi TEXT NOT NULL DEFAULT 'USD',
      vade TEXT DEFAULT '',
      tarih TEXT DEFAULT '',
      banka TEXT DEFAULT '',
      cek_no TEXT DEFAULT '',
      durum TEXT DEFAULT 'portfoy',
      hesap_tip TEXT DEFAULT '',
      hesap_id INTEGER,
      aciklama TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS proje_kesif (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proje_id INTEGER NOT NULL,
      tur TEXT NOT NULL DEFAULT 'elektrik',
      poz_no TEXT DEFAULT '',
      ad TEXT NOT NULL DEFAULT '',
      birim TEXT DEFAULT 'Adet',
      miktar REAL DEFAULT 0,
      birim_fiyat REAL DEFAULT 0,
      para_birimi TEXT DEFAULT 'USD',
      sira INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS proje_iscilik_kesif (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proje_id INTEGER NOT NULL,
      isci_adi TEXT NOT NULL DEFAULT '',
      gun REAL DEFAULT 0,
      gundelik REAL DEFAULT 0,
      para_birimi TEXT DEFAULT 'USD',
      sira INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS proje_kesif_3d (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kesif_id INTEGER NOT NULL,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      z REAL DEFAULT 0,
      rotasyon_x REAL DEFAULT 0,
      rotasyon_y REAL DEFAULT 0,
      rotasyon_z REAL DEFAULT 0,
      olcek REAL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS proje_kat_plani (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proje_id INTEGER NOT NULL,
      resim_data TEXT,
      items_json TEXT DEFAULT '[]',
      tur TEXT DEFAULT 'elektrik',
      olusturma_tarihi TEXT DEFAULT CURRENT_TIMESTAMP,
      guncelleme_tarihi TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proje_depo_3d (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proje_id INTEGER NOT NULL,
      nesneler_json TEXT DEFAULT '[]',
      katmanlar_json TEXT DEFAULT '[]',
      tur TEXT DEFAULT 'elektrik',
      olusturma_tarihi TEXT DEFAULT CURRENT_TIMESTAMP,
      guncelleme_tarihi TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proje_3d_editor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proje_id INTEGER NOT NULL,
      nesneler_json TEXT DEFAULT '[]',
      tur TEXT DEFAULT 'elektrik',
      olusturma_tarihi TEXT DEFAULT CURRENT_TIMESTAMP,
      guncelleme_tarihi TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
let mainWindow = null;

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
  // Pencere her odaklandığında webContents'e de odak ver (alt-tab/tıklama sonrası
  // klavye girişinin kutulara ulaşmama sorununu çözer).
  win.on('focus', () => { if (!win.isDestroyed()) win.webContents.focus(); });
  mainWindow = win;
}

// Renderer isteğiyle pencere/webContents'e klavye odağı ver (modal açılışında kutular hemen yazılabilsin)
ipcMain.handle('win:focus', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  if (!w || w.isDestroyed()) return true;
  // webContents klavye odağını kaybettiyse (native dialog/PDF sonrası) blur+focus ile yeniden kur.
  // Odak zaten yerindeyse titreme olmasın diye sadece webContents.focus().
  if (!w.webContents.isFocused()) {
    try { w.blur(); } catch (_) {}
    w.focus();
  }
  w.webContents.focus();
  return true;
});

// Klavye odağını ZORLA web içeriğine ver (Windows'ta webContents.focus() tek başına
// yetmiyor; native dialog kapanışındaki blur→focus turunu taklit eder). Yeşil Defter
// ilk açılışında kutuya yazılamama sorunu için.
ipcMain.handle('win:focus-force', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  if (!w || w.isDestroyed()) return true;
  try { w.blur(); } catch (_) {}
  try { w.focus(); } catch (_) {}
  try { w.focusOnWebView(); } catch (_) {}
  w.webContents.focus();
  return true;
});

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

ipcMain.handle('kasalar:guncelle', (_, d) => {
  run('UPDATE kasalar SET ad = ?, para_birimi = ? WHERE id = ?',
    [d.ad, d.para_birimi, d.id]);
  saveDb();
  return getOne('SELECT * FROM kasalar WHERE id = ?', [d.id]);
});

ipcMain.handle('kasalar:sil', (_, id) => {
  const hareketSayisi = getOne('SELECT COUNT(*) as n FROM kasa_hareketleri WHERE kasa_id = ?', [id]).n;
  if (hareketSayisi > 0) throw new Error('Bu kasada hareket var, silinemez.');
  run('DELETE FROM kasalar WHERE id = ?', [id]);
  saveDb();
  return true;
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

ipcMain.handle('kasa:rapor', (_, { bas, bit, kasa_id }) => {
  const where = [];
  const params = [];
  if (bas)     { where.push('kh.tarih >= ?'); params.push(bas); }
  if (bit)     { where.push('kh.tarih <= ?'); params.push(bit); }
  if (kasa_id) { where.push('kh.kasa_id = ?'); params.push(kasa_id); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return getAll(`
    SELECT kh.*, k.ad as kasa_ad, k.para_birimi,
           c.ad as cari_ad, p.ad as proje_ad
    FROM kasa_hareketleri kh
    JOIN kasalar k ON k.id = kh.kasa_id
    LEFT JOIN cariler c ON c.id = kh.cari_id
    LEFT JOIN projeler p ON p.id = kh.proje_id
    ${whereStr}
    ORDER BY kh.kasa_id ASC, kh.tarih ASC, kh.id ASC
  `, params);
});

const BANKA_TRANSFER_TUR = new Set(['bankaya-yatirilan', 'bankadan-cekilen']);

ipcMain.handle('kasa:fis:ekle', (_, d) => {
  console.log('[kasa:fis:ekle]', JSON.stringify(d));
  const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [d.kasa_id]);
  if (!kasa) throw new Error('Kasa bulunamadı');
  if (!d.tutar || d.tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır');

  const fis = insertAndGet('kasa_hareketleri',
    'INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, belge_no, cari_id, proje_id, ortak_id, kategori_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(d.kasa_id), d.tarih, d.tur, Number(d.tutar), d.aciklama ?? '', d.belge_no ?? '',
     d.cari_id ? Number(d.cari_id) : null, d.proje_id ? Number(d.proje_id) : null,
     d.ortak_id ? Number(d.ortak_id) : null, d.kategori_id ? Number(d.kategori_id) : null]
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
    if (cari) {
      const delta = cariTur === 'alacak' ? fis.tutar : -fis.tutar;
      run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, fis.cari_id]);
    }
  }

  saveDb();
  return fis;
});

ipcMain.handle('kasa:fis:sil', (_, id) => {
  const fis = getOne('SELECT * FROM kasa_hareketleri WHERE id = ?', [id]);
  if (!fis) return false;
  const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [fis.kasa_id]);
  const delta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
  if (kasa) run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kasa.bakiye + delta, kasa.id]);

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

  if (fis.cari_id && kasa) {
    const alan = kasa.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fis.cari_id]);
    if (cari) {
      const cariDelta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
      run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + cariDelta, fis.cari_id]);
    }
    run("DELETE FROM cari_hareketleri WHERE cari_id=? AND tutar=? AND tarih=? AND kaynak='kasa'",
      [fis.cari_id, fis.tutar, fis.tarih]);
  }
  run('DELETE FROM kasa_hareketleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// Hesaplar arası transfer (kasa↔kasa, banka↔banka, kasa↔banka)
ipcMain.handle('hesap:transfer', (_, d) => {
  const tutar = Number(d.tutar);
  if (!tutar || tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır.');
  if (d.kaynak_tip === d.hedef_tip && Number(d.kaynak_id) === Number(d.hedef_id))
    throw new Error('Kaynak ve hedef aynı olamaz.');
  const tarih = d.tarih || new Date().toISOString().split('T')[0];

  const oku = (tip, id) => tip === 'banka'
    ? getOne('SELECT id, banka_adi as ad, para_birimi, bakiye FROM banka_hesaplari WHERE id = ?', [id])
    : getOne('SELECT id, ad, para_birimi, bakiye FROM kasalar WHERE id = ?', [id]);
  const kaynak = oku(d.kaynak_tip, Number(d.kaynak_id));
  const hedef  = oku(d.hedef_tip, Number(d.hedef_id));
  if (!kaynak || !hedef) throw new Error('Kaynak/hedef hesap bulunamadı.');
  if (kaynak.para_birimi !== hedef.para_birimi)
    throw new Error('Farklı para birimleri arasında transfer yapılamaz.');

  const cikisAck = `Transfer → ${hedef.ad}`;
  const girisAck = `Transfer ← ${kaynak.ad}`;

  if (d.kaynak_tip === 'banka') {
    run('INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama) VALUES (?,?,?,?,?)', [kaynak.id, tarih, 'cikis', tutar, cikisAck]);
    run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [kaynak.bakiye - tutar, kaynak.id]);
  } else {
    run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama) VALUES (?,?,?,?,?)', [kaynak.id, tarih, 'odeme', tutar, cikisAck]);
    run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kaynak.bakiye - tutar, kaynak.id]);
  }
  if (d.hedef_tip === 'banka') {
    run('INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama) VALUES (?,?,?,?,?)', [hedef.id, tarih, 'giris', tutar, girisAck]);
    run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hedef.bakiye + tutar, hedef.id]);
  } else {
    run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama) VALUES (?,?,?,?,?)', [hedef.id, tarih, 'tahsilat', tutar, girisAck]);
    run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [hedef.bakiye + tutar, hedef.id]);
  }
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

ipcMain.handle('banka:rapor', (_, { bas, bit, hesap_id }) => {
  const where = [];
  const params = [];
  if (bas)      { where.push('bh.tarih >= ?'); params.push(bas); }
  if (bit)      { where.push('bh.tarih <= ?'); params.push(bit); }
  if (hesap_id) { where.push('bh.hesap_id = ?'); params.push(hesap_id); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return getAll(`
    SELECT bh.*, b.banka_adi, b.para_birimi,
           c.ad as cari_ad, p.ad as proje_ad
    FROM banka_hareketleri bh
    JOIN banka_hesaplari b ON b.id = bh.hesap_id
    LEFT JOIN cariler c ON c.id = bh.cari_id
    LEFT JOIN projeler p ON p.id = bh.proje_id
    ${whereStr}
    ORDER BY bh.hesap_id ASC, bh.tarih ASC, bh.id ASC
  `, params);
});

ipcMain.handle('banka:fis:ekle', (_, d) => {
  const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [d.hesap_id]);
  if (!hesap) throw new Error('Banka hesabı bulunamadı');
  if (!d.tutar || d.tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır');
  const fis = insertAndGet('banka_hareketleri',
    'INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no, cari_id, proje_id, ortak_id, kategori_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(d.hesap_id), d.tarih, d.tur, Number(d.tutar), d.aciklama ?? '', d.belge_no ?? '',
     d.cari_id ? Number(d.cari_id) : null, d.proje_id ? Number(d.proje_id) : null,
     d.ortak_id ? Number(d.ortak_id) : null, d.kategori_id ? Number(d.kategori_id) : null]
  );
  const yeniBakiye = hesap.bakiye + (isGiris(d.tur) ? fis.tutar : -fis.tutar);
  run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [yeniBakiye, hesap.id]);

  if (fis.cari_id) {
    const cariTur = isGiris(d.tur) ? 'alacak' : 'borc';
    run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fis.cari_id, fis.tarih, cariTur, fis.tutar, hesap.para_birimi, fis.aciklama, fis.belge_no, 'banka']);
    const alan = hesap.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fis.cari_id]);
    if (cari) {
      const delta = cariTur === 'alacak' ? fis.tutar : -fis.tutar;
      run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, fis.cari_id]);
    }
  }

  saveDb();
  return fis;
});

ipcMain.handle('banka:fis:sil', (_, id) => {
  const fis = getOne('SELECT * FROM banka_hareketleri WHERE id = ?', [id]);
  if (!fis) return false;
  const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [fis.hesap_id]);
  const delta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
  if (hesap) run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + delta, hesap.id]);

  if (fis.cari_id && hesap) {
    const alan = hesap.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fis.cari_id]);
    if (cari) {
      const cariDelta = isGiris(fis.tur) ? -fis.tutar : fis.tutar;
      run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + cariDelta, fis.cari_id]);
    }
    run("DELETE FROM cari_hareketleri WHERE cari_id=? AND tutar=? AND tarih=? AND kaynak='banka'",
      [fis.cari_id, fis.tutar, fis.tarih]);
  }

  run('DELETE FROM banka_hareketleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// STOK GRUPLAN
// ════════════════════════════════════════════════════════════

ipcMain.handle('stok-gruplan:getir', () => {
  return getAll('SELECT * FROM stok_gruplan ORDER BY ad');
});

ipcMain.handle('stok-gruplan:ekle', (_, d) => {
  const r = insertAndGet('stok_gruplan',
    'INSERT INTO stok_gruplan (ad, kod, aciklama, parent_id) VALUES (?, ?, ?, ?)',
    [d.ad || '', d.kod || '', d.aciklama || '', d.parent_id || null]
  );
  saveDb();
  return r;
});

ipcMain.handle('stok-gruplan:guncelle', (_, d) => {
  run('UPDATE stok_gruplan SET ad = ?, kod = ?, aciklama = ?, parent_id = ? WHERE id = ?',
    [d.ad || '', d.kod || '', d.aciklama || '', d.parent_id || null, d.id]);
  saveDb();
  return true;
});

ipcMain.handle('stok-gruplan:sil', (_, id) => {
  // Alt grupları ve stokları silinen grubun üst grubuna taşı
  const g = getOne('SELECT parent_id FROM stok_gruplan WHERE id = ?', [id]);
  const ust = g ? g.parent_id : null;
  run('DELETE FROM stok_gruplan WHERE id = ?', [id]);
  run('UPDATE stok_gruplan SET parent_id = ? WHERE parent_id = ?', [ust, id]);
  run('UPDATE stoklar SET grup_id = ? WHERE grup_id = ?', [ust, id]);
  saveDb();
  return true;
});

ipcMain.handle('stoklar:byGrup', (_, grup_id) => {
  return getAll('SELECT * FROM stoklar WHERE grup_id = ? OR (? IS NULL AND grup_id IS NULL) ORDER BY ad',
    [grup_id, grup_id]);
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
    'INSERT INTO cariler (ad, tur, telefon, adres, vergi_no, fatura_no_prefix) VALUES (?, ?, ?, ?, ?, ?)',
    [d.ad, d.tur, d.telefon ?? '', d.adres ?? '', d.vergi_no ?? '', d.fatura_no_prefix ?? '']
  );
  // Açılış bakiyesi — borç: cari bize borçlu (+), alacak: biz cariye borçluyuz (−)
  const acilis = Math.abs(Number(d.acilis) || 0);
  if (acilis > 0) {
    const pb = d.acilis_pb === 'IQD' ? 'IQD' : 'USD';
    const yon = d.acilis_yon === 'alacak' ? 'alacak' : 'borc';
    const alan = pb === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const delta = yon === 'borc' ? acilis : -acilis;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [delta, r.id]);
    run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [r.id, d.acilis_tarih || new Date().toISOString().split('T')[0], yon, acilis, pb, 'Açılış bakiyesi', '', 'acilis']);
  }
  saveDb();
  return getOne('SELECT * FROM cariler WHERE id = ?', [r.id]);
});

ipcMain.handle('cariler:guncelle', (_, d) => {
  run('UPDATE cariler SET ad = ?, tur = ?, telefon = ?, adres = ?, vergi_no = ?, fatura_no_prefix = ? WHERE id = ?',
    [d.ad, d.tur, d.telefon ?? '', d.adres ?? '', d.vergi_no ?? '', d.fatura_no_prefix ?? '', d.id]);
  saveDb();
  return getOne('SELECT * FROM cariler WHERE id = ?', [d.id]);
});

ipcMain.handle('cariler:sil', (_, id) => {
  const hareket = getOne('SELECT COUNT(*) as n FROM cari_hareketleri WHERE cari_id = ?', [id]).n;
  if (hareket > 0) throw new Error('Bu carinin hareketi var, silinemez.');
  const fatura = getOne('SELECT COUNT(*) as n FROM faturalar WHERE cari_id = ?', [id]).n;
  if (fatura > 0) throw new Error('Bu cariye ait fatura/irsaliye var, silinemez.');
  run('DELETE FROM cariler WHERE id = ?', [id]);
  saveDb();
  return true;
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

ipcMain.handle('projeler:guncelle', (_, id, d) => {
  run('UPDATE projeler SET ad=?, aciklama=?, durum=?, baslangic=?, bitis=? WHERE id=?',
    [d.ad, d.aciklama ?? '', d.durum ?? 'aktif', d.baslangic ?? '', d.bitis ?? '', id]);
  saveDb();
  return getOne('SELECT * FROM projeler WHERE id = ?', [id]);
});

ipcMain.handle('projeler:sil', (_, id) => {
  const k = getOne('SELECT COUNT(*) as n FROM kasa_hareketleri WHERE proje_id = ?', [id]).n;
  const b = getOne('SELECT COUNT(*) as n FROM banka_hareketleri WHERE proje_id = ?', [id]).n;
  if (k + b > 0) throw new Error('Bu projeye bağlı kasa/banka hareketi var, silinemez.');
  run('DELETE FROM projeler WHERE id = ?', [id]);
  saveDb();
  return true;
});

// Proje bazlı gelir/gider (kasa + banka hareketlerinden), para birimine göre
ipcMain.handle('proje:ozet', () => {
  const projeler = getAll('SELECT * FROM projeler ORDER BY id DESC');
  return projeler.map(p => {
    const rows = getAll(`
      SELECT tur, para_birimi, SUM(tutar) as toplam FROM (
        SELECT kh.tur as tur, k.para_birimi as para_birimi, kh.tutar as tutar
        FROM kasa_hareketleri kh JOIN kasalar k ON k.id = kh.kasa_id WHERE kh.proje_id = ?
        UNION ALL
        SELECT bh.tur as tur, b.para_birimi as para_birimi, bh.tutar as tutar
        FROM banka_hareketleri bh JOIN banka_hesaplari b ON b.id = bh.hesap_id WHERE bh.proje_id = ?
      ) GROUP BY tur, para_birimi
    `, [p.id, p.id]);
    const gelir = {}, gider = {};
    rows.forEach(r => {
      if (isGiris(r.tur)) gelir[r.para_birimi] = (gelir[r.para_birimi] || 0) + r.toplam;
      else                gider[r.para_birimi] = (gider[r.para_birimi] || 0) + r.toplam;
    });
    const kar = {};
    new Set([...Object.keys(gelir), ...Object.keys(gider)]).forEach(pb => {
      kar[pb] = (gelir[pb] || 0) - (gider[pb] || 0);
    });
    return { ...p, gelir, gider, kar };
  });
});

ipcMain.handle('proje:hareketler', (_, proje_id) =>
  getAll(`
    SELECT * FROM (
      SELECT kh.tarih as tarih, kh.tur as tur, kh.tutar as tutar, kh.aciklama as aciklama,
             k.para_birimi as para_birimi, k.ad as hesap, 'Kasa' as kaynak
      FROM kasa_hareketleri kh JOIN kasalar k ON k.id = kh.kasa_id WHERE kh.proje_id = ?
      UNION ALL
      SELECT bh.tarih as tarih, bh.tur as tur, bh.tutar as tutar, bh.aciklama as aciklama,
             b.para_birimi as para_birimi, b.banka_adi as hesap, 'Banka' as kaynak
      FROM banka_hareketleri bh JOIN banka_hesaplari b ON b.id = bh.hesap_id WHERE bh.proje_id = ?
    ) ORDER BY tarih DESC
  `, [proje_id, proje_id])
);

ipcMain.handle('kesif:getir', (_, proje_id, tur) => {
  const rows = getAll(
    'SELECT * FROM proje_kesif WHERE proje_id=? AND tur=? ORDER BY sira,id',
    [proje_id, tur]
  ).map(s => ({ ...s, tutar: (Number(s.miktar)||0) * (Number(s.birim_fiyat)||0) }));
  const genelToplam = rows.reduce((a,r) => a + r.tutar, 0);
  return { rows, genelToplam };
});

ipcMain.handle('kesif:kaydet', (_, proje_id, tur, satirlar) => {
  run('DELETE FROM proje_kesif WHERE proje_id=? AND tur=?', [proje_id, tur]);
  (satirlar||[]).forEach((s,i) =>
    run('INSERT INTO proje_kesif (proje_id,tur,poz_no,ad,birim,miktar,birim_fiyat,para_birimi,sira) VALUES (?,?,?,?,?,?,?,?,?)',
      [proje_id, tur, s.poz_no||'', s.ad||'', s.birim||'Adet',
       Number(s.miktar)||0, Number(s.birim_fiyat)||0, s.para_birimi||'USD', i+1])
  );
  saveDb();
  return true;
});

ipcMain.handle('iscilik:getir', (_, proje_id) => {
  const rows = getAll(
    'SELECT * FROM proje_iscilik_kesif WHERE proje_id=? ORDER BY sira,id',
    [proje_id]
  ).map(s => ({ ...s, toplam: (Number(s.gun)||0) * (Number(s.gundelik)||0) }));
  const genelToplam = rows.reduce((a,r) => a + r.toplam, 0);
  return { rows, genelToplam };
});

ipcMain.handle('iscilik:kaydet', (_, proje_id, satirlar) => {
  run('DELETE FROM proje_iscilik_kesif WHERE proje_id=?', [proje_id]);
  (satirlar||[]).forEach((s,i) =>
    run('INSERT INTO proje_iscilik_kesif (proje_id,isci_adi,gun,gundelik,para_birimi,sira) VALUES (?,?,?,?,?,?)',
      [proje_id, s.isci_adi||'', Number(s.gun)||0, Number(s.gundelik)||0, s.para_birimi||'USD', i+1])
  );
  saveDb();
  return true;
});

ipcMain.handle('3d:getir', (_, kesif_id) => {
  return getOne('SELECT * FROM proje_kesif_3d WHERE kesif_id=?', [kesif_id]) || null;
});

ipcMain.handle('3d:kaydet', (_, kesif_id, x, y, z, rx, ry, rz, olcek) => {
  const existing = getOne('SELECT id FROM proje_kesif_3d WHERE kesif_id=?', [kesif_id]);
  if (existing) {
    run('UPDATE proje_kesif_3d SET x=?, y=?, z=?, rotasyon_x=?, rotasyon_y=?, rotasyon_z=?, olcek=? WHERE kesif_id=?',
      [x, y, z, rx, ry, rz, olcek, kesif_id]);
  } else {
    run('INSERT INTO proje_kesif_3d (kesif_id, x, y, z, rotasyon_x, rotasyon_y, rotasyon_z, olcek) VALUES (?,?,?,?,?,?,?,?)',
      [kesif_id, x, y, z, rx, ry, rz, olcek]);
  }
  saveDb();
  return true;
});

ipcMain.handle('kat-plani:kaydet', (_, proje_id, data) => {
  const existing = getOne('SELECT id FROM proje_kat_plani WHERE proje_id=?', [proje_id]);
  const itemsJson = JSON.stringify(data.items || []);

  if (existing) {
    run('UPDATE proje_kat_plani SET resim_data=?, items_json=?, tur=?, guncelleme_tarihi=CURRENT_TIMESTAMP WHERE proje_id=?',
      [data.resim || null, itemsJson, data.tur || 'elektrik', proje_id]);
  } else {
    run('INSERT INTO proje_kat_plani (proje_id, resim_data, items_json, tur) VALUES (?,?,?,?)',
      [proje_id, data.resim || null, itemsJson, data.tur || 'elektrik']);
  }
  saveDb();
  return true;
});

ipcMain.handle('kat-plani:getir', (_, proje_id) => {
  const row = getOne('SELECT * FROM proje_kat_plani WHERE proje_id=?', [proje_id]);
  if (!row) return { resim: null, items: [] };
  return {
    resim: row.resim_data,
    items: row.items_json ? JSON.parse(row.items_json) : []
  };
});

ipcMain.handle('depo:kaydet', (_, proje_id, data) => {
  const existing = getOne('SELECT id FROM proje_depo_3d WHERE proje_id=?', [proje_id]);
  const nesnelerJson = JSON.stringify(data.nesneler || []);
  const katmanlarJson = JSON.stringify(data.katmanlar || []);

  if (existing) {
    run('UPDATE proje_depo_3d SET nesneler_json=?, katmanlar_json=?, tur=?, guncelleme_tarihi=CURRENT_TIMESTAMP WHERE proje_id=?',
      [nesnelerJson, katmanlarJson, data.tur || 'elektrik', proje_id]);
  } else {
    run('INSERT INTO proje_depo_3d (proje_id, nesneler_json, katmanlar_json, tur) VALUES (?,?,?,?)',
      [proje_id, nesnelerJson, katmanlarJson, data.tur || 'elektrik']);
  }
  saveDb();
  return true;
});

ipcMain.handle('depo:getir', (_, proje_id) => {
  const row = getOne('SELECT * FROM proje_depo_3d WHERE proje_id=?', [proje_id]);
  if (!row) return { nesneler: [], katmanlar: [] };
  return {
    nesneler: row.nesneler_json ? JSON.parse(row.nesneler_json) : [],
    katmanlar: row.katmanlar_json ? JSON.parse(row.katmanlar_json) : []
  };
});

ipcMain.handle('editor3d:kaydet', (_, proje_id, data) => {
  const existing = getOne('SELECT id FROM proje_3d_editor WHERE proje_id=?', [proje_id]);
  const nesnelerJson = JSON.stringify(data.nesneler || []);

  if (existing) {
    run('UPDATE proje_3d_editor SET nesneler_json=?, tur=?, guncelleme_tarihi=CURRENT_TIMESTAMP WHERE proje_id=?',
      [nesnelerJson, data.tur || 'elektrik', proje_id]);
  } else {
    run('INSERT INTO proje_3d_editor (proje_id, nesneler_json, tur) VALUES (?,?,?)',
      [proje_id, nesnelerJson, data.tur || 'elektrik']);
  }
  saveDb();
  return true;
});

ipcMain.handle('editor3d:getir', (_, proje_id) => {
  const row = getOne('SELECT * FROM proje_3d_editor WHERE proje_id=?', [proje_id]);
  if (!row) return { nesneler: [] };
  return {
    nesneler: row.nesneler_json ? JSON.parse(row.nesneler_json) : []
  };
});

// ── DWG → DXF Konversiyon ──
async function dwgToDxf(dwgPath, dxfPath) {
  const scriptContent = `FILEDIA\n0\n-SAVEAS\n_DXF\n"${dxfPath}"\n\nQUIT\n`;
  const scriptPath = path.join(os.tmpdir(), `conv-${Date.now()}.scr`);
  const logPath = path.join(os.tmpdir(), `conv-${Date.now()}.log`);
  fs.writeFileSync(scriptPath, scriptContent);

  return new Promise((resolve, reject) => {
    const accoreconsole = 'C:\\Program Files\\Autodesk\\AutoCAD 2026\\accoreconsole.exe';
    const logFile = fs.createWriteStream(logPath);
    const proc = spawn(accoreconsole, ['/i', dwgPath, '/s', scriptPath]);

    let stdout = '', stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d; logFile.write(d); });
    proc.stderr?.on('data', (d) => { stderr += d; logFile.write(d); });

    let exited = false;
    const timer = setTimeout(() => {
      if (!exited) {
        proc.kill('SIGKILL');
        exited = true;
        reject(new Error('Timeout: 180 saniye aşıldı'));
      }
    }, 180000);

    proc.on('exit', (code) => {
      exited = true;
      clearTimeout(timer);
      logFile.end();
      try { fs.unlinkSync(scriptPath); } catch (_) {}

      const log = fs.readFileSync(logPath, 'utf-8').slice(0, 500);
      if (fs.existsSync(dxfPath)) {
        try { fs.unlinkSync(logPath); } catch (_) {}
        resolve(dxfPath);
      } else {
        reject(new Error(`DXF oluşturulamadı. Log: ${log}`));
      }
    });

    proc.on('error', (err) => {
      exited = true;
      clearTimeout(timer);
      logFile.end();
      try { fs.unlinkSync(scriptPath); } catch (_) {}
      try { fs.unlinkSync(logPath); } catch (_) {}
      reject(err);
    });
  });
}

// ── DXF Parser (AutoCAD dosyasından keşif listesi çekme) ──
ipcMain.handle('dwg:openDxf', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'DXF Dosyası Seç (AutoCAD\'da export edin)',
    properties: ['openFile'],
    filters: [{ name: 'AutoCAD DXF', extensions: ['dxf'] }]
  });
  if (canceled || !filePaths?.length) return { ok: false };
  return { ok: true, filePath: filePaths[0] };
});

function mapDxfLayer(layer) {
  if (layer.includes('mekanik')) return 'mekanik';
  if (layer.includes('insaat') || layer.includes('inşaat')) return 'insaat';
  return 'elektrik';
}

ipcMain.handle('dwg:parseDxf', async (_, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Step 1: Parse BLOCKS section to get block descriptions
    const blockDescs = {}; // C1 -> "CEILING RECESSED..."
    let inBlocks = false;
    let currentBlockName = '';
    let i = 0;

    while (i < lines.length && i < lines.length / 2) { // BLOCKS section is early, limit scan
      const lineNum = lines[i].trim();
      if (lineNum === '0') {
        const entityType = lines[i + 1]?.trim();

        if (entityType === 'SECTION') {
          const nextCode = lines[i + 2]?.trim();
          if (nextCode === '2' && lines[i + 3]?.trim() === 'BLOCKS') {
            inBlocks = true;
            i += 4;
            continue;
          }
        }

        if (inBlocks && entityType === 'ENDSEC') {
          break; // end of BLOCKS
        }

        if (inBlocks && entityType === 'BLOCK') {
          let j = i + 2;
          while (j < lines.length && lines[j].trim() !== '0') {
            const code = lines[j].trim();
            if (code === '2') {
              currentBlockName = lines[j + 1]?.trim() || '';
              blockDescs[currentBlockName] = currentBlockName; // default to block name
            }
            j += 2;
          }
        }

        // First TEXT in a block = description
        if (inBlocks && entityType === 'TEXT' && currentBlockName) {
          let j = i + 2;
          while (j < lines.length && lines[j].trim() !== '0') {
            const code = lines[j].trim();
            if (code === '1') {
              const desc = lines[j + 1]?.trim() || '';
              if (desc && blockDescs[currentBlockName] === currentBlockName) {
                blockDescs[currentBlockName] = desc; // overwrite default
              }
              break; // only first TEXT
            }
            j += 2;
          }
        }
      }
      i++;
    }

    // Step 2: Parse ENTITIES section to count INSERT instances
    const blocks = {}; // block name -> { layer, count, description }
    i = 0;
    while (i < lines.length) {
      const lineNum = lines[i].trim();
      if (lineNum === '0') {
        const entityType = lines[i + 1]?.trim();

        // INSERT entity: count instances
        if (entityType === 'INSERT') {
          let layer = 'elektrik', blockName = '';
          let j = i + 2;
          while (j < lines.length && lines[j].trim() !== '0') {
            const code = lines[j].trim();
            if (code === '8') layer = (lines[j + 1]?.trim() || '').toLowerCase();
            if (code === '2') blockName = (lines[j + 1]?.trim() || '');
            j += 2;
          }
          if (blockName) {
            const mappedLayer = mapDxfLayer(layer);
            if (!blocks[blockName]) {
              blocks[blockName] = { layer: mappedLayer, count: 0, description: blockDescs[blockName] || blockName };
            }
            blocks[blockName].count++;
          }
          i = j;
          continue;
        }

        // TEXT entity: fallback (for non-block text entities)
        if (entityType === 'TEXT') {
          let layer = 'elektrik', text = '';
          let j = i + 2;
          while (j < lines.length && lines[j].trim() !== '0') {
            const code = lines[j].trim();
            if (code === '8') layer = (lines[j + 1]?.trim() || '').toLowerCase();
            if (code === '1') text = lines[j + 1]?.trim() || '';
            j += 2;
          }
          if (text && !blocks[text]) {
            blocks[text] = { layer: mapDxfLayer(layer), count: 1, description: text };
          }
          i = j;
          continue;
        }
      }
      i++;
    }

    // Convert to entity array: { layer, text, count }
    const entities = Object.entries(blocks).map(([name, info]) => ({
      layer: info.layer,
      text: info.description, // use description (malzeme adı)
      count: info.count
    }));

    return entities;
  } catch (e) {
    return { error: e.message };
  }
});

// ════════════════════════════════════════════════════════════
// FATURA
// ════════════════════════════════════════════════════════════

ipcMain.handle('sonraki:fatura:no', (_, tur, cari_id) => {
  // Cari özel prefix'i varsa onu kullan
  if (cari_id) {
    const cari = getOne('SELECT fatura_no_prefix FROM cariler WHERE id = ?', [cari_id]);
    if (cari?.fatura_no_prefix) {
      const prefix = cari.fatura_no_prefix;
      const baseNum = parseInt(prefix.replace(/\D/g, '')) || 0;
      const rows = getAll('SELECT fatura_no FROM faturalar WHERE cari_id = ?', [cari_id]);
      let max = baseNum;
      for (const r of rows) {
        const m = /(\d+)\s*$/.exec(r.fatura_no || '');
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      const nextNum = max + 1;
      const letters = prefix.replace(/\d/g, '');
      return letters + nextNum;
    }
  }
  // Default global numara
  const prefix = tur === 'satis' ? 'SAT' : 'AL';
  const rows = getAll('SELECT fatura_no FROM faturalar WHERE tur = ?', [tur]);
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)\s*$/.exec(r.fatura_no || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + '-' + String(max + 1).padStart(4, '0');
});

ipcMain.handle('faturalar:getir', (_, f) => {
  let sql = `
    SELECT f.*, c.ad as cari_ad
    FROM faturalar f
    LEFT JOIN cariler c ON c.id = f.cari_id
  `;
  const params = [];
  const conds = [];
  if (f?.tur === 'irsaliye')   { conds.push("f.belge_turu = 'irsaliye'"); }
  else if (f?.tur === 'teklif'){ conds.push("f.belge_turu = 'teklif'"); }
  else if (f?.tur)             { conds.push('f.tur = ?'); params.push(f.tur); conds.push("(f.belge_turu IS NULL OR f.belge_turu = 'fatura')"); }
  else                         { conds.push("(f.belge_turu IS NULL OR f.belge_turu != 'teklif')"); }
  if (f?.cari_id) { conds.push('f.cari_id = ?'); params.push(f.cari_id); }
  if (f?.bas)     { conds.push('f.tarih >= ?'); params.push(f.bas); }
  if (f?.bit)     { conds.push('f.tarih <= ?'); params.push(f.bit); }
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

  const belge_turu = ['irsaliye', 'teklif'].includes(d.belge_turu) ? d.belge_turu : 'fatura';
  const stokEtkiler = belge_turu !== 'teklif';   // teklif stoğa dokunmaz
  const cariEtkiler = belge_turu === 'fatura';   // sadece fatura cariye işler

  const fatura = insertAndGet('faturalar',
    'INSERT INTO faturalar (fatura_no, tur, tarih, cari_id, para_birimi, toplam, indirim, aciklama, durum, belge_turu, vade) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [d.fatura_no, d.tur, d.tarih,
     d.cari_id ? Number(d.cari_id) : null,
     d.para_birimi, toplam, indirim, d.aciklama ?? '', 'acik', belge_turu, d.vade ?? '']
  );

  for (const k of d.kalemler) {
    const kt = Math.round(k.miktar * k.birim_fiyat);
    run('INSERT INTO fatura_kalemleri (fatura_id, aciklama, birim, marka, miktar, birim_fiyat, toplam, stok_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fatura.id, k.aciklama, k.birim ?? 'Adet', k.marka ?? '', k.miktar, k.birim_fiyat, kt, k.stok_id ?? null]);
    if (k.stok_id && stokEtkiler) {
      const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [k.stok_id]);
      if (stok) {
        const isGiris = d.tur === 'alis';
        const yeni = isGiris ? stok.mevcut_miktar + k.miktar : stok.mevcut_miktar - k.miktar;
        run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [yeni, k.stok_id]);
        run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, fatura_id, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [k.stok_id, d.tarih, isGiris ? 'giris' : 'cikis', k.miktar, stok.mevcut_miktar, yeni, fatura.id, d.fatura_no]);
      }
    }
  }

  if (fatura.cari_id && cariEtkiler) {
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
  const belge_turu = eski.belge_turu ?? 'fatura';

  // Eski cari etkisini geri al (yalnızca fatura ise — irsaliye cariye işlememişti)
  if (eski.cari_id && belge_turu !== 'irsaliye') {
    const eskiGrand = Math.max(0, eski.toplam - (eski.indirim ?? 0));
    const eskiCariTur = eski.tur === 'satis' ? 'borc' : 'alacak';
    const alan = eski.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [eski.cari_id]);
    const geriDelta = eskiCariTur === 'borc' ? -eskiGrand : eskiGrand;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + geriDelta, eski.cari_id]);
    run('DELETE FROM cari_hareketleri WHERE belge_no = ? AND kaynak = ?', [eski.fatura_no, 'fatura']);
  }

  // Eski stok etkisini geri al
  if (eski.tur === 'alis' || eski.tur === 'satis') {
    const eskiKalemler = getAll('SELECT * FROM fatura_kalemleri WHERE fatura_id = ?', [id]);
    for (const k of eskiKalemler) {
      if (k.stok_id) {
        const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [k.stok_id]);
        if (stok) {
          const geri = eski.tur === 'alis'
            ? stok.mevcut_miktar - k.miktar
            : stok.mevcut_miktar + k.miktar;
          run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [geri, k.stok_id]);
        }
      }
    }
    run('DELETE FROM stok_hareketleri WHERE fatura_id = ?', [id]);
  }

  const yeniToplam = d.kalemler.reduce((s, k) => s + Math.round(k.miktar * k.birim_fiyat), 0);
  const yeniIndirim = Math.abs(d.indirim ?? 0);
  const yeniGrand = Math.max(0, yeniToplam - yeniIndirim);

  run('UPDATE faturalar SET fatura_no=?, tur=?, tarih=?, cari_id=?, para_birimi=?, toplam=?, indirim=?, aciklama=?, vade=? WHERE id=?',
    [d.fatura_no, d.tur, d.tarih,
     d.cari_id ? Number(d.cari_id) : null,
     d.para_birimi, yeniToplam, yeniIndirim, d.aciklama ?? '', d.vade ?? '', id]);

  run('DELETE FROM fatura_kalemleri WHERE fatura_id = ?', [id]);
  for (const k of d.kalemler) {
    const kt = Math.round(k.miktar * k.birim_fiyat);
    run('INSERT INTO fatura_kalemleri (fatura_id, aciklama, birim, marka, miktar, birim_fiyat, toplam, stok_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, k.aciklama, k.birim ?? 'Adet', k.marka ?? '', k.miktar, k.birim_fiyat, kt, k.stok_id ?? null]);
    // Yeni stok etkisini uygula
    if (k.stok_id && (d.tur === 'alis' || d.tur === 'satis')) {
      const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [k.stok_id]);
      if (stok) {
        const giris = d.tur === 'alis';
        const yeni = giris ? stok.mevcut_miktar + k.miktar : stok.mevcut_miktar - k.miktar;
        run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [yeni, k.stok_id]);
        run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, fatura_id, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [k.stok_id, d.tarih, giris ? 'giris' : 'cikis', k.miktar, stok.mevcut_miktar, yeni, id, d.fatura_no]);
      }
    }
  }

  if (d.cari_id && belge_turu !== 'irsaliye') {
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
  getAll('SELECT s.*, g.ad AS grup_ad FROM stoklar s LEFT JOIN stok_gruplan g ON g.id = s.grup_id ORDER BY s.ad')
);

ipcMain.handle('stoklar:ekle', (_, d) => {
  const r = insertAndGet('stoklar',
    'INSERT INTO stoklar (kod, ad, barkod, birim, grup_id, mevcut_miktar, min_miktar, alis_fiyat, satis_fiyat, para_birimi, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [d.kod ?? '', d.ad, d.barkod ?? '', d.birim ?? 'Pcs', d.grup_id || null, d.mevcut_miktar ?? 0, d.min_miktar ?? 0,
     d.alis_fiyat ?? 0, d.satis_fiyat ?? 0, d.para_birimi ?? 'USD', d.aciklama ?? '']
  );
  // Açılış miktarı varsa hareket olarak kaydet
  if ((d.mevcut_miktar ?? 0) > 0) {
    run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [r.id, new Date().toISOString().split('T')[0], 'giris', d.mevcut_miktar, 0, d.mevcut_miktar, 'Açılış miktarı']);
  }
  saveDb();
  return r;
});

// Excel'den toplu stok tanımı aktar (eşlenmiş satırlar)
ipcMain.handle('stoklar:import', (_, { satirlar }) => {
  let eklenen = 0;
  for (const s of (satirlar || [])) {
    if (!s.ad || !String(s.ad).trim()) continue;
    const miktar = Number(s.mevcut_miktar) || 0;
    const r = insertAndGet('stoklar',
      'INSERT INTO stoklar (kod, ad, barkod, birim, grup_id, mevcut_miktar, min_miktar, alis_fiyat, satis_fiyat, para_birimi, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [s.kod ?? '', String(s.ad).trim(), '', s.birim || 'Pcs', s.grup_id || null, miktar, 0,
       Number(s.alis_fiyat) || 0, Number(s.satis_fiyat) || 0, s.para_birimi || 'USD', '']);
    if (miktar > 0) {
      run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [r.id, new Date().toISOString().split('T')[0], 'giris', miktar, 0, miktar, 'Excel açılış miktarı']);
    }
    eklenen++;
  }
  saveDb();
  return { ok: true, eklenen };
});

ipcMain.handle('stoklar:guncelle', (_, id, d) => {
  // mevcut_miktar düzenlemesini stok hareketi olarak işle (manuel düzeltme)
  const eski = getOne('SELECT mevcut_miktar FROM stoklar WHERE id = ?', [id]);
  run('UPDATE stoklar SET kod=?, ad=?, barkod=?, birim=?, grup_id=?, mevcut_miktar=?, min_miktar=?, alis_fiyat=?, satis_fiyat=?, para_birimi=?, aciklama=?, kategori=? WHERE id=?',
    [d.kod ?? '', d.ad, d.barkod ?? '', d.birim ?? 'Pcs', d.grup_id || null, d.mevcut_miktar ?? 0, d.min_miktar ?? 0,
     d.alis_fiyat ?? 0, d.satis_fiyat ?? 0, d.para_birimi ?? 'USD', d.aciklama ?? '', '', id]);
  if (eski && eski.mevcut_miktar !== (d.mevcut_miktar ?? 0)) {
    const fark = (d.mevcut_miktar ?? 0) - eski.mevcut_miktar;
    run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, new Date().toISOString().split('T')[0], fark > 0 ? 'giris' : 'cikis', Math.abs(fark),
       eski.mevcut_miktar, d.mevcut_miktar ?? 0, 'Kart düzenleme — miktar düzeltmesi']);
  }
  saveDb();
  return true;
});

// Manuel stok hareketi: giris / cikis / sayim / fire
ipcMain.handle('stok:hareket:ekle', (_, d) => {
  const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [d.stok_id]);
  if (!stok) throw new Error('Stok bulunamadı');
  const miktar = Number(d.miktar);
  if (!miktar || miktar <= 0) throw new Error('Miktar sıfırdan büyük olmalıdır');
  const onceki = stok.mevcut_miktar;
  let sonraki, tur, etiket;
  if (d.tur === 'sayim') {
    sonraki = miktar;                 // sayımda miktar = yeni fiili stok
    tur = sonraki >= onceki ? 'giris' : 'cikis';
    etiket = d.aciklama?.trim() || 'Sayım düzeltmesi';
  } else if (d.tur === 'fire') {
    sonraki = onceki - miktar;
    tur = 'cikis';
    etiket = d.aciklama?.trim() || 'Fire / Zayi';
  } else if (d.tur === 'cikis') {
    sonraki = onceki - miktar;
    tur = 'cikis';
    etiket = d.aciklama?.trim() || 'Manuel çıkış';
  } else {
    sonraki = onceki + miktar;
    tur = 'giris';
    etiket = d.aciklama?.trim() || 'Manuel giriş';
  }
  run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [sonraki, stok.id]);
  run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [stok.id, d.tarih || new Date().toISOString().split('T')[0], tur, Math.abs(sonraki - onceki), onceki, sonraki, etiket]);
  saveDb();
  return true;
});

// Manuel hareket sil (sadece faturasız hareketler tersine alınabilir)
ipcMain.handle('stok:hareket:sil', (_, id) => {
  const h = getOne('SELECT * FROM stok_hareketleri WHERE id = ?', [id]);
  if (!h) return false;
  if (h.fatura_id) throw new Error('Faturaya bağlı hareket buradan silinemez — faturayı düzenleyin/silin.');
  const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [h.stok_id]);
  if (stok) {
    const geri = h.tur === 'giris' ? stok.mevcut_miktar - h.miktar : stok.mevcut_miktar + h.miktar;
    run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [geri, stok.id]);
  }
  run('DELETE FROM stok_hareketleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// Stok değeri özeti (para birimine göre toplam maliyet ve satış değeri)
ipcMain.handle('stok:deger', () => {
  const stoklar = getAll('SELECT * FROM stoklar');
  const ozet = {};
  stoklar.forEach(s => {
    const pb = s.para_birimi || 'USD';
    if (!ozet[pb]) ozet[pb] = { maliyet: 0, satis: 0, kalem: 0 };
    ozet[pb].maliyet += (s.mevcut_miktar || 0) * (s.alis_fiyat || 0);
    ozet[pb].satis   += (s.mevcut_miktar || 0) * (s.satis_fiyat || 0);
    ozet[pb].kalem   += 1;
  });
  return ozet;
});

ipcMain.handle('stoklar:sil', (_, id) => {
  run('DELETE FROM stoklar WHERE id = ?', [id]);
  run('DELETE FROM stok_hareketleri WHERE stok_id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('stok:hareketler', (_, stokId) =>
  getAll(`
    SELECT sh.*, f.fatura_no
    FROM stok_hareketleri sh
    LEFT JOIN faturalar f ON f.id = sh.fatura_id
    WHERE sh.stok_id = ?
    ORDER BY sh.tarih DESC, sh.id DESC
  `, [stokId])
);

ipcMain.handle('fatura:sil', (_, id) => {
  const fatura = getOne('SELECT * FROM faturalar WHERE id = ?', [id]);
  if (!fatura) return false;

  // Cari bakiyesi yalnızca 'fatura' belge türünde işlenmişti (irsaliye/teklif cariye dokunmaz);
  // sadece onda geri al. Cari silinmiş olabilir → null kontrolü.
  if (fatura.cari_id && fatura.belge_turu === 'fatura') {
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [fatura.cari_id]);
    if (cari) {
      const grandToplam = Math.max(0, fatura.toplam - (fatura.indirim ?? 0));
      const cariTur = fatura.tur === 'satis' ? 'borc' : 'alacak';
      const alan = fatura.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
      const delta = cariTur === 'borc' ? -grandToplam : grandToplam;
      run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, fatura.cari_id]);
    }
    run("DELETE FROM cari_hareketleri WHERE belge_no=? AND kaynak='fatura'", [fatura.fatura_no]);
  }

  if (fatura.tur === 'alis' || fatura.tur === 'satis') {
    const kalemler = getAll('SELECT * FROM fatura_kalemleri WHERE fatura_id = ?', [id]);
    for (const k of kalemler) {
      if (k.stok_id) {
        const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [k.stok_id]);
        if (stok) {
          const geri = fatura.tur === 'alis'
            ? stok.mevcut_miktar - k.miktar
            : stok.mevcut_miktar + k.miktar;
          run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [geri, k.stok_id]);
        }
      }
    }
    run('DELETE FROM stok_hareketleri WHERE fatura_id = ?', [id]);
  }

  run('DELETE FROM fatura_kalemleri WHERE fatura_id = ?', [id]);
  run('DELETE FROM faturalar WHERE id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('fatura:faturalandir', (_, id) => {
  const f = getOne('SELECT * FROM faturalar WHERE id = ?', [id]);
  if (!f) throw new Error('Belge bulunamadı.');
  if (f.belge_turu !== 'irsaliye') throw new Error('Zaten faturalandırılmış.');
  if (!f.cari_id) throw new Error('Cari seçilmeden faturalandırılamaz — önce düzenleyin.');

  run("UPDATE faturalar SET belge_turu = 'fatura' WHERE id = ?", [id]);

  const grandToplam = Math.max(0, f.toplam - (f.indirim ?? 0));
  const cariTur = f.tur === 'satis' ? 'borc' : 'alacak';
  const alan = f.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
  run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [f.cari_id, f.tarih, cariTur, grandToplam, f.para_birimi, f.aciklama, f.fatura_no, 'fatura']);
  const cari = getOne('SELECT * FROM cariler WHERE id = ?', [f.cari_id]);
  const delta = cariTur === 'borc' ? grandToplam : -grandToplam;
  run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, f.cari_id]);

  saveDb();
  return true;
});

// Teklifi faturaya (veya irsaliyeye) dönüştür — stok + cari etkisini uygular
ipcMain.handle('fatura:teklif:donustur', (_, id, hedef) => {
  const f = getOne('SELECT * FROM faturalar WHERE id = ?', [id]);
  if (!f) throw new Error('Belge bulunamadı.');
  if (f.belge_turu !== 'teklif') throw new Error('Bu belge teklif değil.');
  const yeniTur = hedef === 'irsaliye' ? 'irsaliye' : 'fatura';

  run('UPDATE faturalar SET belge_turu = ? WHERE id = ?', [yeniTur, id]);

  // Stok etkisi (her iki hedefte de uygulanır)
  const kalemler = getAll('SELECT * FROM fatura_kalemleri WHERE fatura_id = ?', [id]);
  for (const k of kalemler) {
    if (k.stok_id) {
      const stok = getOne('SELECT * FROM stoklar WHERE id = ?', [k.stok_id]);
      if (stok) {
        const giris = f.tur === 'alis';
        const yeni = giris ? stok.mevcut_miktar + k.miktar : stok.mevcut_miktar - k.miktar;
        run('UPDATE stoklar SET mevcut_miktar = ? WHERE id = ?', [yeni, k.stok_id]);
        run('INSERT INTO stok_hareketleri (stok_id, tarih, tur, miktar, onceki_miktar, sonraki_miktar, fatura_id, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [k.stok_id, f.tarih, giris ? 'giris' : 'cikis', k.miktar, stok.mevcut_miktar, yeni, id, f.fatura_no]);
      }
    }
  }

  // Cari etkisi (sadece fatura hedefinde)
  if (yeniTur === 'fatura' && f.cari_id) {
    const grandToplam = Math.max(0, f.toplam - (f.indirim ?? 0));
    const cariTur = f.tur === 'satis' ? 'borc' : 'alacak';
    const alan = f.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
    run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [f.cari_id, f.tarih, cariTur, grandToplam, f.para_birimi, f.aciklama, f.fatura_no, 'fatura']);
    const cari = getOne('SELECT * FROM cariler WHERE id = ?', [f.cari_id]);
    const delta = cariTur === 'borc' ? grandToplam : -grandToplam;
    run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, f.cari_id]);
  }

  saveDb();
  return true;
});

// Vade/yaşlandırma raporu — açık (ödenmemiş) faturalar, vade gününe göre kovalar
ipcMain.handle('rapor:yaslandirma', () => {
  const bugun = new Date(); bugun.setHours(0,0,0,0);
  const faturalar = getAll(`
    SELECT f.*, c.ad as cari_ad FROM faturalar f LEFT JOIN cariler c ON c.id = f.cari_id
    WHERE (f.belge_turu IS NULL OR f.belge_turu = 'fatura') AND f.cari_id IS NOT NULL
      AND (COALESCE(f.odenen,0) < (f.toplam - COALESCE(f.indirim,0)) - 0.001)
    ORDER BY f.vade ASC, f.tarih ASC`);
  return faturalar.map(f => {
    const kalan = Math.max(0, f.toplam - (f.indirim || 0) - (f.odenen || 0));
    let gecikme = null;
    const vadeStr = f.vade || '';
    if (vadeStr) {
      const v = new Date(vadeStr); v.setHours(0,0,0,0);
      gecikme = Math.round((bugun - v) / 86400000); // pozitif = gün gecikmiş
    }
    let kova = 'vadesiz';
    if (gecikme !== null) {
      if (gecikme < 0)        kova = 'gelecek';
      else if (gecikme <= 30) kova = '0-30';
      else if (gecikme <= 60) kova = '30-60';
      else                    kova = '60+';
    }
    return { id: f.id, fatura_no: f.fatura_no, tur: f.tur, cari_ad: f.cari_ad,
             para_birimi: f.para_birimi, tarih: f.tarih, vade: vadeStr, kalan, gecikme, kova };
  });
});

// Kategori bazlı gelir/gider raporu (kasa + banka hareketleri)
ipcMain.handle('rapor:kategori', (_, { bas, bit }) => {
  const where = [], params = [];
  if (bas) { where.push('h.tarih >= ?'); params.push(bas); }
  if (bit) { where.push('h.tarih <= ?'); params.push(bit); }
  const ws = where.length ? 'AND ' + where.join(' AND ') : '';
  const rows = getAll(`
    SELECT k.ad as kategori, k.tur as kat_tur, h.tur as hareket_tur, h.pb as para_birimi, SUM(h.tutar) as toplam, COUNT(*) as adet
    FROM (
      SELECT kh.kategori_id as kategori_id, kh.tur as tur, kh.tutar as tutar, ka.para_birimi as pb, kh.tarih as tarih
      FROM kasa_hareketleri kh JOIN kasalar ka ON ka.id = kh.kasa_id WHERE kh.kategori_id IS NOT NULL
      UNION ALL
      SELECT bh.kategori_id as kategori_id, bh.tur as tur, bh.tutar as tutar, b.para_birimi as pb, bh.tarih as tarih
      FROM banka_hareketleri bh JOIN banka_hesaplari b ON b.id = bh.hesap_id WHERE bh.kategori_id IS NOT NULL
    ) h
    JOIN kategoriler k ON k.id = h.kategori_id
    WHERE 1=1 ${ws}
    GROUP BY k.id, h.pb
    ORDER BY k.tur, k.ad
  `, params);
  return rows;
});

// Faturaya tahsilat/ödeme — kasa/banka fişi oluşturur, cari bakiyesini günceller, fatura durumunu işler
ipcMain.handle('fatura:tahsilat', (_, d) => {
  const f = getOne('SELECT * FROM faturalar WHERE id = ?', [d.fatura_id]);
  if (!f) throw new Error('Fatura bulunamadı.');
  if (!f.cari_id) throw new Error('Carisi olmayan faturaya tahsilat işlenemez.');
  const tutar = Number(d.tutar);
  if (!tutar || tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır.');

  const grand = Math.max(0, f.toplam - (f.indirim ?? 0));
  const kalan = grand - (f.odenen ?? 0);
  if (tutar > kalan + 0.001) throw new Error(`Kalan tutardan fazla giremezsiniz. Kalan: ${kalan}`);

  // Satış → müşteriden tahsilat (giriş). Alış → tedarikçiye ödeme (çıkış).
  const tahsilatMi = f.tur === 'satis';
  const aciklama = `${tahsilatMi ? 'Tahsilat' : 'Ödeme'} — Fatura ${f.fatura_no}`;

  if (d.odeme_turu === 'banka' && d.kaynak_id) {
    const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [Number(d.kaynak_id)]);
    if (!hesap) throw new Error('Banka hesabı bulunamadı.');
    const tur = tahsilatMi ? 'giris' : 'cikis';
    run('INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no, cari_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [hesap.id, d.tarih, tur, tutar, aciklama, f.fatura_no, f.cari_id]);
    run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + (tahsilatMi ? tutar : -tutar), hesap.id]);
  } else if (d.kaynak_id) {
    const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [Number(d.kaynak_id)]);
    if (!kasa) throw new Error('Kasa bulunamadı.');
    const tur = tahsilatMi ? 'tahsilat' : 'odeme';
    run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, belge_no, cari_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [kasa.id, d.tarih, tur, tutar, aciklama, f.fatura_no, f.cari_id]);
    run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kasa.bakiye + (tahsilatMi ? tutar : -tutar), kasa.id]);
  } else {
    throw new Error('Kasa/Banka seçilmedi.');
  }

  // Cari bakiyesi: tahsilatta cari alacak (borcu azalır), ödemede cari borç (alacağı azalır)
  const cariTur = tahsilatMi ? 'alacak' : 'borc';
  const alan = f.para_birimi === 'USD' ? 'bakiye_USD' : 'bakiye_IQD';
  const cari = getOne('SELECT * FROM cariler WHERE id = ?', [f.cari_id]);
  const delta = cariTur === 'alacak' ? -tutar : tutar;
  run(`UPDATE cariler SET ${alan} = ? WHERE id = ?`, [cari[alan] + delta, f.cari_id]);
  run('INSERT INTO cari_hareketleri (cari_id, tarih, tur, tutar, para_birimi, aciklama, belge_no, kaynak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [f.cari_id, d.tarih, cariTur, tutar, f.para_birimi, aciklama, f.fatura_no, d.odeme_turu === 'banka' ? 'banka' : 'kasa']);

  const yeniOdenen = (f.odenen ?? 0) + tutar;
  const durum = yeniOdenen >= grand - 0.001 ? 'odendi' : 'kismi';
  run('UPDATE faturalar SET odenen = ?, durum = ? WHERE id = ?', [yeniOdenen, durum, f.id]);

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

// HTML tabloyu Excel'de açılan .xls dosyasına aktar (kayıt yeri sorar)
ipcMain.handle('export:xls', async (_, { html, ad, sheet }) => {
  const sheetAd = (sheet || 'Sayfa1').replace(/[^\w]/g, '_');
  const wrapped = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${sheetAd}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>table{border-collapse:collapse} td,th{font-family:'Segoe UI',Arial;font-size:11px}</style>
</head><body>${html}</body></html>`;

  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Excel Olarak Kaydet',
    defaultPath: `${(ad || 'albrus')}-${stamp}.xls`,
    filters: [{ name: 'Excel', extensions: ['xls'] }]
  });
  if (canceled || !filePath) return { ok: false, iptal: true };
  fs.writeFileSync(filePath, '﻿' + wrapped, 'utf8');
  shell.openPath(filePath);
  return { ok: true, path: filePath };
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

ipcMain.handle('personeller:getir', () => {
  const personeller = getAll('SELECT p.*, pr.ad AS proje_ad FROM personeller p LEFT JOIN projeler pr ON pr.id = p.proje_id ORDER BY p.ad, p.soyad');
  return personeller.map(p => {
    const alacak = getOne("SELECT COALESCE(SUM(tutar),0) as t FROM personel_hareketleri WHERE personel_id=? AND tur='alacak'", [p.id])?.t || 0;
    const borc   = getOne("SELECT COALESCE(SUM(tutar),0) as t FROM personel_hareketleri WHERE personel_id=? AND tur='borc'",   [p.id])?.t || 0;
    return { ...p, alacak, borc, net_alacak: alacak - borc };
  });
});

ipcMain.handle('personeller:ekle', (_, d) => {
  const r = insertAndGet('personeller',
    'INSERT INTO personeller (ad, soyad, pozisyon, telefon, ise_giris, maas, para_birimi, durum, proje_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [d.ad, d.soyad ?? '', d.pozisyon ?? '', d.telefon ?? '', d.ise_giris ?? '', d.maas ?? 0, d.para_birimi ?? 'USD', d.durum ?? 'aktif', d.proje_id || null]
  );
  saveDb();
  return r;
});

ipcMain.handle('personeller:import', (_, { satirlar }) => {
  let eklenen = 0;
  for (const s of (satirlar || [])) {
    if (!s.ad || !String(s.ad).trim()) continue;
    insertAndGet('personeller',
      'INSERT INTO personeller (ad, soyad, pozisyon, telefon, ise_giris, maas, para_birimi, durum, proje_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [String(s.ad).trim(), s.soyad ?? '', s.pozisyon ?? '', s.telefon ?? '', s.ise_giris ?? '',
       Number(s.maas) || 0, s.para_birimi || 'USD', 'aktif', s.proje_id || null]);
    eklenen++;
  }
  saveDb();
  return { ok: true, eklenen };
});

ipcMain.handle('personeller:guncelle', (_, id, d) => {
  run('UPDATE personeller SET ad=?, soyad=?, pozisyon=?, telefon=?, ise_giris=?, maas=?, para_birimi=?, durum=?, proje_id=? WHERE id=?',
    [d.ad, d.soyad ?? '', d.pozisyon ?? '', d.telefon ?? '', d.ise_giris ?? '', d.maas ?? 0, d.para_birimi ?? 'USD', d.durum ?? 'aktif', d.proje_id || null, id]);
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
  const prim = Number(d.prim) || 0;
  const net = Math.max(0, brut + prim - kesinti);

  const odeme = insertAndGet('maas_odemeleri',
    'INSERT INTO maas_odemeleri (personel_id, donem, tarih, brut, kesinti, prim, kesinti_neden, net, para_birimi, odeme_turu, kaynak_id, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [d.personel_id, d.donem, d.tarih, brut, kesinti, prim, d.kesinti_neden ?? '', net,
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

  run('INSERT INTO personel_hareketleri (personel_id, tarih, tur, tutar, kaynak, aciklama) VALUES (?,?,?,?,?,?)',
    [d.personel_id, d.tarih, 'borc', net, 'maas_odeme', aciklama]);

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

  run("DELETE FROM personel_hareketleri WHERE id=(SELECT id FROM personel_hareketleri WHERE kaynak='maas_odeme' AND tutar=? AND tarih=? AND personel_id=? AND tur='borc' ORDER BY id DESC LIMIT 1)",
    [odeme.net, odeme.tarih, odeme.personel_id]);
  run('DELETE FROM maas_odemeleri WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// PUANTAJ
// ════════════════════════════════════════════════════════════

ipcMain.handle('puantaj:getir', (_, personel_id, yil, ay) =>
  getAll('SELECT gun, durum, COALESCE(mesai_saat,0) as mesai_saat FROM puantaj WHERE personel_id = ? AND yil = ? AND ay = ? ORDER BY gun',
    [personel_id, yil, ay])
);

ipcMain.handle('puantaj:guncelle', (_, personel_id, yil, ay, gun, durum) => {
  if (durum === '') {
    run('DELETE FROM puantaj WHERE personel_id = ? AND yil = ? AND ay = ? AND gun = ?',
      [personel_id, yil, ay, gun]);
  } else {
    run('INSERT OR IGNORE INTO puantaj (personel_id, yil, ay, gun, durum, mesai_saat) VALUES (?,?,?,?,?,0)',
      [personel_id, yil, ay, gun, durum]);
    run('UPDATE puantaj SET durum=?, mesai_saat=0 WHERE personel_id=? AND yil=? AND ay=? AND gun=?',
      [durum, personel_id, yil, ay, gun]);
  }
  run("DELETE FROM personel_hareketleri WHERE personel_id=? AND yil=? AND ay=? AND gun=? AND kaynak IN ('puantaj','mesai')",
    [personel_id, yil, ay, gun]);
  if (durum === 'X' || durum === 'İ') {
    const p = getOne('SELECT maas FROM personeller WHERE id=?', [personel_id]);
    if (p && p.maas > 0) {
      const tarih = `${yil}-${String(ay).padStart(2,'0')}-${String(gun).padStart(2,'0')}`;
      run('INSERT INTO personel_hareketleri (personel_id, tarih, tur, tutar, kaynak, yil, ay, gun, aciklama) VALUES (?,?,?,?,?,?,?,?,?)',
        [personel_id, tarih, 'alacak', p.maas / 30, 'puantaj', yil, ay, gun,
         durum === 'X' ? 'Çalışma günü' : 'Ücretli izin']);
    }
  }
  saveDb();
  return true;
});

ipcMain.handle('puantaj:mesai:guncelle', (_, personel_id, yil, ay, gun, mesai_saat) => {
  run('UPDATE puantaj SET mesai_saat=? WHERE personel_id=? AND yil=? AND ay=? AND gun=?',
    [mesai_saat, personel_id, yil, ay, gun]);
  run("DELETE FROM personel_hareketleri WHERE personel_id=? AND yil=? AND ay=? AND gun=? AND kaynak='mesai'",
    [personel_id, yil, ay, gun]);
  if (mesai_saat > 0) {
    const p = getOne('SELECT maas FROM personeller WHERE id=?', [personel_id]);
    if (p && p.maas > 0) {
      const saatlik = (p.maas / 30) / 9;
      const tarih = `${yil}-${String(ay).padStart(2,'0')}-${String(gun).padStart(2,'0')}`;
      run('INSERT INTO personel_hareketleri (personel_id, tarih, tur, tutar, kaynak, yil, ay, gun, aciklama) VALUES (?,?,?,?,?,?,?,?,?)',
        [personel_id, tarih, 'alacak', mesai_saat * saatlik, 'mesai', yil, ay, gun,
         `Mesai (${mesai_saat} saat)`]);
    }
  }
  saveDb();
  return true;
});

ipcMain.handle('puantaj:toplu:ozet', (_, yil, ay) => {
  const personeller = getAll('SELECT * FROM personeller ORDER BY ad, soyad');
  return personeller.map(p => {
    const gunler = getAll(
      'SELECT gun, durum, COALESCE(mesai_saat,0) as mesai_saat FROM puantaj WHERE personel_id=? AND yil=? AND ay=? ORDER BY gun',
      [p.id, yil, ay]);
    const durumMap = {};
    const mesaiMap = {};
    gunler.forEach(g => {
      durumMap[g.gun] = g.durum;
      if (g.mesai_saat > 0) mesaiMap[g.gun] = g.mesai_saat;
    });
    const x  = gunler.filter(g => g.durum === 'X').length;
    const iz = gunler.filter(g => g.durum === 'İ').length;
    const g2 = gunler.filter(g => g.durum === 'G').length;
    const gunluk  = p.maas > 0 ? p.maas / 30 : 0;
    const saatlik = gunluk / 9;
    const mesaiToplamSaat = gunler.reduce((s, g) => s + (g.mesai_saat || 0), 0);
    const mesai_ucreti = mesaiToplamSaat * saatlik;
    return { ...p, x_gun: x, i_gun: iz, g_gun: g2, gunluk, saatlik,
             net_kazanc: (x + iz) * gunluk + mesai_ucreti,
             mesai_saat_toplam: mesaiToplamSaat, mesai_ucreti, durumMap, mesaiMap };
  });
});

ipcMain.handle('personel:kasa:ode', (_, d) => {
  const personel = getOne('SELECT * FROM personeller WHERE id=?', [d.personel_id]);
  if (!personel) throw new Error('Personel bulunamadı');
  const kasa = getOne('SELECT * FROM kasalar WHERE id=?', [d.kasa_id]);
  if (!kasa) throw new Error('Kasa bulunamadı');
  if (!d.tutar || d.tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır');

  const adSoyad = `${personel.ad}${personel.soyad ? ' ' + personel.soyad : ''}`;
  const aciklama = d.aciklama?.trim() || `Personel Ödemesi: ${adSoyad}`;

  run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama) VALUES (?,?,?,?,?)',
    [kasa.id, d.tarih, 'odeme', d.tutar, aciklama]);
  run('UPDATE kasalar SET bakiye=? WHERE id=?', [kasa.bakiye - d.tutar, kasa.id]);
  run('INSERT INTO personel_hareketleri (personel_id, tarih, tur, tutar, kaynak, aciklama) VALUES (?,?,?,?,?,?)',
    [personel.id, d.tarih, 'borc', d.tutar, 'kasa_odeme', aciklama]);

  saveDb();
  return true;
});

// Personel hesap ekstresi — tüm hareketler (alacak: hak ediş, borç: ödeme/avans)
ipcMain.handle('personel:ekstre', (_, personel_id) => {
  const personel = getOne('SELECT * FROM personeller WHERE id = ?', [personel_id]);
  if (!personel) throw new Error('Personel bulunamadı');
  const hareketler = getAll(
    'SELECT tarih, tur, tutar, kaynak, aciklama FROM personel_hareketleri WHERE personel_id = ? ORDER BY tarih ASC, id ASC',
    [personel_id]);
  const alacak = hareketler.filter(h => h.tur === 'alacak').reduce((s, h) => s + h.tutar, 0);
  const borc   = hareketler.filter(h => h.tur === 'borc').reduce((s, h) => s + h.tutar, 0);
  return { personel, hareketler, alacak, borc, net: alacak - borc };
});

// Avans — kasa/bankadan düşer, personele borç olarak işlenir (maaştan mahsup edilir)
ipcMain.handle('personel:avans:ekle', (_, d) => {
  const personel = getOne('SELECT * FROM personeller WHERE id=?', [d.personel_id]);
  if (!personel) throw new Error('Personel bulunamadı');
  if (!d.tutar || d.tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır');

  const adSoyad = `${personel.ad}${personel.soyad ? ' ' + personel.soyad : ''}`;
  const aciklama = d.aciklama?.trim() || `Avans: ${adSoyad}`;

  if (d.odeme_turu === 'banka' && d.kaynak_id) {
    const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id=?', [Number(d.kaynak_id)]);
    if (!hesap) throw new Error('Banka hesabı bulunamadı');
    run('INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama) VALUES (?,?,?,?,?)',
      [hesap.id, d.tarih, 'cikis', d.tutar, aciklama]);
    run('UPDATE banka_hesaplari SET bakiye=? WHERE id=?', [hesap.bakiye - d.tutar, hesap.id]);
  } else if (d.kaynak_id) {
    const kasa = getOne('SELECT * FROM kasalar WHERE id=?', [Number(d.kaynak_id)]);
    if (!kasa) throw new Error('Kasa bulunamadı');
    run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama) VALUES (?,?,?,?,?)',
      [kasa.id, d.tarih, 'odeme', d.tutar, aciklama]);
    run('UPDATE kasalar SET bakiye=? WHERE id=?', [kasa.bakiye - d.tutar, kasa.id]);
  }

  run('INSERT INTO personel_hareketleri (personel_id, tarih, tur, tutar, kaynak, aciklama) VALUES (?,?,?,?,?,?)',
    [personel.id, d.tarih, 'borc', d.tutar, 'avans', aciklama]);

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
// YEDEKLEME / GERİ YÜKLEME
// ════════════════════════════════════════════════════════════

ipcMain.handle('ayar:getir', (_, anahtar) => {
  const r = getOne('SELECT deger FROM ayarlar WHERE anahtar = ?', [anahtar]);
  return r ? r.deger : null;
});

ipcMain.handle('ayar:kaydet', (_, anahtar, deger) => {
  run('INSERT INTO ayarlar (anahtar, deger) VALUES (?, ?) ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger',
    [anahtar, String(deger)]);
  saveDb();
  return true;
});

// ── Lisans ──
ipcMain.handle('lisans:durum', () => {
  const key = (getOne("SELECT deger FROM ayarlar WHERE anahtar = 'lisans_key'") || {}).deger || '';
  return { makineKimligi: makineKimligi(), aktif: lisansGecerliMi(key) };
});

ipcMain.handle('lisans:aktiflestir', (_, key) => {
  if (!lisansGecerliMi(key)) return { ok: false, hata: 'Geçersiz lisans anahtarı (bu bilgisayar için değil).' };
  run("INSERT INTO ayarlar (anahtar, deger) VALUES ('lisans_key', ?) ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger", [String(key).replace(/\s+/g, '')]);
  saveDb();
  return { ok: true };
});

// ── Genel Mali Durum Raporu ──────────────────────────────────
ipcMain.handle('rapor:mali', () => {
  const kuruRow = getOne("SELECT deger FROM ayarlar WHERE anahtar = 'usd_iqd_kuru'");
  const kur = parseFloat(kuruRow?.deger) || 1310;

  const kasalar  = getAll('SELECT * FROM kasalar ORDER BY para_birimi, ad');
  const bankalar = getAll('SELECT * FROM banka_hesaplari ORDER BY para_birimi, banka_adi');

  // Cari borç/alacak toplamları (para birimine göre)
  const cariler = getAll('SELECT bakiye_IQD, bakiye_USD FROM cariler');
  const cari = { borc_IQD: 0, alacak_IQD: 0, borc_USD: 0, alacak_USD: 0 };
  cariler.forEach(c => {
    if (c.bakiye_IQD > 0) cari.borc_IQD += c.bakiye_IQD; else cari.alacak_IQD += -c.bakiye_IQD;
    if (c.bakiye_USD > 0) cari.borc_USD += c.bakiye_USD; else cari.alacak_USD += -c.bakiye_USD;
  });

  // Aylık gelir/gider (kasa + banka)
  const ayBas = new Date(); ayBas.setDate(1);
  const ayBasStr = ayBas.toISOString().split('T')[0];
  const gelir = {}, gider = {};
  const ekle = (map, pb, v) => { map[pb] = (map[pb] || 0) + v; };
  getAll("SELECT kh.tur as tur, k.para_birimi as pb, SUM(kh.tutar) as t FROM kasa_hareketleri kh JOIN kasalar k ON k.id=kh.kasa_id WHERE kh.tarih >= ? GROUP BY kh.tur, k.para_birimi", [ayBasStr])
    .forEach(r => isGiris(r.tur) ? ekle(gelir, r.pb, r.t) : ekle(gider, r.pb, r.t));
  getAll("SELECT bh.tur as tur, b.para_birimi as pb, SUM(bh.tutar) as t FROM banka_hareketleri bh JOIN banka_hesaplari b ON b.id=bh.hesap_id WHERE bh.tarih >= ? GROUP BY bh.tur, b.para_birimi", [ayBasStr])
    .forEach(r => isGiris(r.tur) ? ekle(gelir, r.pb, r.t) : ekle(gider, r.pb, r.t));

  // Stok değeri yok (alış fiyatı tutulmuyor) — sadece adet bilgisi
  const dusukStok = getAll('SELECT ad, mevcut_miktar, min_miktar, birim FROM stoklar WHERE min_miktar > 0 AND mevcut_miktar <= min_miktar ORDER BY ad');

  const toplam = (k) => k.bakiye;
  const nakitIQD = kasalar.filter(k=>k.para_birimi==='IQD').reduce((s,k)=>s+toplam(k),0)
                 + bankalar.filter(b=>b.para_birimi==='IQD').reduce((s,b)=>s+toplam(b),0);
  const nakitUSD = kasalar.filter(k=>k.para_birimi==='USD').reduce((s,k)=>s+toplam(k),0)
                 + bankalar.filter(b=>b.para_birimi==='USD').reduce((s,b)=>s+toplam(b),0);

  return { kur, kasalar, bankalar, cari, gelir, gider, dusukStok,
           nakitIQD, nakitUSD,
           nakitToplamUSD: nakitUSD + nakitIQD / kur };
});

ipcMain.handle('db:konum', () => dbPath());

ipcMain.handle('db:yedekle', async () => {
  saveDb();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Veritabanı Yedeği Kaydet',
    defaultPath: `albrus-yedek-${stamp}.db`,
    filters: [{ name: 'Albrus Yedek', extensions: ['db'] }]
  });
  if (canceled || !filePath) return { ok: false, iptal: true };
  fs.copyFileSync(dbPath(), filePath);
  return { ok: true, path: filePath };
});

ipcMain.handle('db:geri-yukle', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Yedek Dosyası Seç',
    properties: ['openFile'],
    filters: [{ name: 'Albrus Yedek', extensions: ['db'] }]
  });
  if (canceled || !filePaths?.length) return { ok: false, iptal: true };
  const src = filePaths[0];

  // Seçilen dosyayı doğrula — geçerli bir Albrus veritabanı mı?
  let testDb;
  try {
    const buf = fs.readFileSync(src);
    testDb = new SQL.Database(buf);
    testDb.exec('SELECT COUNT(*) FROM kasalar');
    testDb.exec('SELECT COUNT(*) FROM faturalar');
  } catch (e) {
    if (testDb) testDb.free();
    throw new Error('Seçilen dosya geçerli bir Albrus yedeği değil.');
  }

  // Mevcut veritabanını geri yükleme öncesi otomatik yedekle
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const autoBak = path.join(app.getPath('userData'), `albrus-onceki-${stamp}.db`);
  if (fs.existsSync(dbPath())) fs.copyFileSync(dbPath(), autoBak);

  // Belleği ve dosyayı değiştir
  db.close();
  db = testDb;
  saveDb();
  return { ok: true, otomatikYedek: autoBak };
});

// ════════════════════════════════════════════════════════════
// HAKEDİŞ
// ════════════════════════════════════════════════════════════

// — Poz (keşif/BOQ) tanımları: projeye bağlı —
ipcMain.handle('hakedis:pozlar:getir', (_, proje_id) =>
  getAll('SELECT * FROM hakedis_pozlar WHERE proje_id = ? ORDER BY sira, id', [proje_id])
);

ipcMain.handle('hakedis:poz:ekle', (_, d) => {
  const maxSira = getOne('SELECT COALESCE(MAX(sira),0) as m FROM hakedis_pozlar WHERE proje_id = ?', [d.proje_id]).m;
  const r = insertAndGet('hakedis_pozlar',
    'INSERT INTO hakedis_pozlar (proje_id, grup, poz_no, tanim, birim, kesif_miktar, bf_iscilik, bf_malzeme, sira) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(d.proje_id), d.grup ?? '', d.poz_no ?? '', d.tanim, d.birim ?? 'Adet',
     Number(d.kesif_miktar) || 0, Number(d.bf_iscilik) || 0, Number(d.bf_malzeme) || 0, maxSira + 1]);
  saveDb();
  return r;
});

ipcMain.handle('hakedis:poz:guncelle', (_, id, d) => {
  run('UPDATE hakedis_pozlar SET grup=?, poz_no=?, tanim=?, birim=?, kesif_miktar=?, bf_iscilik=?, bf_malzeme=? WHERE id=?',
    [d.grup ?? '', d.poz_no ?? '', d.tanim, d.birim ?? 'Adet',
     Number(d.kesif_miktar) || 0, Number(d.bf_iscilik) || 0, Number(d.bf_malzeme) || 0, id]);
  saveDb();
  return true;
});

ipcMain.handle('hakedis:poz:sil', (_, id) => {
  run('DELETE FROM hakedis_pozlar WHERE id = ?', [id]);
  saveDb();
  return true;
});

// Projedeki tüm pozları sil
ipcMain.handle('hakedis:poz:tumunu:sil', (_, proje_id) => {
  const n = getAll('SELECT id FROM hakedis_pozlar WHERE proje_id = ?', [proje_id]).length;
  run('DELETE FROM hakedis_pozlar WHERE proje_id = ?', [proje_id]);
  saveDb();
  return n;
});

// Excel teklif/keşif dosyasını seç ve önizle (sayfa adları + ham satırlar)
ipcMain.handle('xlsx:onizle', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Excel Dosyası Seç (xlsx / xlsm)',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }]
  });
  if (canceled || !filePaths?.length) return { ok: false, iptal: true };
  try {
    const wb = readWorkbook(filePaths[0]);
    const sheets = wb.sheets.map(s => {
      const rows = sheetRows(wb, s.path).slice(0, 10000).map(r => (r || []).slice(0, 40).map(c => c == null ? '' : String(c)));
      return { name: s.name, rows };
    });
    return { ok: true, dosya: path.basename(filePaths[0]), sheets };
  } catch (e) {
    throw new Error('Excel okunamadı: ' + e.message);
  }
});

// Eşlenmiş satırları o projenin poz/BOQ listesine ekle
ipcMain.handle('hakedis:boq:import', (_, { proje_id, satirlar, temizle }) => {
  if (!proje_id) throw new Error('Proje seçilmedi.');
  if (temizle) {
    run('DELETE FROM hakedis_pozlar WHERE proje_id = ?', [proje_id]);
  }
  let sira = getOne('SELECT COALESCE(MAX(sira),0) as m FROM hakedis_pozlar WHERE proje_id = ?', [proje_id]).m;
  let eklenen = 0;
  for (const s of (satirlar || [])) {
    if (!s.tanim || !String(s.tanim).trim()) continue;
    sira++;
    run('INSERT INTO hakedis_pozlar (proje_id, grup, poz_no, tanim, birim, kesif_miktar, bf_iscilik, bf_malzeme, sira) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [proje_id, s.grup || '', s.poz_no || '', String(s.tanim).trim(), s.birim || 'Adet',
       Number(s.kesif_miktar) || 0, Number(s.bf_iscilik) || 0, Number(s.bf_malzeme) || 0, sira]);
    eklenen++;
  }
  saveDb();
  return { ok: true, eklenen };
});

// ════════════════════════════════════════════════════════════
// HAKEDİŞ DÖNEMLERİ + YEŞİL DEFTER
// ════════════════════════════════════════════════════════════

// Bir poz için önceki dönemlerin (hakedis_no < bu) BU HKD miktar toplamı = ÖNCEKİ kümülatif
function yesilOncekiToplam(proje_id, hakedis_no, poz_id) {
  const row = getOne(`
    SELECT COALESCE(SUM(s.bu_miktar),0) as v
    FROM hakedis_satirlar s
    JOIN hakedisler h ON h.id = s.hakedis_id
    WHERE h.proje_id = ? AND h.hakedis_no < ? AND s.poz_id = ?`,
    [proje_id, hakedis_no, poz_id]);
  return row ? row.v : 0;
}

ipcMain.handle('hakedisler:getir', (_, proje_id) =>
  getAll('SELECT * FROM hakedisler WHERE proje_id = ? ORDER BY hakedis_no DESC', [proje_id]));

ipcMain.handle('hakedis:ekle', (_, d) => {
  const no = (getOne('SELECT COALESCE(MAX(hakedis_no),0) as m FROM hakedisler WHERE proje_id = ?', [d.proje_id]).m) + 1;
  const r = insertAndGet('hakedisler',
    'INSERT INTO hakedisler (proje_id, hakedis_no, tarih) VALUES (?, ?, ?)',
    [Number(d.proje_id), no, d.tarih ?? '']);
  saveDb();
  return r;
});

ipcMain.handle('hakedis:sil', (_, id) => {
  run('DELETE FROM hakedis_satirlar WHERE hakedis_id = ?', [id]);
  run('DELETE FROM ilave_isler WHERE hakedis_id = ?', [id]);
  run('DELETE FROM kesintiler WHERE hakedis_id = ?', [id]);
  run('DELETE FROM progress_report WHERE hakedis_id = ?', [id]);
  run('DELETE FROM hakedisler WHERE id = ?', [id]);
  saveDb();
  return true;
});

// Yeşil defter verisi: pozlar + ÖNCEKİ (önceki dönemler) + BU HKD (bu dönem) + hesaplı alanlar
ipcMain.handle('yesil:getir', (_, hakedis_id) => {
  const h = getOne('SELECT * FROM hakedisler WHERE id = ?', [hakedis_id]);
  if (!h) return null;
  const pozlar = getAll('SELECT * FROM hakedis_pozlar WHERE proje_id = ? ORDER BY sira, id', [h.proje_id]);
  const buMap = {};
  getAll('SELECT * FROM hakedis_satirlar WHERE hakedis_id = ?', [hakedis_id]).forEach(s => { buMap[s.poz_id] = s.bu_miktar || 0; });
  const rows = pozlar.map(p => {
    const onceki = yesilOncekiToplam(h.proje_id, h.hakedis_no, p.id); // J
    const bu = buMap[p.id] || 0;                                       // K
    const toplam = onceki + bu;                                        // I = J + K
    const oran = toplam ? (bu / toplam) : 0;                           // L = K / I
    const esas = toplam * oran;                                        // M = I × L (= bu)
    return { poz: p, onceki, bu, toplam, oran, esas };
  });
  return { hakedis: h, rows };
});

// Yeşil defter BU HKD metrajlarını kaydet (poz başına bir kayıt)
ipcMain.handle('yesil:kaydet', (_, hakedis_id, satirlar) => {
  for (const s of (satirlar || [])) {
    const bu = Number(s.bu) || 0;
    const varMi = getOne('SELECT id FROM hakedis_satirlar WHERE hakedis_id = ? AND poz_id = ?', [hakedis_id, s.poz_id]);
    if (varMi) run('UPDATE hakedis_satirlar SET bu_miktar = ? WHERE id = ?', [bu, varMi.id]);
    else       run('INSERT INTO hakedis_satirlar (hakedis_id, poz_id, bu_miktar) VALUES (?, ?, ?)', [hakedis_id, s.poz_id, bu]);
  }
  saveDb();
  return true;
});

// Hakediş Genel İcmali (RAN "(R) REPRESENTATION" sayfası): BOQ + Yeşil Defter birleşimi
// BOQ'dan: sıra/poz/tanım/birim/keşif miktarı/birim fiyat/keşif tutarı
// Yeşil Defter'den: ÖNCEKİ + BU = TOPLAM miktar; tutarlar birim fiyatla çarpılır
// Genel İcmal hesabı (iç fonksiyon; hem icmal:getir hem arkakapak:getir kullanır)
// mod: 'iscilik' (sadece işçilik) | 'malzeme' (sadece malzeme) | 'tum' (malzemeli + işçilik)
function hesaplaIcmal(hakedis_id, mod) {
  const h = getOne('SELECT * FROM hakedisler WHERE id = ?', [hakedis_id]);
  if (!h) return null;
  mod = mod || 'iscilik';
  const pozlar = getAll('SELECT * FROM hakedis_pozlar WHERE proje_id = ? ORDER BY sira, id', [h.proje_id]);
  const buMap = {};
  getAll('SELECT * FROM hakedis_satirlar WHERE hakedis_id = ?', [hakedis_id]).forEach(s => { buMap[s.poz_id] = s.bu_miktar || 0; });
  const rows = pozlar.map(p => {
    const isc = Number(p.bf_iscilik) || 0, mlz = Number(p.bf_malzeme) || 0;
    const bf = mod === 'malzeme' ? mlz : mod === 'tum' ? (isc + mlz) : isc;    // H/O birim fiyat (B) — seçilen moda göre
    const kesifMiktar = Number(p.kesif_miktar) || 0;                          // G keşif miktarı (A)
    const kesifTutar  = kesifMiktar * bf;                                     // I keşif tutarı (C=A×B)
    const onceki = yesilOncekiToplam(h.proje_id, h.hakedis_no, p.id);         // M önceki miktar (E)
    const bu     = buMap[p.id] || 0;                                          // N bu defa miktar (F)
    const toplam = onceki + bu;                                               // L toplam miktar (D)
    const oran   = kesifMiktar ? (toplam / kesifMiktar) : 0;                  // J gerçekleşme % (D/A)
    const toplamTutar = toplam * bf;                                          // P toplam tutar (G=B×D)
    const oncekiTutar = onceki * bf;                                          // Q önceki tutar (H=E×B)
    const buTutar     = toplamTutar - oncekiTutar;                            // R bu defa tutar (I=G−H)
    return { poz: p, bf, bfIscilik: Number(p.bf_iscilik) || 0, bfMalzeme: Number(p.bf_malzeme) || 0,
             kesifMiktar, kesifTutar, onceki, bu, toplam, oran, toplamTutar, oncekiTutar, buTutar };
  });
  const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const toplamlar = {
    kesifTutar: sum('kesifTutar'), toplamTutar: sum('toplamTutar'),
    oncekiTutar: sum('oncekiTutar'), buTutar: sum('buTutar')
  };
  return { hakedis: h, rows, toplamlar, mod };
}

ipcMain.handle('icmal:getir', (_, hakedis_id, mod) => hesaplaIcmal(hakedis_id, mod));

// İlave İşler İcmali (RAN "ADDITIONAL OPERATION SUMMARY"): tutanakla onaylanan sözleşme-dışı işler
// Elle girilir (BOQ'tan çekilmez). TOPLAM TUTAR = miktar × birim fiyat × (parite varsa, yoksa 1)
ipcMain.handle('ilave:getir', (_, hakedis_id) => {
  const h = getOne('SELECT * FROM hakedisler WHERE id = ?', [hakedis_id]);
  if (!h) return null;
  const satirlar = getAll('SELECT * FROM ilave_isler WHERE hakedis_id = ? ORDER BY sira, id', [hakedis_id]);
  const rows = satirlar.map(s => {
    const parite = Number(s.parite) || 0;
    const tutar = (Number(s.miktar) || 0) * (Number(s.birim_fiyat) || 0) * (parite > 0 ? parite : 1);
    return { ...s, tutar };
  });
  const genelToplam = rows.reduce((a, r) => a + (r.tutar || 0), 0);
  return { hakedis: h, rows, genelToplam };
});

// İlave işleri kaydet (tam değiştirme: o hakedişin tüm satırları silinip yeniden yazılır)
ipcMain.handle('ilave:kaydet', (_, hakedis_id, satirlar) => {
  run('DELETE FROM ilave_isler WHERE hakedis_id = ?', [hakedis_id]);
  (satirlar || []).forEach((s, i) => {
    run(`INSERT INTO ilave_isler (hakedis_id, tutanak_no, tutanak_tarih, imalat_adi, kirilim, birim, miktar, birim_fiyat, parite, sira)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hakedis_id, s.tutanak_no ?? '', s.tutanak_tarih ?? '', s.imalat_adi ?? '', s.kirilim ?? '',
       s.birim ?? '', Number(s.miktar) || 0, Number(s.birim_fiyat) || 0, Number(s.parite) || 0, i + 1]);
  });
  saveDb();
  return true;
});

// Kesintiler İcmali (RAN "KESİNTİLER İCMALİ"): hakedişten düşülen kesintiler
// Elle girilir. TOPLAM = miktar × birim fiyat × (parite varsa, yoksa 1)
ipcMain.handle('kesinti:getir', (_, hakedis_id) => {
  const h = getOne('SELECT * FROM hakedisler WHERE id = ?', [hakedis_id]);
  if (!h) return null;
  const satirlar = getAll('SELECT * FROM kesintiler WHERE hakedis_id = ? ORDER BY sira, id', [hakedis_id]);
  const rows = satirlar.map(s => {
    const parite = Number(s.parite) || 0;
    const tutar = (Number(s.miktar) || 0) * (Number(s.birim_fiyat) || 0) * (parite > 0 ? parite : 1);
    return { ...s, tutar };
  });
  const genelToplam = rows.reduce((a, r) => a + (r.tutar || 0), 0);
  return { hakedis: h, rows, genelToplam };
});

// Kesintileri kaydet (tam değiştirme)
ipcMain.handle('kesinti:kaydet', (_, hakedis_id, satirlar) => {
  run('DELETE FROM kesintiler WHERE hakedis_id = ?', [hakedis_id]);
  (satirlar || []).forEach((s, i) => {
    run(`INSERT INTO kesintiler (hakedis_id, tarih, aciklama, birim, miktar, birim_fiyat, parite, sira)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hakedis_id, s.tarih ?? '', s.aciklama ?? '', s.birim ?? '',
       Number(s.miktar) || 0, Number(s.birim_fiyat) || 0, Number(s.parite) || 0, i + 1]);
  });
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// ARKA KAPAK (RAN "BACK COVER"): hakediş mali özeti
//   İşçilik + Malzeme (Genel İcmal) + İlave İşler − Kesintiler = NET
//   Önceki / Bu Hakediş / Toplam kümülatif kolonlarıyla. KDV YOK.
// ════════════════════════════════════════════════════════════

// Bir tabloda (ilave_isler/kesintiler) o projenin verilen hakedişe kadarki
// kümülatif tutar toplamı. once=true → yalnız önceki dönemler (hakedis_no < bu)
function tutarToplam(tablo, proje_id, hakedis_no, sadeceOnceki) {
  const op = sadeceOnceki ? '<' : '<=';
  const sat = getAll(
    `SELECT t.miktar, t.birim_fiyat, t.parite FROM ${tablo} t
     JOIN hakedisler h ON h.id = t.hakedis_id
     WHERE h.proje_id = ? AND h.hakedis_no ${op} ?`,
    [proje_id, hakedis_no]);
  return sat.reduce((a, s) => {
    const par = Number(s.parite) || 0;
    return a + (Number(s.miktar) || 0) * (Number(s.birim_fiyat) || 0) * (par > 0 ? par : 1);
  }, 0);
}

ipcMain.handle('arkakapak:getir', (_, hakedis_id) => {
  const h = getOne('SELECT * FROM hakedisler WHERE id = ?', [hakedis_id]);
  if (!h) return null;
  const proje = getOne('SELECT * FROM projeler WHERE id = ?', [h.proje_id]);
  const isc = hesaplaIcmal(hakedis_id, 'iscilik').toplamlar;   // işçilik tutarları
  const mlz = hesaplaIcmal(hakedis_id, 'malzeme').toplamlar;   // malzeme tutarları
  const ilaveTop    = tutarToplam('ilave_isler', h.proje_id, h.hakedis_no, false);
  const ilaveOnceki = tutarToplam('ilave_isler', h.proje_id, h.hakedis_no, true);
  const kesintiTop    = tutarToplam('kesintiler', h.proje_id, h.hakedis_no, false);
  const kesintiOnceki = tutarToplam('kesintiler', h.proje_id, h.hakedis_no, true);

  // her kalem {onceki, bu(=toplam-onceki), toplam}
  const k = (onceki, toplam) => ({ onceki, bu: toplam - onceki, toplam });
  const sifir = k(0, 0);
  const topla = (...xs) => ({
    onceki: xs.reduce((a, x) => a + x.onceki, 0),
    bu:     xs.reduce((a, x) => a + x.bu, 0),
    toplam: xs.reduce((a, x) => a + x.toplam, 0),
  });
  const cikar = (a, b) => ({ onceki: a.onceki - b.onceki, bu: a.bu - b.bu, toplam: a.toplam - b.toplam });

  // ── İŞÇİLİK ──
  const A = k(isc.oncekiTutar, isc.toplamTutar);   // gerçekleşen işçilik (Genel İcmal)
  const B = k(ilaveOnceki, ilaveTop);              // ilave işler
  const C = topla(A, B);                           // toplam işçilik = A+B
  const D = sifir;                                 // vergiler (KDV yok)
  const F = sifir;                                 // avans kesintileri
  const G = sifir;                                 // nakit teminat
  const H = k(kesintiOnceki, kesintiTop);          // diğer kesintiler (Kesintiler İcmali)
  const E = topla(F, G, H);                        // kesintiler toplamı = F+G+H
  const J = cikar(C, E);                           // net işçilik = C-E
  // ── MALZEME ──
  const Kf = sifir;                                // firma faturası
  const L1 = sifir;                                // tedarik edilen malzeme
  const L2 = k(mlz.oncekiTutar, mlz.toplamTutar);  // imalata giren malzeme (Genel İcmal)
  const Sa = sifir;                                // ihzarat
  const N  = sifir;                                // avans kesintileri (malzeme)
  const O  = sifir;                                // nakit teminat (malzeme)
  const M  = topla(N, O);                          // malzeme kesintileri = N+O
  const P  = cikar(L2, M);                         // net malzeme = L2-M
  const R  = topla(J, P);                          // işçilik + malzeme toplam = J+P

  // sözleşme tipi (otomatik): malzeme ve işçilik durumuna göre
  let tip = 'iscilik';
  if (isc.toplamTutar > 0 && mlz.toplamTutar > 0) tip = 'malzeme_iscilik';
  else if (mlz.toplamTutar > 0) tip = 'malzeme';

  return {
    hakedis: h, proje: proje ? proje.ad : '', tip,
    kalemler: { A, B, C, D, E, F, G, H, J, K: Kf, L1, L2, S: Sa, M, N, O, P, R }
  };
});

// ════════════════════════════════════════════════════════════
// ARKA KAPAK (İŞÇİLİK) — RAN "BACK COVER (I)": detaylı işçilik özeti
//   (R) REPRESENTATION=Genel İcmal · ADDITIONAL=İlave İşler · KESİNTİLER İCMALİ=Kesintiler
//   Net = İstihkak (işçilik+malzeme+ilave) − Vergi(0) − Kesinti − Avans(0) − Alıkonulan(0)
// ════════════════════════════════════════════════════════════
ipcMain.handle('arkakapak1:getir', (_, hakedis_id) => {
  const h = getOne('SELECT * FROM hakedisler WHERE id = ?', [hakedis_id]);
  if (!h) return null;
  const proje = getOne('SELECT * FROM projeler WHERE id = ?', [h.proje_id]);
  const iscT = hesaplaIcmal(hakedis_id, 'iscilik').toplamlar;
  const mlzT = hesaplaIcmal(hakedis_id, 'malzeme').toplamlar;
  const ilaveTop = tutarToplam('ilave_isler', h.proje_id, h.hakedis_no, false);
  const ilaveOnc = tutarToplam('ilave_isler', h.proje_id, h.hakedis_no, true);
  const kesTop = tutarToplam('kesintiler', h.proje_id, h.hakedis_no, false);
  const kesOnc = tutarToplam('kesintiler', h.proje_id, h.hakedis_no, true);

  const k = (o, t) => ({ onceki: o, bu: t - o, toplam: t });
  const z = k(0, 0);
  const topla = (...xs) => ({
    onceki: xs.reduce((a, x) => a + x.onceki, 0),
    bu:     xs.reduce((a, x) => a + x.bu, 0),
    toplam: xs.reduce((a, x) => a + x.toplam, 0),
  });
  const cikar = (a, b) => ({ onceki: a.onceki - b.onceki, bu: a.bu - b.bu, toplam: a.toplam - b.toplam });

  // ── 1. İSTİHKAK ──
  const A  = k(iscT.oncekiTutar, iscT.toplamTutar);  // 1.1 gerçekleşen işçilik (Genel İcmal)
  const B  = z;                                      // 1.2 tedarik edilen malzeme fatura (izlenmez)
  const C  = k(mlzT.oncekiTutar, mlzT.toplamTutar);  // 1.3 imalata giren malzeme (Genel İcmal)
  const D  = z;                                      // 1.4 imalata girmeyen (stok) malzeme = 0
  const E  = z;                                      // 1.5 ihzarat
  const F  = topla(A, C);                            // 1.6 F = A + C
  const G  = topla(E, F);                            // 1.7 G = E + F
  const H1 = z;                                      // 1.8.1 malzemeli ilave
  const H2 = k(ilaveOnc, ilaveTop);                  // 1.8.2 işçilik ilave (ADDITIONAL)
  const H  = topla(H1, H2);                          // 1.8 H = H1 + H2
  const I  = topla(G, H);                            // 1.9 I = G + H (faturaya esas)
  const J1 = z, J2 = z, J3 = z;                      // 1.10.x KDV/Stopaj/Damga (KDV yok)
  const J  = topla(J1, J2, J3);                      // 1.10 J = J1+J2+J3 (vergiler)
  const Kf = topla(I, J);                            // 1.11 K = I + J (fatura tutarı)
  // ── 2. KESİNTİLER ──
  const L1 = z, L2 = z, L3 = z, L4 = z, L5 = z;      // malzeme/yemek/personel/ceza...
  const L6 = k(kesOnc, kesTop);                      // 2.6 diğer = Kesintiler İcmali
  const L7 = z;                                      // %3 ırak vergisi
  const L  = topla(L1, L2, L3, L4, L5, L6, L7);      // 2. L = L1+..+L7
  // ── 3. AVANS ── (izlenmez)
  const M1 = z, N1 = z, M2 = z, N2 = z;
  const O  = z;                                      // 3.5 bakiye avans = M1-N1+M2-N2
  // ── 4. ALIKONULAN ── (izlenmez)
  const P1 = z, P2 = z;
  const P  = topla(P1, P2);                          // 4. P = P1 + P2
  // ── 5. NET ──
  const R1 = cikar(topla(A, H), L);                  // 5.1 net işçilik = (A+H) − kesinti
  const R2 = C;                                      // 5.2 net malzeme = imalata giren malzeme
  const R  = topla(R1, R2);                          // 5. R = R1 + R2

  return {
    hakedis: h, proje: proje ? proje.ad : '',
    kalemler: { A, B, C, D, E, F, G, H, H1, H2, I, J, J1, J2, J3, K: Kf,
                L, L1, L2, L3, L4, L5, L6, L7, M1, N1, M2, N2, O, P, P1, P2, R, R1, R2 }
  };
});

// ════════════════════════════════════════════════════════════
// PROGRESS REPORT (RAN "PROGRESS REPORT"): hakediş künye/kapak sayfası — elle girilir
// ════════════════════════════════════════════════════════════
const PROGRESS_ALANLAR = ['subcontractor','works_name','type_manuf','nusha','ppc_type',
  'project_name','project_location','scope','employer','contract_no','subcontractor_full',
  'contract_value','change_order','guarantee','site_delivery_date','time_completion','additional_days','notes'];

ipcMain.handle('progress:getir', (_, hakedis_id) => {
  const h = getOne('SELECT * FROM hakedisler WHERE id = ?', [hakedis_id]);
  if (!h) return null;
  const proje = getOne('SELECT * FROM projeler WHERE id = ?', [h.proje_id]);
  let data = getOne('SELECT * FROM progress_report WHERE hakedis_id = ?', [hakedis_id]);
  const isNew = !data;
  if (!data) {
    // varsayılanlar: önceki hakedişin künyesini taşı (varsa), yoksa proje/BOQ'tan üret
    const onceki = getOne(
      `SELECT pr.* FROM progress_report pr JOIN hakedisler hh ON hh.id = pr.hakedis_id
       WHERE hh.proje_id = ? AND hh.hakedis_no < ? ORDER BY hh.hakedis_no DESC LIMIT 1`,
      [h.proje_id, h.hakedis_no]);
    const kesifToplam = (hesaplaIcmal(hakedis_id, 'tum').toplamlar || {}).kesifTutar || 0;
    data = {};
    PROGRESS_ALANLAR.forEach(a => { data[a] = onceki ? onceki[a] : ''; });
    if (!onceki) {
      const fa = (getOne("SELECT deger FROM ayarlar WHERE anahtar = 'firma_adi'") || {}).deger || 'ALBRUS COMPANY';
      data.subcontractor = fa;
      data.subcontractor_full = fa;
      data.project_name = proje ? proje.ad : '';
      data.works_name = proje ? proje.ad : '';
      data.contract_value = kesifToplam;
    }
  }
  return { hakedis: h, proje: proje ? proje.ad : '', data, isNew };
});

ipcMain.handle('progress:kaydet', (_, hakedis_id, data) => {
  data = data || {};
  const cols = PROGRESS_ALANLAR;
  const vals = cols.map(a => a === 'contract_value' ? (Number(data[a]) || 0) : (data[a] ?? ''));
  const ph = cols.map(() => '?').join(', ');
  run('DELETE FROM progress_report WHERE hakedis_id = ?', [hakedis_id]);
  run(`INSERT INTO progress_report (hakedis_id, ${cols.join(', ')}) VALUES (?, ${ph})`, [hakedis_id, ...vals]);
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// ÇEK / SENET
// ════════════════════════════════════════════════════════════

ipcMain.handle('cek:getir', (_, f) => {
  const conds = [], params = [];
  if (f?.yon)   { conds.push('cs.yon = ?');   params.push(f.yon); }
  if (f?.durum) { conds.push('cs.durum = ?'); params.push(f.durum); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  return getAll(`
    SELECT cs.*, c.ad as cari_ad
    FROM cek_senet cs
    LEFT JOIN cariler c ON c.id = cs.cari_id
    ${where}
    ORDER BY cs.vade ASC, cs.id DESC
  `, params);
});

ipcMain.handle('cek:ekle', (_, d) => {
  const r = insertAndGet('cek_senet',
    `INSERT INTO cek_senet (tip, yon, cari_id, tutar, para_birimi, vade, tarih, banka, cek_no, durum, aciklama)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'portfoy', ?)`,
    [d.tip || 'cek', d.yon || 'alinan', d.cari_id ? Number(d.cari_id) : null,
     Number(d.tutar) || 0, d.para_birimi || 'USD', d.vade || '', d.tarih || '',
     d.banka || '', d.cek_no || '', d.aciklama || '']);
  saveDb();
  return r;
});

ipcMain.handle('cek:sil', (_, id) => {
  const cs = getOne('SELECT * FROM cek_senet WHERE id = ?', [id]);
  if (!cs) return false;
  // Tahsil/ödeme yapılmışsa önce hesap hareketini geri al
  if ((cs.durum === 'tahsil' || cs.durum === 'odendi') && cs.hesap_id) cekHareketGeriAl(cs);
  run('DELETE FROM cek_senet WHERE id = ?', [id]);
  saveDb();
  return true;
});

function cekHareketGeriAl(cs) {
  const belge = `CEK-${cs.id}`;
  if (cs.hesap_tip === 'banka') {
    const h = getOne('SELECT * FROM banka_hareketleri WHERE belge_no = ? ORDER BY id DESC LIMIT 1', [belge]);
    if (h) {
      const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [h.hesap_id]);
      if (hesap) run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + (h.tur === 'giris' ? -h.tutar : h.tutar), hesap.id]);
      run('DELETE FROM banka_hareketleri WHERE id = ?', [h.id]);
    }
  } else {
    const h = getOne('SELECT * FROM kasa_hareketleri WHERE belge_no = ? ORDER BY id DESC LIMIT 1', [belge]);
    if (h) {
      const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [h.kasa_id]);
      if (kasa) run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kasa.bakiye + (isGiris(h.tur) ? -h.tutar : h.tutar), kasa.id]);
      run('DELETE FROM kasa_hareketleri WHERE id = ?', [h.id]);
    }
  }
}

// Çek/Senet durum değiştir. tahsil/odendi → kasa/banka hareketi; geri alınırsa hareket iptal
ipcMain.handle('cek:durum', (_, d) => {
  const cs = getOne('SELECT * FROM cek_senet WHERE id = ?', [d.id]);
  if (!cs) throw new Error('Kayıt bulunamadı.');
  const yeni = d.durum;
  const paraliEski = (cs.durum === 'tahsil' || cs.durum === 'odendi') && cs.hesap_id;
  const paraliYeni = (yeni === 'tahsil' || yeni === 'odendi');

  // Eski para hareketini geri al
  if (paraliEski) cekHareketGeriAl(cs);

  if (paraliYeni) {
    if (!d.hesap_id) throw new Error('Tahsil/ödeme için kasa veya banka seçin.');
    const belge = `CEK-${cs.id}`;
    const tarih = d.tarih || new Date().toISOString().split('T')[0];
    const giris = cs.yon === 'alinan'; // alınan çek tahsil → giriş, verilen çek ödendi → çıkış
    const ack = `${cs.tip === 'senet' ? 'Senet' : 'Çek'} ${giris ? 'tahsili' : 'ödemesi'} — ${cs.cek_no || ''}`.trim();
    if (d.hesap_tip === 'banka') {
      const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [Number(d.hesap_id)]);
      if (!hesap) throw new Error('Banka hesabı bulunamadı.');
      run('INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no, cari_id) VALUES (?,?,?,?,?,?,?)',
        [hesap.id, tarih, giris ? 'giris' : 'cikis', cs.tutar, ack, belge, cs.cari_id]);
      run('UPDATE banka_hesaplari SET bakiye = ? WHERE id = ?', [hesap.bakiye + (giris ? cs.tutar : -cs.tutar), hesap.id]);
    } else {
      const kasa = getOne('SELECT * FROM kasalar WHERE id = ?', [Number(d.hesap_id)]);
      if (!kasa) throw new Error('Kasa bulunamadı.');
      run('INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, belge_no, cari_id) VALUES (?,?,?,?,?,?,?)',
        [kasa.id, tarih, giris ? 'tahsilat' : 'odeme', cs.tutar, ack, belge, cs.cari_id]);
      run('UPDATE kasalar SET bakiye = ? WHERE id = ?', [kasa.bakiye + (giris ? cs.tutar : -cs.tutar), kasa.id]);
    }
    run('UPDATE cek_senet SET durum = ?, hesap_tip = ?, hesap_id = ? WHERE id = ?',
      [yeni, d.hesap_tip || 'kasa', Number(d.hesap_id), cs.id]);
  } else {
    run('UPDATE cek_senet SET durum = ?, hesap_tip = ?, hesap_id = NULL WHERE id = ?', [yeni, '', cs.id]);
  }
  saveDb();
  return true;
});

// ════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════

ipcMain.handle('dashboard:uyarilar', () => {
  const dusukStok = getAll('SELECT ad, mevcut_miktar, min_miktar, birim FROM stoklar WHERE min_miktar > 0 AND mevcut_miktar <= min_miktar ORDER BY mevcut_miktar ASC');
  const borclular = getAll("SELECT ad, bakiye_IQD, bakiye_USD FROM cariler WHERE bakiye_IQD > 0 OR bakiye_USD > 0 ORDER BY (bakiye_USD + bakiye_IQD) DESC");
  const acikFaturalar = getAll(`
    SELECT id, fatura_no, tur, para_birimi, toplam, indirim, COALESCE(odenen,0) as odenen, cari_id
    FROM faturalar
    WHERE (belge_turu IS NULL OR belge_turu = 'fatura') AND cari_id IS NOT NULL
      AND (COALESCE(odenen,0) < (toplam - COALESCE(indirim,0)) - 0.001)
    ORDER BY tarih DESC`);
  const acikToplam = {};
  acikFaturalar.forEach(f => {
    const kalan = Math.max(0, f.toplam - (f.indirim || 0) - f.odenen);
    acikToplam[f.para_birimi] = (acikToplam[f.para_birimi] || 0) + kalan;
  });
  return {
    dusukStok, borclular,
    acikFaturaSayisi: acikFaturalar.length, acikToplam
  };
});

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

  const ayHarBanka = getAll(
    "SELECT bh.tur, b.para_birimi, SUM(bh.tutar) as toplam FROM banka_hareketleri bh JOIN banka_hesaplari b ON b.id = bh.hesap_id WHERE bh.tarih >= ? GROUP BY bh.tur, b.para_birimi",
    [ayBasStr]
  );
  ayHarBanka.forEach(r => {
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
