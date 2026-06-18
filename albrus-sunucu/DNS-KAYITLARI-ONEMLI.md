# albrustech.com — KORUNACAK DNS KAYITLARI (e-posta için hayati)

> Nameserver'ları Cloudflare'e taşırken AŞAĞIDAKİ kayıtların Cloudflare'de
> **birebir mevcut olduğunu doğrula**. Eksik olan varsa ELLE ekle. Bunlar
> olmazsa **@albrustech.com e-postaları çalışmaz** (Google Workspace).
> Kayıt tarihi: 2026-06-19 (eski sağlayıcı: domainhizmetleri.net).

## MX kayıtları (e-posta — Google Workspace) — ŞART
| Öncelik | Sunucu |
|--------|--------|
| 1  | ASPMX.L.GOOGLE.COM |
| 5  | ALT1.ASPMX.L.GOOGLE.COM |
| 5  | ALT2.ASPMX.L.GOOGLE.COM |
| 10 | ALT3.ASPMX.L.GOOGLE.COM |
| 10 | ALT4.ASPMX.L.GOOGLE.COM |

Cloudflare'de: DNS > Records > Add record > Type=MX, Name=`@`, Mail server=yukarıdaki, Priority=yukarıdaki. (5 satır)

## TXT kök (@) — ŞART
- SPF:  `v=spf1 include:_spf.google.com ~all`
- Google doğrulama:  `google-site-verification=CQ3t6e78MzoZ32tOqcDv9pKZ1sSeXkoSZBYvM0p3Yi4`

## TXT _dmarc — ŞART
- Name: `_dmarc`
- Değer: `v=DMARC1; p=none; rua=mailto:postmaster@albrustech.com`

## TXT google._domainkey (DKIM) — ŞART
- Name: `google._domainkey`
- Değer:
```
v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCGaJH3N+odaIJ1LSx7xrC4RYV8bqo1uFzjWEf6vANBoWwcnt9/LFW0ycswon5jCmXh+a/UJhSgN5oqMkG9ojsvyuVgq2Fp5etLo16/WHwtWAduaueXp3vOxtwaWVDNHRmx4tT0pO0HXbw8yKw3vfB1t0DvVsXIYdzStBMEwcubwIDAQAB
```

## www / kök A (site yok ama dursun)
- A:  `@` → `185.210.94.91`  (eski; aktif site yok — Cloudflare proxy KAPALI/gri bulut tut)
- CNAME: `www` → `albrustech.com`

## Albrus için EKLENECEK (tünel sonrası ben ayarlayacağım)
- CNAME: `albrus` → `<tunnel-id>.cfargotunnel.com` (cloudflared route dns ile otomatik oluşur)
  → Sonuç adres: **https://albrus.albrustech.com**
