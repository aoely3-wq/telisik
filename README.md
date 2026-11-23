# Agent Briefing Ekonomi Harian — Kanwil DJPb Babel

Purwarupa Tahap 1: agent yang mencari perkembangan ekonomi terbaru (fiskal,
moneter, komoditas, geopolitik, dan regional Bangka Belitung) lewat Claude
API, lalu mengirim ringkasannya ke Telegram.

## Prinsip Penting

- Agent ini **hanya memproses data publik** (BPS, BI, media, rilis resmi
  lain) lewat web search. **Jangan** menambahkan data internal DJPb
  (SIKRI, OMSPAN, data satker) ke dalam prompt kategori manapun tanpa
  proses klasifikasi data dan persetujuan tersendiri.
- Keluaran agent adalah **bahan awal**, bukan produk final. Setiap angka
  yang akan dikutip ke KFR/ALCo/policy brief tetap perlu diverifikasi
  manusia ke sumber aslinya.

## Struktur Berkas

```
agent-briefing/
├── agent.py                          # skrip utama
├── categories.py                     # 5 kategori: prompt & aturan format
├── requirements.txt                  # dependensi Python
├── .env.example                      # contoh variabel lingkungan
└── .github/workflows/briefing-harian.yml   # penjadwalan otomatis (opsional)
```

## Langkah Setup

### 1. Buat Bot Telegram
1. Buka Telegram, cari **@BotFather**, kirim `/newbot`.
2. Ikuti instruksi (beri nama bot), catat **token** yang diberikan
   (format: `1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`).
3. Cari bot Anda di Telegram, tekan **Start** agar bot bisa mengirim pesan
   ke Anda.

### 2. Dapatkan Chat ID
1. Kirim pesan apa saja ke bot Anda (misalnya "halo").
2. Buka di browser:
   `https://api.telegram.org/bot<TOKEN_ANDA>/getUpdates`
3. Cari nilai `"chat":{"id": ...}` pada respons JSON — itu Chat ID Anda.
   (Alternatif lebih cepat: kirim pesan ke bot **@userinfobot**, ia akan
   membalas dengan ID Anda langsung.)

