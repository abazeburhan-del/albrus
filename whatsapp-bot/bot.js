// ALBRUS — WhatsApp Bakım Botu
// WhatsApp Web'e "bağlı cihaz" olarak katılır; izlenen gruplara düşen foto/video/belgeleri
// açıklamasına göre sınıflandırıp Masaüstü/<AY YIL> BAKIM/<Lokasyon>/<Kategori>/ altına kaydeder.
//
// Çalıştırma:  BotBaslat.bat   (veya: node bot.js)
// İlk açılışta QR çıkar → Telefon > WhatsApp > Bağlı Cihazlar > Cihaz Bağla ile okut.
// Bir kez bağlanınca oturum "oturum/" klasöründe saklanır, tekrar QR sorulmaz.

const fs = require('fs');
const path = require('path');
const os = require('os');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket, useMultiFileAuthState, downloadMediaMessage,
  fetchLatestBaileysVersion, Browsers, DisconnectReason,
} = require('@whiskeysockets/baileys');

const { siniflandir, ayarYukle, AYLAR, normalize } = require('../whatsapp-duzenle/cekirdek.js');

const AYAR_YOLU = path.join(__dirname, 'bot-ayar.json');
const OTURUM = path.join(__dirname, 'oturum');
const KATEGORI_AYAR = ayarYukle(path.join(__dirname, '..', 'whatsapp-duzenle', 'kategoriler.json'));

function botAyar() {
  if (!fs.existsSync(AYAR_YOLU)) {
    const varsayilan = {
      hedef_klasor: path.join(os.homedir(), 'Desktop'),
      izlenen_gruplar: [],
      _not: "izlenen_gruplar boşsa TÜM gruplar izlenir. Grup adının bir parçasını yazman yeterli: ['defacto', 'bakım']",
      son_mesajlar: []
    };
    fs.writeFileSync(AYAR_YOLU, JSON.stringify(varsayilan, null, 2));
    return varsayilan;
  }
  return JSON.parse(fs.readFileSync(AYAR_YOLU, 'utf8'));
}
const AYAR = botAyar();

const log = (...a) => console.log(new Date().toLocaleTimeString('tr-TR'), ...a);

