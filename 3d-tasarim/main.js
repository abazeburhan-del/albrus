const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

let mainWindow;
let db;

const DB_PATH = path.join(__dirname, 'db.sqlite');

function initDb() {
  db = new sqlite3.Database(DB_PATH);

  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS projeler (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ad TEXT NOT NULL,
        aciklama TEXT DEFAULT '',
        olusturma_tarihi TEXT DEFAULT CURRENT_TIMESTAMP,
        guncelleme_tarihi TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS proje_kesif (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proje_id INTEGER NOT NULL,
        poz_no TEXT DEFAULT '',
        ad TEXT NOT NULL DEFAULT '',
        birim TEXT DEFAULT 'Adet',
        miktar REAL DEFAULT 0,
        birim_fiyat REAL DEFAULT 0,
        para_birimi TEXT DEFAULT 'USD',
        sira INTEGER DEFAULT 0
      );
    `);

    db.run(`
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
    `);
  });
}

ipcMain.handle('proje:getir', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM projeler ORDER BY id DESC', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
});

ipcMain.handle('proje:ekle', async (_, ad, aciklama = '') => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO projeler (ad, aciklama) VALUES (?, ?)',
      [ad, aciklama],
      function(err) {
        if (err) reject(err);
        else {
          db.get(
            'SELECT * FROM projeler WHERE id = ?',
            [this.lastID],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        }
      }
    );
  });
});

ipcMain.handle('proje:sil', async (_, id) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM proje_kesif_3d WHERE kesif_id IN (SELECT id FROM proje_kesif WHERE proje_id=?)', [id]);
      db.run('DELETE FROM proje_kesif WHERE proje_id=?', [id]);
      db.run('DELETE FROM projeler WHERE id=?', [id], (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  });
});

ipcMain.handle('kesif:getir', async (_, proje_id) => {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM proje_kesif WHERE proje_id=? ORDER BY sira,id',
      [proje_id],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const mapped = (rows || []).map(s => ({
            ...s,
            tutar: (Number(s.miktar) || 0) * (Number(s.birim_fiyat) || 0)
          }));
          const genelToplam = mapped.reduce((a, r) => a + r.tutar, 0);
          resolve({ rows: mapped, genelToplam });
        }
      }
    );
  });
});

ipcMain.handle('kesif:kaydet', async (_, proje_id, satirlar) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM proje_kesif_3d WHERE kesif_id IN (SELECT id FROM proje_kesif WHERE proje_id=?)', [proje_id]);
      db.run('DELETE FROM proje_kesif WHERE proje_id=?', [proje_id], (err) => {
        if (err) {
          reject(err);
          return;
        }

        let count = 0;
        const total = (satirlar || []).length;

        if (total === 0) {
          resolve(true);
          return;
        }

        (satirlar || []).forEach((s, i) => {
          db.run(
            'INSERT INTO proje_kesif (proje_id,poz_no,ad,birim,miktar,birim_fiyat,para_birimi,sira) VALUES (?,?,?,?,?,?,?,?)',
            [proje_id, s.poz_no || '', s.ad || '', s.birim || 'Adet',
             Number(s.miktar) || 0, Number(s.birim_fiyat) || 0, s.para_birimi || 'USD', i + 1],
            (err) => {
              count++;
              if (err) reject(err);
              if (count === total) resolve(true);
            }
          );
        });
      });
    });
  });
});

ipcMain.handle('3d:getir', async (_, kesif_id) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM proje_kesif_3d WHERE kesif_id=?',
      [kesif_id],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
});

ipcMain.handle('3d:kaydet', async (_, kesif_id, x, y, z, rx, ry, rz, olcek) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id FROM proje_kesif_3d WHERE kesif_id=?',
      [kesif_id],
      (err, existing) => {
        if (err) {
          reject(err);
          return;
        }

        if (existing) {
          db.run(
            'UPDATE proje_kesif_3d SET x=?, y=?, z=?, rotasyon_x=?, rotasyon_y=?, rotasyon_z=?, olcek=? WHERE kesif_id=?',
            [x, y, z, rx, ry, rz, olcek, kesif_id],
            (err) => {
              if (err) reject(err);
              else resolve(true);
            }
          );
        } else {
          db.run(
            'INSERT INTO proje_kesif_3d (kesif_id, x, y, z, rotasyon_x, rotasyon_y, rotasyon_z, olcek) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [kesif_id, x, y, z, rx, ry, rz, olcek],
            (err) => {
              if (err) reject(err);
              else resolve(true);
            }
          );
        }
      }
    );
  });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.webContents.openDevTools();
}

app.on('ready', () => {
  initDb();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
