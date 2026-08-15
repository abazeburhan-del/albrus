# WhatsApp Bakım Fotoğrafı Düzenleyici

WhatsApp gruplarından gelen **foto, video ve tutanakları** açıklamalarına göre ayırıp
Masaüstünde şu yapıyı kurar:

```
Masaüstü/
└── AĞUSTOS 2026 BAKIM/
    ├── DUHOK MALL/
    │   ├── Mobilya/          IMG-001.jpg, IMG-002.jpg
    │   └── Spot Tamiri/      IMG-003.jpg, VID-001.mp4
    └── FAMILY MALL/
        ├── Boya/             IMG-004.jpg, VID-002.mp4
        └── Tutanaklar/       TUTANAK-01.pdf
```

## 1) WhatsApp'tan dışa aktar (şart)
Fotoğrafı tek tek kaydedince **altındaki açıklama kaybolur** — kategori bilgisi orada olduğu
için gruplama yapılamaz. Bu yüzden sohbeti dışa aktarman gerekir:

**Telefonda:** Grubu aç → sağ üst **⋮ (Menü)** → **Daha fazla** → **Sohbeti dışa aktar**
→ **MEDYA EKLE** → zip'i bilgisayara gönder (mail/Drive) → **klasöre çıkar (unzip)**.

Klasörün içinde `_chat.txt` + tüm medya olmalı.

## 2) Çalıştır — iki yol var

### A) Masaüstü aracı
`whatsapp-duzenle\WhatsAppDuzenle.bat` dosyasına **çift tıkla**
(veya export klasörünü .bat'ın üstüne **sürükle-bırak**).
- Önce **DENEME** yapar: hiçbir dosya yazmadan "ne nereye gidecek" listesini gösterir.
- Onaylarsan (**E**) Masaüstüne kopyalar.

### B) Albrus programı içinden
**Ayarlar → WhatsApp Bakım Fotoğrafları → "Klasör Seç ve Düzenle"**
→ klasörü seç → dağılımı gör → **"Masaüstüne Kopyala"**.

## 3) Kategorileri kendine göre ayarla
`whatsapp-duzenle\kategoriler.json` dosyasını Not Defteri ile aç:

```json
{ "klasor": "Spot Tamiri", "anahtarlar": ["spot"] }
```
- **klasor**: oluşacak klasör adı
- **anahtarlar**: mesaj açıklamasında bu kelimelerden biri geçerse o klasöre gider

Aynı şekilde `lokasyonlar` (Duhok Mall, Family Mall…) düzenlenebilir.
Türkçe karakter/büyük-küçük harf farkı otomatik yok sayılır ("Boya"="boya"="BOYA").

## Nasıl karar veriyor?
- Fotonun **kendi açıklaması** varsa ondan (örn. "duhok mall spot tamiri").
- Açıklama yoksa **önceki metin mesajından** devralır — yani önce "Duhok mall boya" yazıp
  ardından 10 foto atarsan hepsi Boya klasörüne gider.
- Eşleşme yoksa **"Diğer"** klasörüne konur.

## Hangi ay işlenir?
**Varsayılan: yalnız içinde bulunulan ay.** Önceki aylara ait dosyalara **dokunulmaz**
(eski klasörlerin olduğu gibi kalır). Ekranda "şu kadar dosya önceki aylara ait —
dokunulmayacak" diye bildirilir.

Tüm ayları işlemek istersen:
- **Albrus:** "Tüm ayları işle" kutusunu işaretle
- **Masaüstü aracı:** `node duzenle.js "<klasör>" --tum-aylar`

Her ay kendi klasörüne gider (TEMMUZ 2026 BAKIM, AĞUSTOS 2026 BAKIM…).

## Notlar
- **Kopyalar** (taşımaz) — orijinal export klasörün bozulmaz. Taşımak için: `node duzenle.js "<klasör>" --tasi`
- Alınanlar: resim (.jpg/.png/.heic…), **video (.mp4/.mov…)**, belge (.pdf/.docx/.xlsx…)
- Alınmayanlar: **sesli mesajlar** (.opus/.m4a)
- Aynı adlı dosya varsa üzerine yazmaz, "(2)" ekler.
- Ay klasörü, mesajın **gönderildiği tarihe** göre belirlenir (dosya tarihine değil).
