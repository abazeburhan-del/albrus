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
    SELECT kh.*, c.ad as cari_ad, p.ad as proje_ad
    FROM kasa_hareketleri kh
    LEFT JOIN cariler c ON c.id = kh.cari_id
    LEFT JOIN projeler p ON p.id = kh.proje_id
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
    'INSERT INTO kasa_hareketleri (kasa_id, tarih, tur, tutar, aciklama, belge_no, cari_id, proje_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(d.kasa_id), d.tarih, d.tur, Number(d.tutar), d.aciklama ?? '', d.belge_no ?? '',
     d.cari_id ? Number(d.cari_id) : null, d.proje_id ? Number(d.proje_id) : null]
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
    SELECT bh.*, c.ad as cari_ad, p.ad as proje_ad
    FROM banka_hareketleri bh
    LEFT JOIN cariler c ON c.id = bh.cari_id
    LEFT JOIN projeler p ON p.id = bh.proje_id
    WHERE bh.hesap_id = ?
    ORDER BY bh.tarih DESC, bh.id DESC
  `, [hesap_id])
);

ipcMain.handle('banka:fis:ekle', (_, d) => {
  const hesap = getOne('SELECT * FROM banka_hesaplari WHERE id = ?', [d.hesap_id]);
  if (!hesap) throw new Error('Banka hesabı bulunamadı');
  if (!d.tutar || d.tutar <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır');
  const fis = insertAndGet('banka_hareketleri',
    'INSERT INTO banka_hareketleri (hesap_id, tarih, tur, tutar, aciklama, belge_no, cari_id, proje_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(d.hesap_id), d.tarih, d.tur, Number(d.tutar), d.aciklama ?? '', d.belge_no ?? '',
     d.cari_id ? Number(d.cari_id) : null, d.proje_id ? Number(d.proje_id) : null]
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
    'INSERT INTO cariler (ad, tur, telefon, adres) VALUES (?, ?, ?, ?)',
    [d.ad, d.tur, d.telefon ?? '', d.adres ?? '']
  );
  saveDb();
  return r;
});

ipcMain.handle('cariler:guncelle', (_, d) => {
  run('UPDATE cariler SET ad = ?, tur = ?, telefon = ?, adres = ? WHERE id = ?',
    [d.ad, d.tur, d.telefon ?? '', d.adres ?? '', d.id]);
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
    printBackground: false,
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
