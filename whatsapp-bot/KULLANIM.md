# ALBRUS — WhatsApp Bakım Botu (Otomatik)

Gruba düşen **foto, video ve tutanakları anında** yakalar, açıklamasına göre sınıflandırıp
Masaüstünde şu yapıya kaydeder — sen hiçbir şey yapmazsın:

```
Masaüstü/AĞUSTOS 2026 BAKIM/
├── DUHOK MALL/Mobilya/         2026-08-15_143022_IMAGE.jpg
├── DUHOK MALL/Spot Tamiri/     2026-08-15_143105_VIDEO.mp4
└── FAMILY MALL/Tutanaklar/     2026-08-15_160000_TUTANAK.pdf
```

## 1) İlk kurulum (bir kez)
1. `whatsapp-bot\BotBaslat.bat` dosyasına **çift tıkla**.
2. Ekranda bir **QR kod** çıkar.
3. Telefonda: **WhatsApp → Ayarlar → Bağlı Cihazlar → Cihaz Bağla** → QR'ı okut.
4. "✓ BAĞLANDI" yazınca hazır. Artık gruba düşen her medya otomatik kaydedilir.

Bir daha QR sorulmaz (oturum `oturum/` klasöründe saklanır).

## 2) Günlük kullanım
- **Pencereyi açık bırak.** Kapatırsan yeni mesajlar kaydedilmez.
- Bilgisayar her açıldığında otomatik başlasın istersen:
  `BotBaslat.bat`'a sağ tık → **Kısayol oluştur** → `Win+R` → `shell:startup` → kısayolu oraya at.

## 3) Ayarlar — `bot-ayar.json`
```json
{
  "hedef_klasor": "C:\\Users\\user\\Desktop",
  "izlenen_gruplar": []
}
```
- **izlenen_gruplar boş** → tüm gruplar izlenir.
- Sadece belirli grupları istersen adının bir parçasını yaz:
  `"izlenen_gruplar": ["defacto", "bakım"]`

Kategoriler (Mobilya, Boya, Spot Tamiri…) ortak dosyadan gelir:
`whatsapp-duzenle\kategoriler.json` — oradan düzenle.

## Nasıl karar veriyor?
- Fotonun **açıklaması** varsa ondan ("duhok mall spot tamiri").
- Açıklama yoksa **gruptaki son metin mesajından** devralır (30 dk geçerli) — yani
  "Duhok mall boya" yazıp ardından 10 foto atarsan hepsi Boya'ya gider.
- Eşleşmezse **"Diğer"** klasörüne gider.
- Ay klasörü, mesajın **gönderildiği tarihe** göre belirlenir.

## Önemli notlar
- ⚠️ Bot **yalnızca çalışırken** gelen mesajları alır. Bilgisayar kapalıyken düşenleri kaçırır.
  Geçmişte birikenler için: `whatsapp-duzenle` klasöründeki **export aracını** kullan.
- ⚠️ `oturum/` klasörü **WhatsApp hesabına erişim sağlar** — kimseyle paylaşma, GitHub'a gitmez (gitignore'lu).
- Botu hesaptan çıkarmak için: Telefon → **Bağlı Cihazlar** → cihazı sil.
- Sesli mesajlar kaydedilmez (sadece foto/video/belge).
- Aynı adlı dosya varsa üzerine yazmaz, "(2)" ekler.
- Bot "çevrimiçi" görünmez, telefonundaki bildirimleri bozmaz.