// ── Tek kopya kilidi ──
// Aynı oturumla iki bot çalışırsa WhatsApp birini sürekli düşürür ("bağlantı koptu"
// döngüsü). Bu yüzden ikinci kopyanın açılmasını engelliyoruz.
const KILIT = path.join(__dirname, 'bot.kilit');
function surecYasiyorMu(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function kilitAl() {
  if (fs.existsSync(KILIT)) {
    const eski = Number(fs.readFileSync(KILIT, 'utf8').trim());
    if (eski && eski !== process.pid && surecYasiyorMu(eski)) {
      console.log('\n╔═══════════════════════════════════════════════════════╗');
      console.log('║  BOT ZATEN ÇALIŞIYOR (PID ' + String(eski).padEnd(6) + ')                     ║');
      console.log('║                                                       ║');
      console.log('║  İkinci kopya açılamaz — iki bot aynı anda çalışırsa  ║');
      console.log('║  WhatsApp bağlantıyı sürekli koparır.                 ║');
      console.log('║                                                       ║');
      console.log('║  Açık olan bot penceresini kullan. Yoksa o pencereyi  ║');
      console.log('║  kapatıp bu botu yeniden başlat.                      ║');
      console.log('╚═══════════════════════════════════════════════════════╝\n');
      process.exit(1);
    }
  }
  fs.writeFileSync(KILIT, String(process.pid));
  const birak = () => { try { if (fs.existsSync(KILIT) && Number(fs.readFileSync(KILIT,'utf8')) === process.pid) fs.unlinkSync(KILIT); } catch (_) {} };
  process.on('exit', birak);
  process.on('SIGINT', () => { birak(); process.exit(0); });
  process.on('SIGTERM', () => { birak(); process.exit(0); });
}

function guvenliAd(s) { return String(s).replace(/[<>:"/\\|?*]/g, '_').trim(); }
function benzersiz(hedef) {
  if (!fs.existsSync(hedef)) return hedef;
  const dir = path.dirname(hedef), ext = path.extname(hedef), ad = path.basename(hedef, ext);
  for (let i = 2; i < 9999; i++) {
    const y = path.join(dir, `${ad} (${i})${ext}`);
    if (!fs.existsSync(y)) return y;
  }
  return hedef;
}

// Grup bazlı son metin bağlamı: açıklamasız foto, önceki metinden kategori devralsın
const baglam = new Map();   // grupJid -> { kategori, lokasyon, zaman }
const BAGLAM_OMRU = 30 * 60 * 1000;  // 30 dk

function grupIzleniyorMu(grupAd) {
  const filtreler = AYAR.izlenen_gruplar || [];
  if (!filtreler.length) return true;                 // boşsa hepsi
  const g = normalize(grupAd || '');
  return filtreler.some(f => g.includes(normalize(f)));
}

function uzantiBul(mesaj, tur) {
  const mime = (mesaj.mimetype || '').toLowerCase();
  if (tur === 'image') return mime.includes('png') ? '.png' : '.jpg';
  if (tur === 'video') return '.mp4';
  if (tur === 'document') {
    const ad = mesaj.fileName || '';
    const e = path.extname(ad);
    if (e) return e;
    if (mime.includes('pdf')) return '.pdf';
    if (mime.includes('sheet') || mime.includes('excel')) return '.xlsx';
    if (mime.includes('word')) return '.docx';
    return '.bin';
  }
  return '.bin';
}

let _sock = null;          // aynı anda tek soket
let _denemeler = 0;        // arka arkaya başarısız bağlantı sayacı
let _bagliMi = false;

async function baslat() {
  // Önceki soketi tamamen kapat (dinleyicileri üst üste binmesin)
  if (_sock) { try { _sock.ev.removeAllListeners(); _sock.end(); } catch (_) {} _sock = null; }

  const { state, saveCreds } = await useMultiFileAuthState(OTURUM);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    browser: Browsers.appropriate('Albrus Bakim Bot'),
    markOnlineOnConnect: false,      // telefonundaki bildirimler bozulmasın
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,   // geçmişi çekme (oturum şişmesin, hızlı bağlansın)
    qrTimeout: 120000,               // QR okutmak için 2 dakika süre
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });
  _sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log('\n═══════════════════════════════════════════');
      console.log('  TELEFONUNDAN OKUT  (2 dakika geçerli):');
      console.log('  WhatsApp > Ayarlar > Bağlı Cihazlar > Cihaz Bağla');
      console.log('═══════════════════════════════════════════\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      _denemeler = 0; _bagliMi = true;
      log('✓ BAĞLANDI. Gruplar dinleniyor…');
      log('  Hedef klasör:', AYAR.hedef_klasor);
      log('  İzlenen gruplar:', (AYAR.izlenen_gruplar || []).length ? AYAR.izlenen_gruplar.join(', ') : 'HEPSİ');
      log('  Bu pencereyi kapatma. Kapatırsan yeni mesajlar kaydedilmez.\n');
    }
    if (connection === 'close') {
      _bagliMi = false;
      const hata = lastDisconnect?.error;
      const kod = hata?.output?.statusCode;

      // Telefondan çıkarılmış → oturum geçersiz, yeniden QR gerekir
      if (kod === DisconnectReason.loggedOut || kod === 401) {
        log('✗ Oturum geçersiz (telefondan çıkarılmış).');
        log('  "oturum" klasörünü sil, sonra botu yeniden başlat ve QR okut.');
        process.exit(1);
      }
      // QR okutulduktan sonra WhatsApp yeniden başlatma ister — bu NORMALDİR
      if (kod === DisconnectReason.restartRequired || kod === 515) {
        log('Eşleşme tamam, oturum başlatılıyor…');
        setTimeout(baslat, 1500);
        return;
      }
      // QR süresi doldu (okutulmadı)
      if (kod === DisconnectReason.timedOut || /QR refs attempts ended/i.test(hata?.message || '')) {
        log('QR süresi doldu (okutulmadı). Yeni QR üretiliyor…');
        setTimeout(baslat, 2000);
        return;
      }

      _denemeler++;
      if (_denemeler >= 6) {
        log(`✗ ${_denemeler} denemede bağlanılamadı. Sebep: ${hata?.message || kod || 'bilinmiyor'}`);
        log('  İnternet bağlantını kontrol et. Sorun sürerse "oturum" klasörünü silip QR\'ı yeniden okut.');
        process.exit(1);
      }
      const bekle = Math.min(3000 * _denemeler, 20000);   // kademeli bekleme
      log(`Bağlantı koptu (${hata?.message || kod || '?'}). ${bekle / 1000} sn sonra yeniden denenecek… [${_denemeler}/6]`);
      setTimeout(baslat, bekle);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try { await mesajIsle(sock, m); }
      catch (e) { log('! Hata:', e.message); }
    }
  });
}

