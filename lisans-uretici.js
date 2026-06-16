// ALBRUS Lisans Anahtarı Üretici (SADECE SATICI KULLANIR)
// Kullanım:  node lisans-uretici.js <BILGISAYAR_KIMLIGI>
// Örnek:     node lisans-uretici.js A3F2C1D4E5B60718
//
// Müşteri programı açınca "Bilgisayar Kimliği"ni gönderir; burada anahtar üretip ona verirsin.
// ÖZEL ANAHTAR (lisans-ozel-anahtar.pem) GİZLİDİR — kimseyle paylaşma, programa koyma.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const makine = (process.argv[2] || '').trim().toUpperCase();
if (!makine) {
  console.error('Kullanım: node lisans-uretici.js <BILGISAYAR_KIMLIGI>');
  process.exit(1);
}

const keyPath = path.join(__dirname, 'lisans-ozel-anahtar.pem');
if (!fs.existsSync(keyPath)) {
  console.error('HATA: lisans-ozel-anahtar.pem bulunamadı. Özel anahtar bu klasörde olmalı.');
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, 'utf8');
const sig = crypto.sign(null, Buffer.from(makine), privateKey);
const key = sig.toString('base64');

console.log('\nBilgisayar Kimliği :', makine);
console.log('LİSANS ANAHTARI    :\n');
console.log(key);
console.log('\nBu anahtarı müşteriye gönder. Sadece o bilgisayarda çalışır.\n');
