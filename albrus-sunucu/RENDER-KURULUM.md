# Albrus'u Render.com'a Kurma (Bulut — mobil web erişimi)

Render, Albrus sunucusunu internette barındırır. Sonuç: **sabit, engellenmeyen bir
HTTPS adresi** (örn. `https://albrus.onrender.com`) — telefonda mobil veride de açılır,
ofis bilgisayarının açık kalmasına gerek yok.

> **Kapsam:** Bu, mobil web sürümüdür (Özet · Cari · Kasa · Banka · Fatura).
> Hakediş vb. tam modüller masaüstü (Electron) uygulamasında kalır.

---

## 1) Hesap ve dağıtım (Blueprint ile — en kolay)
1. **render.com** → GitHub ile ücretsiz kayıt ol.
2. **New +** → **Blueprint** → `abazeburhan-del/albrus` reposunu seç.
3. Render kökteki `render.yaml`'ı okur → **Apply**. Kurulum başlar (birkaç dk).
4. Bitince sana bir adres verir: `https://albrus-xxxx.onrender.com`.
5. Telefonda/tarayıcıda aç → **admin / admin** ile gir.

### Blueprint yerine elle (alternatif)
**New +** → **Web Service** → repoyu seç, sonra:
- **Root Directory:** `albrus-sunucu`
- **Runtime:** Node · **Build:** `npm install` · **Start:** `node server.js`
- **Environment** → `ALBRUS_SECRET` = (uzun rastgele bir metin)

---

## 2) ⚠️ VERİYİ KALICI YAP (muhasebe için ŞART)
Ücretsiz planda disk geçicidir — **her güncelleme/yeniden başlatmada tüm veriler silinir.**
Gerçek kullanım için kalıcı disk gerekir:

1. Render'da servis → **Settings** → plan'ı **Starter**'a yükselt (~7 USD/ay).
2. **Disks** → **Add Disk**: Name `albrus-data`, Mount Path `/var/data`, Size `1 GB`.
3. **Environment** → yeni değişken: `DB_PATH` = `/var/data/data.db`
4. **Save** → servis yeniden başlar. Artık veri kalıcıdır.

(Veya `render.yaml` içindeki yorumlu "disk" bloğunu açıp tekrar Apply edebilirsin.)

---

## 3) Güvenlik (internete açık — önemli)
- İlk girişten sonra **admin parolasını DEĞİŞTİR** (Ayarlar > Kullanıcı Yönetimi).
- Her kullanıcıya kendi hesabını aç; yetkileri (RBAC) rol/izinlerle sınırla.
- HTTPS Render'da otomatiktir.

## 4) Notlar
- Ücretsiz plan 15 dk hareketsizlikte uyur; ilk istek ~30 sn gecikir (Starter'da uyumaz).
- Masaüstü uygulamada kod değişince ve sunucu mantığı etkilendiyse:
  `node albrus-sunucu/core-uret.js` çalıştırıp `core.js`'i commit'le, sonra Render
  otomatik yeniden dağıtır (GitHub'a push'ta).
- Veri artık **bulutta**dır (ofis PC'sinde değil). Düzenli yedek için Render disk
  anlık görüntüsü veya periyodik `data.db` indirme düşünülebilir.
