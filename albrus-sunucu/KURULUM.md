# ALBRUS Sunucu — Bu Bilgisayarı Veri Sunucusu Yapma

Bu bilgisayar (LAN IP: **192.168.1.42**) merkezi veri sunucusu olur. Diğer kullanıcılar
buraya bağlanır. Veri tek yerde tutulur (`data.db`), herkes aynı veriyi görür.

## 1) Sunucuyu çalıştırma
- `albrus-sunucu\baslat.bat` dosyasına çift tıkla. Açılan pencere kapatılmazsa sunucu açık kalır.
- İlk giriş: kullanıcı **admin**, parola **admin** (sonra Ayarlar'dan değiştir).

### Bilgisayar açılınca otomatik başlatma (önerilir)
`baslat.bat`'a sağ tık → Kısayol oluştur → kısayolu şu klasöre koy:
`Win+R` → `shell:startup` → Enter → açılan klasöre kısayolu at.
Böylece PC her açıldığında sunucu kendiliğinden başlar.

## 2) Ofis içi (aynı ağ) erişim
Diğer bilgisayarlar Albrus uygulamasında **Sunucu Adresi** olarak şunu yazar:
```
http://192.168.1.42:4000
```
(Bu PC'nin IP'si değişirse modemden bu PC'ye sabit IP ver — "DHCP rezervasyon".)

## 3) Uzaktan (şantiye / ev / internet) erişim
İnternetten erişim için iki yol var:

### A) Cloudflare Tunnel — ÖNERİLEN (ücretsiz, modem ayarı yok, otomatik HTTPS)

**EN KOLAY — tek tık:** `albrus-sunucu\uzaktan-baslat.bat` dosyasına çift tıkla.
- Sunucuyu ve tüneli birlikte başlatır.
- Pencerede `https://....trycloudflare.com` gibi bir adres çıkar → bu adresi telefonun
  tarayıcısına yaz, **admin / admin** ile gir.
- **İki pencereyi de (Sunucu + Tunnel) kapatma**; kapatınca erişim durur.
- (`cloudflared.exe` aynı klasörde hazır gelir. Yoksa:
  https://github.com/cloudflare/cloudflared/releases — `cloudflared-windows-amd64.exe`
  indirip `cloudflared.exe` adıyla `albrus-sunucu` klasörüne koy.)

> **DİKKAT — adres her başlatmada değişir.** Bu ücretsiz "deneme" tüneli her açılışta
> farklı bir `trycloudflare.com` adresi verir. Sabit/kalıcı adres istiyorsan: Cloudflare
> hesabı (ücretsiz) + kendi alan adın ile **adlandırılmış tünel** kur (cloudflared dokümanı).
> İstersen bunu birlikte ayarlarız.

**Avantaj:** Modemde port açmaya gerek yok, dinamik IP sorunu yok, HTTPS hazır gelir.

### B) Port yönlendirme + DDNS (modem erişimi gerekir)
1. Modemde **port forwarding**: dış port 4000 → 192.168.1.42:4000.
2. İnternet IP'n değişiyorsa **DDNS** (örn. DuckDNS) ile sabit bir ad al.
3. **Güvenlik:** Bu yöntemde HTTPS'i ayrıca kurman gerekir (alan adı + SSL sertifikası).
   HTTPS'siz parolalar açık gider — internete açarken mutlaka HTTPS kullan.

## 4) Mobil uygulama (telefon)
Sunucu aynı zamanda bir **mobil web uygulaması** (PWA) servis eder. Ayrı kurulum gerekmez.

1. Telefonun tarayıcısında sunucu adresini aç:
   - Ofis içi:  `http://192.168.1.42:4000`
   - Uzaktan:  Cloudflare Tunnel adresin (örn. `https://....trycloudflare.com`)
2. **admin / admin** ile giriş yap (kendi kullanıcınla da girebilirsin).
3. Tarayıcı menüsünden **"Ana ekrana ekle"** de → telefonda uygulama ikonu gibi açılır.

Mobil sürümde olanlar: **Özet** (kasa/banka bakiye, aylık gelir-gider, uyarılar),
**Cari** (bakiye + ekstre), **Kasa** (bakiye + hareket + yeni fiş girişi),
**Banka** (bakiye + hareket), **Fatura** (görüntüleme). Hakediş gibi ağır işler masaüstünde.
Kullanıcı yetkileri (RBAC) mobile de uygulanır — kullanıcı yalnız izinli bölümleri görür.

> Uzaktan mobil erişim için sunucunun internete açık olması gerekir (Cloudflare Tunnel — bkz. madde 3A).
> HTTPS olmadan parola açık gider; internete açarken mutlaka HTTPS (Cloudflare Tunnel hazır verir).

## Güvenlik notları
- İnternete açmadan önce **admin parolasını değiştir**.
- Mümkünse Cloudflare Tunnel kullan (HTTPS hazır gelir).
- `data.db` düzenli yedeklenmeli (bu dosya tüm veridir).
