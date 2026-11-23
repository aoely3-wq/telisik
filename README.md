# Telisik: antarmuka web untuk Briefing Ekonomi Babel

Aplikasi web (login, berita bergambar, tone dan rekomendasi NETRA, papan program prioritas, pesan WhatsApp)
yang membaca Google Sheet milik **bot briefing** Kanwil DJPb Bangka Belitung. Bot-nya sendiri
(`briefing-babel-bot`, berjalan di Render) tidak diubah: ia tetap yang mencari berita, menilai tone dan
rekomendasi NETRA, mengirim ke Telegram, dan menulis ke tab `Berita`. Repo ini hanya lapisan web di atasnya.

```
bot Render  ──menulis──▶  Google Sheet (tab "Berita")  ◀──membaca──  /api/berita ──▶  public/index.html
     ▲                                                                 /api/gambar (og:image saat dibuka)
     └──────────── POST /cron (X-Cron-Secret) ◀──── /api/tarik (admin) ◀── tombol "Tarik berita"
```

## Isi repo
| Jalur | Fungsi |
|---|---|
| `public/index.html` | UI satu halaman (Berita, Tone & NETRA, WhatsApp untuk admin) |
| `api/berita.js` | membaca tab `Berita` dan menormalkan baris (`_berita.js`) |
| `api/gambar.js` | mengambil gambar utama artikel (`og:image`), hanya untuk link yang ada di Sheet |
| `api/tarik.js` | admin memicu `/cron` di bot Render |
| `api/login.js`, `logout.js`, `me.js`, `ganti-password.js` | akun admin dan tamu, sesi cookie |
| `api/_selftest.js` | uji otomatis tanpa jaringan: `node api/_selftest.js` |

## Kolom Sheet yang dibaca (tab `Berita`)
`Nomor | Tanggal Berita | Waktu Eksekusi | Kategori | Uraian Singkat | Sumber Berita | Link berita | Tone Berita | Rekomendasi ke NETRA`

- **Tone**: Positif, Netral, Negatif. **NETRA**: Direkomendasikan, Dipertimbangkan, Bisa diabaikan
  (penilaian bot; berita bertone negatif tidak pernah direkomendasikan).
- Kategori PKPN berbentuk `<judul> - <nama program>`; program dipetakan ke papan 8 program.
- **Kolom opsional** yang boleh Anda tambahkan manual di sebelah kanan: `Verifikasi` dan
  `Diteruskan ke NETRA`. Sel yang terisi menampilkan cincin emas "Terverifikasi" / "Diteruskan". Bot
  hanya menulis kolom A sampai I, jadi kolom tambahan tidak terganggu.
- Gambar tidak ada di Sheet: `og:image` diambil saat halaman dibuka lalu di-cache. Situs yang memblokir
  bot atau tanpa gambar memakai ilustrasi cadangan.

## Login dan peran
| Akun | Boleh | Password awal |
|---|---|---|
| `tamu` | berita, tone, rekomendasi NETRA, dan menu WhatsApp (tanpa tarik berita dan ganti password) | `tamu` (atau env `TAMU_PASSWORD`) |
| `admin` | semua itu, ditambah **tarik berita** dan **ganti password** | env `ADMIN_PASSWORD` |

- Sesi: cookie `HttpOnly`, `Secure`, `SameSite=Strict`, berlaku 12 jam, ditandatangani `SESSION_SECRET`.
- Menu akun (ikon orang): Ganti password (admin: password sendiri minimal 12 karakter, dan password tamu
  minimal 4 karakter, dengan memasukkan password admin saat ini) dan Keluar.
- Setelah diganti lewat aplikasi, password disimpan sebagai hash scrypt di tab tersembunyi `pengguna`
  (dibuat otomatis) dan menggantikan nilai env. Sesi lama akun itu langsung tidak berlaku. Pakai file Sheet
  terpisah lewat `USERS_SHEET_ID` agar hash tidak terlihat analis.
- Pembatas percobaan login ada di memori per instance (5 kegagalan per IP per 10 menit), jadi tidak mutlak;
  untuk batas ketat pasang Vercel Firewall rate limit. Untuk akses per orang pasang Vercel Authentication.

## Menu WhatsApp (admin dan tamu)
Menyusun pesan siap kirim dari berita pada tanggal yang dipilih di header: Rekomendasi NETRA di atas, lalu
berita positif lainnya, netral, dan negatif, bernomor, dengan link artikel pada baris sendiri. Berita bisa
dicentang satu per satu. **Salin pesan** atau **Buka WhatsApp** (pilih grup, lalu kirim manual). Pengiriman
otomatis ke grup tidak dibuat.

## Tombol "Tarik berita" (admin)
`POST /api/tarik` memicu `POST {BOT_URL}/cron` dengan header `X-Cron-Secret`. Bot menjalankan briefing penuh
dan mengirimnya ke admin di Telegram; hasilnya masuk ke Sheet. Bot lama tidak punya endpoint status, jadi UI
mendeteksi selesai dari kolom `Nomor` di Sheet yang bertambah (memeriksa tiap 15 detik, sampai 12 menit).

- Di **Render**, tambahkan env `CRON_SECRET` (minimal 16 karakter) pada layanan bot. Tanpa itu `/cron`
  tidak aktif. Nilainya sama dengan env `CRON_SECRET` di Vercel.
- Server gratis Render tidur setelah 15 menit; UI mengulang pemicu tiap 10 detik sampai bot bangun.
- Batas satu kali per 30 menit dihitung per instance. Batas tegas ada di bot (`USER_DAILY_RUNS`,
  `GLOBAL_DAILY_RUNS` di `render.yaml`, saat ini `0` = tanpa batas); isi sesuai kuota Gemini.

## Pasang di Vercel
1. Impor repo ini sebagai project (tanpa framework; `public/` disajikan sebagai situs, `api/` sebagai fungsi).
2. Isi env sesuai `.env.example`: `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_TAB`,
   `SESSION_SECRET`, `ADMIN_PASSWORD`, `BOT_URL`, `CRON_SECRET` (opsional: `TAMU_PASSWORD`, `USERS_SHEET_ID`).
   Nilai `GOOGLE_*` sama dengan di Render.
3. Service account (yang dipakai bot) harus berperan **Editor** pada Sheet: dibaca untuk berita dan,
   untuk menyimpan password, ditulis ke tab `pengguna`.
4. Masuk sebagai admin, ganti password admin lewat menu, lalu coba **Tarik berita**.

Riwayat: versi awal repo ini berisi purwarupa agent Python dan workflow GitHub Actions. Semuanya dibuang
karena bot di Render sudah menjalankan fungsi itu; masih bisa dilihat di riwayat git (commit `571212f`, `654cff5`).