### 3. Dapatkan Anthropic API Key
Daftar/masuk ke [console.anthropic.com](https://console.anthropic.com),
buat API key baru di menu API Keys.

### 4. Isi Kredensial
```bash
cp .env.example .env
# edit .env, isi tiga nilai: ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

### 5. Pasang Dependensi dan Uji Manual
```bash
pip install -r requirements.txt
export $(cat .env | xargs)   # muat variabel dari .env ke shell (Linux/Mac)
python agent.py
```
Jika berhasil, Anda akan menerima pesan briefing di Telegram dalam waktu
kurang lebih 30–60 detik (lima kategori dipanggil berurutan, masing-masing
melakukan web search).

## Penjadwalan Otomatis

### Opsi A — GitHub Actions (disarankan, gratis untuk repo privat/publik kecil)
1. Push folder ini ke repositori GitHub (privat disarankan, karena berisi
   nama instansi).
2. Di repo, buka **Settings → Secrets and variables → Actions**, tambahkan
   secret berikut: `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
   `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID`. Workflow memakai versi Gemini
   (`agent_gemini.py`). Untuk memakai versi Claude, di workflow ganti
   `requirements-gemini.txt` jadi `requirements.txt`, `agent_gemini.py` jadi
   `agent.py`, dan `GEMINI_API_KEY` jadi `ANTHROPIC_API_KEY`.
3. Workflow di `.github/workflows/briefing-harian.yml` akan berjalan
   otomatis setiap hari pukul 06:00 WIB. Uji coba manual lewat tab
   **Actions → Briefing Ekonomi Harian → Run workflow**.

### Opsi B — Cron di server/komputer yang selalu menyala
```bash
# edit crontab: crontab -e
0 6 * * * cd /path/ke/agent-briefing && /usr/bin/python3 agent.py >> log.txt 2>&1
```

### Opsi C — n8n (jika lebih nyaman dengan alur visual)
Gunakan node **Schedule Trigger** (harian, 06:00) → node **Execute
Command** yang menjalankan `python agent.py` (atau **HTTP Request** yang
memanggil Claude API langsung dari n8n tanpa skrip Python terpisah, jika
ingin sepenuhnya no-code).

## Kategori yang Tersedia

Tujuh kategori berjalan setiap hari: Fiskal & Moneter Nasional, Harga
Komoditas Strategis, Geopolitik & Ekonomi Global, **PKPN - Tingkat
Nasional**, **PKPN - Provinsi Kep. Bangka Belitung**, Regional Babel -
Ekonomi, dan Regional Babel - Sosial/Pendidikan/Kesehatan/Lingkungan.

Kategori PKPN melacak kedelapan program prioritas pemerintah (Kedaulatan
Pangan, Kemandirian Energi dan Air, Pendidikan, Kesehatan, Hilirisasi dan
Industrialisasi, Infrastruktur/Perumahan/Ketahanan Bencana, Penguatan
Ekonomi Kerakyatan dan Pembangunan Desa, Penurunan Kemiskinan). Berbeda
dari kategori lain, PKPN **sengaja dipecah jadi dua panggilan API
terpisah** (Nasional dan Babel) alih-alih satu panggilan berisi 16 baris
— model ringan seperti *flash-lite* terbukti tidak konsisten menjaga
struktur panjang dalam satu respons, sehingga dua templat pendek (8
baris masing-masing) jauh lebih *reliable*, dengan konsekuensi 1
panggilan API ekstra per hari.

Setiap kategori PKPN memakai teknik **template-fill**: prompt-nya berisi
kerangka 8 baris (`Program Prioritas 1 - Kedaulatan Pangan.` sampai
`Program Prioritas 8 - Penurunan Kemiskinan.`) yang model tinggal isi,
bukan sekadar aturan deskriptif ("cantumkan kedelapan program secara
berurutan"). Program tanpa perkembangan baru tetap muncul dengan baris
`Belum ada perkembangan terbaru.` — bukan dihilangkan — sehingga urutan
dan kelengkapan 1–8 selalu terjaga di kedua tingkat.

Jika hasil masih belum konsisten 8 baris penuh, opsi berikutnya adalah
tier yang lebih tinggi lagi (mis. `gemini-3.5-pro` bila tersedia) — cukup
ubah nilai `MODEL` di `agent_gemini.py`.

## Link Sumber (Pendek, Inline per Berita)

Setiap baris berita yang didukung hasil pencarian sekarang diberi **link
pendek** tepat di akhir barisnya sendiri (bukan daftar sumber terpisah di
bawah kategori). Cara kerjanya:

1. Gemini/Claude mengembalikan data *grounding*/*citations* yang
   memetakan potongan teks tertentu ke sumber webnya (URL asli, biasanya
   sangat panjang - untuk Gemini berupa link redirect
   `vertexaisearch.cloud.google.com/...` yang bisa 150+ karakter).
2. Skrip mencocokkan potongan teks itu (`segment.text` untuk Gemini,
   `cited_text` untuk Claude) sebagai substring ke tiap baris hasil -
   bukan menghitung index karakter, supaya tidak meleset.
3. URL asli dipendekkan lewat TinyURL (`tinyurl.com/api-create.php`,
   tanpa API key) dan ditempel di akhir baris yang bersangkutan.
4. Maksimal 2 link per baris (`max_links_per_line`) - kalau satu baris
   didukung lebih dari 2 sumber, dipilih dua yang pertama.

Baris yang tidak punya citation yang cocok (misalnya baris "Belum ada
perkembangan terbaru." pada kategori PKPN) sengaja dibiarkan tanpa link.

**Keterbatasan yang perlu disadari**: pencocokan bergantung pada
`segment.text`/`cited_text` benar-benar muncul utuh sebagai substring di
baris hasil. Jika model sedikit mengubah redaksi kalimat dari potongan
yang dikutip API, pencocokan bisa gagal untuk baris itu - baris akan
tetap tampil normal, hanya tanpa link (gagal aman, bukan error).

**Tentang TinyURL**: layanan publik, tidak butuh API key, tapi karena
berada di luar `ai.google.dev`/`api.anthropic.com`, panggilan ke situ
bisa gagal di jaringan yang membatasi domain eksternal. Skrip menangani
ini dengan fallback aman - jika TinyURL gagal/timeout, link ASLI (yang
panjang) yang dipakai, bukan skrip berhenti.



Seluruh kategori sekarang mengunci pencarian ke **bulan saat bot
dijalankan** — bukan lagi jendela "1-2 hari terakhir" yang longgar untuk
kategori harian, atau "rilis resmi terbaru meski usianya lebih lama"
untuk kategori BPS/PKPN. Aturannya seragam: jika tanggal sumber sebuah
berita/rilis BUKAN bulan berjalan, ITEM ITU TIDAK BOLEH MASUK — walau itu
rilis resmi terakhir yang tersedia. Ini sengaja lebih ketat daripada
sebelumnya untuk mencegah item lama (mis. berita Februari) muncul di
briefing Agustus.

Konsekuensinya: pada bulan tanpa rilis BPS/BI baru, kategori terkait akan
(dan seharusnya) menyatakan "tidak ada perkembangan baru" — bahkan jika
rilis terakhir yang tersedia sebenarnya masih relevan tapi berasal dari
bulan sebelumnya. Ini trade-off yang disengaja demi resensi ketat;
sesuaikan lagi ke README "Kategori Regional" jika trade-off ini ternyata
kurang cocok untuk kebutuhan Bapak/Ibu.

Nama bulan dihitung dari tanggal sistem lewat pemetaan manual
(`BULAN_INDONESIA`), bukan `strftime` yang bergantung locale OS — supaya
hasilnya konsisten "Agustus 2026" di komputer mana pun, bukan berubah
jadi "August 2026" tergantung pengaturan bahasa sistem.

## Thumbnail Berita (Telegram)

Setelah pesan teks terkirim, agent mengirim satu foto per kategori: gambar
`og:image` dari halaman sumber berita pertama yang punya gambar (`thumbnails.py`,
dipakai `agent.py` dan `agent_gemini.py`). Link redirect Gemini diikuti sampai
halaman asli. Jika halaman tidak punya `og:image`, memblokir bot, atau Telegram
gagal mengambil gambarnya, foto itu dilewati dan briefing tetap terkirim.
Jalankan `python thumbnails.py` untuk self-check parser.

## Tone dan Rekomendasi ke NETRA

NETRA (aplikasi kantor pusat) menerima link berita regional pilihan dari tiap
Kanwil. `netra.py` menentukan berita mana yang direkomendasikan:

1. Setelah semua kategori selesai, satu panggilan model menilai tone seluruh
   berita (`positif` / `netral` / `negatif`). Jika panggilan gagal, semua dianggap
   `netral` (tidak direkomendasikan).
2. Hanya berita **bertone positif** yang diperiksa terhadap empat query boolean
   (daftar `QN` di `netra.py`, sama dengan query NETRA: tiap grup `OR`, antar
   grup `AND`). Yang lolos mendapat kategori NETRA (1-4), hashtag, dan kata cocok.
3. Hasilnya ditulis ke Google Sheet: kolom `tone`, `netra_kategori`,
   `netra_hashtag`, `netra_kata`, dan `status_netra` (kosong, diisi analis saat
   link sudah diteruskan ke NETRA). Baris dengan `netra_kategori` terisi adalah
   rekomendasi.

Pencocokan query dilakukan pada baris ringkasan yang dibuat agent, bukan teks
penuh artikel. Jika Sheet sudah punya header lama (7 kolom), tambahkan lima
kolom di atas ke kanan atau buat Sheet baru. Jalankan `python netra.py` untuk
self-check.

## Login dan Peran

Aplikasi web memakai login (username dan password) dengan dua akun tetap:

| Akun | Boleh | Password awal |
|---|---|---|
| `tamu` | melihat berita, tone, dan NETRA | `tamu` (atau isi env `TAMU_PASSWORD`) |
| `admin` | semua yang dilakukan tamu, **tarik berita**, dan **ganti password** | isi env `ADMIN_PASSWORD` |

- Sesi memakai cookie `HttpOnly`, `Secure`, `SameSite=Strict` (berlaku 12 jam) yang
  ditandatangani dengan `SESSION_SECRET`. Buat nilainya dengan
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- Menu akun (ikon orang di header) berisi **Ganti password** (khusus admin) dan **Keluar**.
  Admin bisa mengganti password dirinya sendiri (minimal 12 karakter) dan password
  `tamu` (minimal 4 karakter), dengan memasukkan password admin saat ini.
- Setelah password diganti lewat aplikasi, nilainya disimpan sebagai hash (scrypt)
  di tab `pengguna` pada Google Sheet (dibuat otomatis) dan menggantikan nilai env.
  Sesi lama akun itu langsung tidak berlaku. Pakai file Sheet terpisah lewat env
  `USERS_SHEET_ID` agar hash tidak terlihat analis. Jika tab `pengguna` dihapus,
  password kembali ke nilai env.
- Env di Vercel: `SESSION_SECRET` (wajib, minimal 32 karakter), `ADMIN_PASSWORD` (wajib),
  `TAMU_PASSWORD` dan `USERS_SHEET_ID` (opsional). Service account perlu peran Editor
  pada Sheet tempat tab `pengguna` berada.
- Pembatas percobaan login ada di memori per instance (5 kegagalan per IP per 10 menit),
  jadi tidak mutlak. Untuk batas yang ketat pasang Vercel Firewall rate limit. Password
  `tamu` yang pendek sengaja dipilih pemilik sistem; siapa pun yang tahu bisa membaca data.
- Uji tanpa jaringan: `node api/_selftest.js`.

## Web UI (membaca dari Google Sheet)

`public/index.html` adalah UI sungguhan (mockup lama ada di `mockup-ui.html`).
Halaman statis ini di-deploy bersama fungsi `api/` ke Vercel dan membaca data
lewat `GET /api/berita?days=7`, yang membaca Sheet dengan service account
(token read-only) dan men-cache 60 detik. `days` = jumlah tanggal terakhir yang
ada datanya.

- Tab **Berita**: sorotan, feed per kategori dengan thumbnail dari kolom
  `gambar` (jika gagal dimuat diganti ilustrasi cadangan), papan 8 program PKPN
  (program dipetakan dari teks "Program Prioritas N"), pencarian, dan navigasi
  tanggal.
- Tab **Tone & NETRA**: sebaran tone per kategori, tabel data Sheet beserta
  status NETRA, dan daftar rekomendasi NETRA (baris dengan `netra_kategori`
  terisi) lengkap dengan tombol salin judul, link, dan hashtag.
- Tanda **verifikasi** (cincin emas) dan **diteruskan ke NETRA** hanya
  ditampilkan, tidak bisa diubah dari UI: isi kolom `verifikasi` atau
  `status_netra` langsung di Sheet.
- Halaman meminta login (lihat Login dan Peran). Tombol Tarik berita hanya muncul
  untuk admin, dan API-nya menolak akun lain dengan 403 walau dipanggil langsung.

Env tambahan di Vercel (nilai sama dengan secret di GitHub): `GOOGLE_SERVICE_ACCOUNT_JSON`
dan `SHEET_ID`. Kolom Sheet sekarang 13: `tanggal, kategori_key, kategori, teks, link,
gambar, verifikasi, tone, netra_kategori, netra_hashtag, netra_kata, status_netra, sumber`
(`sumber` = domain asli berita, diisi agent). Header lama perlu ditambah kolom `sumber`
di paling kanan.

## Menu WhatsApp (pesan untuk grup kantor)

Tab **WhatsApp** menyusun pesan siap kirim dari berita pada tanggal yang dipilih di
header (**hanya admin**: tabnya disembunyikan untuk tamu). Isi pesan, berurutan dan bernomor:

1. **Rekomendasi NETRA** (tone positif dan lolos query), lalu
2. **Berita positif lainnya**, 3. **Berita netral**, 4. **Perlu perhatian (tone negatif)**.

Tiap berita berupa judul singkat (awalan "Program Prioritas N" dibuang, dipotong
di 150 karakter) dan link dari Sheet pada baris sendiri, ditutup catatan agar
pegawai memverifikasi ke sumber asli. Semua berita dipilih secara default;
hapus centang per berita, atau pakai "Kosongkan" / "Pilih semua" per kelompok.
Tombol **Salin pesan** menyalin teks, **Buka WhatsApp** membuka `wa.me` dengan
teks terisi (pilih grup di WhatsApp lalu kirim). Pesan di atas 3.500 karakter
diberi peringatan: salin lalu tempel langsung bila WhatsApp memotongnya.

Pengiriman otomatis ke grup tidak dibuat: WhatsApp tidak menyediakan cara resmi
yang sederhana untuk mengirim ke grup biasa, jadi langkah terakhir (menekan
kirim) tetap manual.

## Tombol "Tarik berita" dari Web (Endpoint)

Web statis tidak boleh menyimpan token GitHub, jadi tombolnya memanggil dua
fungsi kecil di folder `api/` yang di-deploy ke Vercel (impor repo ini sebagai
project, tanpa framework). Fungsi itu memicu workflow `briefing-harian.yml` lewat
GitHub API.

- `POST /api/tarik` body `{"kategori": ["fiskal_moneter"], "telegram": true}`.
  `kategori` kosong = semua; `telegram: false` = hanya tulis ke Sheet. Dibatasi
  sekali per 30 menit (dihitung dari run manual terakhir) dan ditolak (409)
  jika masih ada proses berjalan. Run terjadwal 06:00 tidak memicu batas.
- `GET /api/status` mengembalikan `{status, conclusion, event, created_at, updated_at}`
  run terakhir; UI memanggilnya tiap beberapa detik untuk progres.
- Keduanya hanya untuk admin (lihat Login dan Peran); sesi dibawa lewat cookie.

Env di Vercel (Settings, Environment Variables):

| Nama | Isi |
|---|---|
| `GH_TOKEN` | Fine-grained PAT, hanya repo ini, izin Actions: Read and write |
| `GH_REPO` | `pemilik/nama-repo` |
| `GH_WORKFLOW` | `briefing-harian.yml` (default) |
| `GH_REF` | branch, mis. `main` (default) |

Uji tanpa jaringan: `node api/_selftest.js`. Untuk akses per orang (bukan dua
akun bersama) pasang Vercel Authentication atau Cloudflare Access di depan situsnya.

## Menambah atau Mengubah Kategori

Semua kategori didefinisikan di `categories.py`. Untuk menambah kategori
baru, tambahkan entri baru ke dictionary `CATEGORIES` mengikuti pola yang
sudah ada — `agent.py` tidak perlu diubah, ia akan otomatis memproses
kategori apa pun yang ada di file tersebut.

## Estimasi Biaya

Setiap hari: 5 panggilan API (satu per kategori) × maksimum 700 token
output + biaya web search per panggilan. Pantau penggunaan riil di
[console.anthropic.com](https://console.anthropic.com) pada menu Usage,
dan sesuaikan `max_uses` pada tool web search di `agent.py` jika perlu
membatasi biaya.

## Keterbatasan yang Diketahui

- Web search bisa saja tidak menemukan rilis terbaru meski sebenarnya
  sudah terbit (keterlambatan indeksasi mesin pencari) — jangan jadikan
  agent ini satu-satunya sumber pemantauan untuk keputusan penting.
- BPS/BI umumnya merilis data bulanan, bukan harian — pada hari tanpa
  rilis baru, kategori regional akan (dan seharusnya) menyatakan "tidak
  ada perkembangan baru", ini perilaku yang diharapkan, bukan bug.
- Pesan Telegram dibatasi ~4096 karakter; skrip sudah memecah otomatis
  jika melebihi batas, tetapi disarankan tetap menjaga `max_tokens` per
  kategori agar ringkasan tetap ringkas dan mudah dipindai.

## Alternatif: Menjalankan dengan Gemini API (Google AI Studio)

Jika ingin memakai Gemini API alih-alih Claude API (alasan biaya), berkas
`agent_gemini.py` dan `categories_gemini.py` sudah disediakan sebagai
versi paralel — fungsinya identik, hanya penyedia model yang berbeda.

### Langkah Setup Tambahan
1. Buka [aistudio.google.com/apikey](https://aistudio.google.com/apikey),
   buat API key baru (gratis untuk tier percobaan dengan batas kuota).
2. Tambahkan `GEMINI_API_KEY=...` ke berkas `.env` (selain dua nilai
   Telegram yang sudah ada).
3. `pip install -r requirements-gemini.txt`
4. `python agent_gemini.py`

### Perbedaan Penting dari Versi Claude
- **Tool pencarian**: Gemini memakai *Google Search grounding*
  (`types.Tool(google_search=types.GoogleSearch())`), bukan `web_search`.
- **Model**: memakai `gemini-2.5-flash-lite` sebagai tier termurah yang
  mendukung grounding saat berkas ini dibuat. **Harga dan ketersediaan
  tier Gemini berubah cukup sering** — cek
  [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
  secara berkala dan sesuaikan nilai `MODEL` di `agent_gemini.py` bila
  perlu.
- **Kepatuhan tampilan hasil grounded**: kebijakan Google mensyaratkan
  Search Suggestions ditampilkan jika hasil grounded ditampilkan ke
  pengguna akhir. Prompt di `categories_gemini.py` sudah diarahkan agar
  setiap poin mencantumkan nama sumber secara eksplisit di teks sebagai
  bentuk atribusi, sehingga tetap wajar dipakai di saluran teks-polos
  seperti Telegram. Untuk kebutuhan yang lebih formal (misalnya dashboard
  web), pertimbangkan menampilkan `groundingMetadata` dari respons API
  secara langsung agar sepenuhnya mematuhi ketentuan tersebut.
- **Kecenderungan gaya**: Gemini lebih verbose secara default dibanding
  Claude, sehingga `categories_gemini.py` menulis batasan format lebih
  tegas dan repetitif dibanding `categories.py`. Jika hasil masih kurang
  ringkas setelah diuji, perketat lagi instruksi "maksimal 4 poin" dan
  "jangan menyimpang".

### Bisa Pakai Keduanya Sekaligus?
Bisa — kedua skrip independen dan tidak saling mengganggu. Sebagian
praktisi menjalankan Gemini untuk pemantauan harian (murah, volume
tinggi) dan sesekali membandingkan dengan Claude untuk kategori yang
kualitas ringkasannya paling kritis (misalnya sebelum ALCo). Jika ingin
pendekatan ini, jadwalkan `agent_gemini.py` harian dan `agent.py` mingguan
sebagai pembanding kualitas.

