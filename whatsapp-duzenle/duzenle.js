// Masaüstü aracı — WhatsApp dışa aktarımını kategorilere göre Masaüstü'ne klasörler.
// Kullanım:  node duzenle.js "<export klasörü>" ["<hedef klasör>"] [--tasi] [--deneme]
// Genelde WhatsAppDuzenle.bat üzerinden çağrılır.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { duzenle } = require('./cekirdek.js');

const args = process.argv.slice(2);
const bayraklar = args.filter(a => a.startsWith('--'));
const yollar = args.filter(a => !a.startsWith('--'));

const kaynak = yollar[0];
const hedef = yollar[1] || path.join(os.homedir(), 'Desktop');
const kopyala = !bayraklar.includes('--tasi');      // varsayılan kopyala
const deneme = bayraklar.includes('--deneme');
// Varsayılan: SADECE BU AY (eski aylara dokunma). --tum-aylar ile hepsi.
const sadeceAy = bayraklar.includes('--tum-aylar') ? null : 'bu';

if (!kaynak) {
  console.log('\nKULLANIM:  node duzenle.js "<WhatsApp export klasörü>" ["<hedef>"] [--tasi] [--deneme] [--tum-aylar]\n');
  console.log('  (varsayılan): yalnız İÇİNDE BULUNULAN AY işlenir, eski aylara dokunulmaz');
  console.log('  --tum-aylar : sohbetteki tüm ayları işle');
  console.log('  --tasi      : kopyalamak yerine taşı (orijinal export boşalır)');
  console.log('  --deneme    : hiçbir şey yazma, sadece ne olacağını göster\n');
  process.exit(1);
}

console.log('\n═══════════════════════════════════════════');
console.log('  ALBRUS — WhatsApp Bakım Fotoğrafı Düzenleyici');
console.log('═══════════════════════════════════════════\n');
console.log('Kaynak :', kaynak);
console.log('Hedef  :', hedef);
console.log('Mod    :', deneme ? 'DENEME (yazma yok)' : (kopyala ? 'KOPYALA' : 'TAŞI'));
console.log('Dönem  :', sadeceAy ? 'SADECE BU AY (eskilere dokunulmaz)' : 'TÜM AYLAR', '\n');

try {
  const r = duzenle(kaynak, hedef, { kopyala, denemeModu: deneme, sadeceAy });
  console.log('Okunan mesaj :', r.mesajSayisi);
  console.log('Klasörlenen  :', r.tasinan);
  console.log('Atlanan      :', r.atlanan, '(sesli mesaj veya bulunamayan)');
  if (r.eskiAtlanan) console.log('Eski ay      :', r.eskiAtlanan, '(dokunulmadı)');
  console.log('Ay klasörü   :', r.ayKlasoru || '—');
  console.log('\nDAĞILIM');
  const satirlar = Object.entries(r.dagilim).sort((a, b) => b[1] - a[1]);
  if (!satirlar.length) console.log('  (dosya bulunamadı)');
  for (const [ad, adet] of satirlar) console.log('  ' + ad.padEnd(34, '.') + ' ' + adet);
  if (r.uyarilar.length) {
    console.log('\nUYARILAR');
    r.uyarilar.slice(0, 20).forEach(u => console.log('  ! ' + u));
    if (r.uyarilar.length > 20) console.log('  ... ve ' + (r.uyarilar.length - 20) + ' tane daha');
  }
  console.log('\n✓ Tamamlandı.' + (deneme ? ' (deneme modu — hiçbir dosya yazılmadı)' : ''));
  if (!deneme && r.tasinan) console.log('  Klasör: ' + path.join(hedef, r.ayKlasoru || ''));
} catch (e) {
  console.error('\n✗ HATA: ' + e.message + '\n');
  process.exit(1);
}