async function mesajIsle(sock, m) {
  const jid = m.key?.remoteJid || '';
  if (!jid.endsWith('@g.us')) return;                 // sadece gruplar

  let grupAd = '';
  try { grupAd = (await sock.groupMetadata(jid)).subject || ''; } catch (_) {}
  if (!grupIzleniyorMu(grupAd)) return;

  const icerik = m.message || {};
  const gercek = icerik.ephemeralMessage?.message || icerik.viewOnceMessageV2?.message || icerik;

  const resim = gercek.imageMessage, video = gercek.videoMessage, belge = gercek.documentMessage;
  const metin = gercek.conversation || gercek.extendedTextMessage?.text || '';
  const aciklama = resim?.caption || video?.caption || belge?.caption || belge?.fileName || '';

  // Sadece metin → bağlam olarak sakla (sonraki açıklamasız fotolar bunu kullansın)
  if (!resim && !video && !belge) {
    if (metin) {
      const s = siniflandir(metin, KATEGORI_AYAR);
      if (s.kategori || s.lokasyon) {
        const onceki = baglam.get(jid) || {};
        baglam.set(jid, {
          kategori: s.kategori || onceki.kategori,
          lokasyon: s.lokasyon || onceki.lokasyon,
          zaman: Date.now()
        });
        log(`· bağlam [${grupAd}] → ${s.lokasyon || onceki.lokasyon || '?'} / ${s.kategori || onceki.kategori || '?'}`);
      }
    }
    return;
  }

  // Medya: sınıflandır (kendi açıklaması yoksa gruptaki son bağlamdan devral)
  const kendi = siniflandir(aciklama, KATEGORI_AYAR);
  const b = baglam.get(jid);
  const bGecerli = b && (Date.now() - b.zaman) < BAGLAM_OMRU;
  const kategori = kendi.kategori || (bGecerli ? b.kategori : null) || KATEGORI_AYAR.varsayilan_kategori || 'Diğer';
  const lokasyon = kendi.lokasyon || (bGecerli ? b.lokasyon : null);
  if (kendi.kategori || kendi.lokasyon) {
    baglam.set(jid, { kategori, lokasyon, zaman: Date.now() });
  }

  // Mesajın kendi tarihi → ay klasörü
  const ts = Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0) * 1000 || Date.now();
  const d = new Date(ts);
  const ayKlasor = `${AYLAR[d.getMonth()]} ${d.getFullYear()} BAKIM`;

  const parcalar = [AYAR.hedef_klasor, guvenliAd(ayKlasor)];
  if (lokasyon) parcalar.push(guvenliAd(lokasyon));
  parcalar.push(guvenliAd(kategori));
  const klasor = path.join(...parcalar);
  fs.mkdirSync(klasor, { recursive: true });

  const tur = resim ? 'image' : video ? 'video' : 'document';
  const mesajNesne = resim || video || belge;
  const ext = uzantiBul(mesajNesne, tur);
  const damga = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
  const temelAd = belge?.fileName ? path.basename(belge.fileName, path.extname(belge.fileName)) : tur.toUpperCase();
  const dosyaYolu = benzersiz(path.join(klasor, guvenliAd(`${damga}_${temelAd}${ext}`)));

  const veri = await downloadMediaMessage(m, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
  fs.writeFileSync(dosyaYolu, veri);

  log(`✓ ${ayKlasor} / ${lokasyon ? lokasyon + ' / ' : ''}${kategori}  ←  ${path.basename(dosyaYolu)}${aciklama ? '  ("' + aciklama.slice(0, 40) + '")' : ''}`);
}

console.log('\n═══════════════════════════════════════════');
console.log('  ALBRUS — WhatsApp Bakım Botu');
console.log('═══════════════════════════════════════════');
console.log('  Ayar dosyası: bot-ayar.json');
console.log('  Durdurmak için: bu pencereyi kapat veya Ctrl+C\n');

kilitAl();   // ikinci kopyayı engelle
baslat().catch(e => { console.error('BAŞLATILAMADI:', e.message); process.exit(1); });
