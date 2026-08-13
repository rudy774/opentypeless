<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_ko.md">한국어</a> | <a href="README_es.md">Español</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a> | <a href="README_pt.md">Português</a> | <a href="README_ru.md">Русский</a> | <a href="README_ar.md">العربية</a> | <a href="README_hi.md">हिन्दी</a> | <a href="README_it.md">Italiano</a> | <a href="README_tr.md">Türkçe</a> | <a href="README_vi.md">Tiếng Việt</a> | <a href="README_th.md">ภาษาไทย</a> | <strong>Bahasa Indonesia</strong> | <a href="README_pl.md">Polski</a> | <a href="README_nl.md">Nederlands</a>
</p>

> [!IMPORTANT]
> **Fork status:** This is the **Rudy774 fork**, which differs from the original OpenTypeless project. Source code, releases, and support are provided only through [github.com/rudy774/opentypeless](https://github.com/rudy774/opentypeless). This fork does **not** currently provide a hosted paid service, and automatic updates are disabled.

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Logo OpenTypeless" />
</p>

<h1 align="center">OpenTypeless</h1>

<p align="center">
  Input suara AI sumber terbuka untuk desktop. Bicara secara alami, dapatkan teks yang rapi di aplikasi apa pun.
</p>

<p align="center">
  Baik Anda menulis email, coding, mengobrol, atau mencatat — cukup tekan tombol pintas,<br/>
  ucapkan apa yang Anda pikirkan, dan OpenTypeless akan mentranskrip dan memoles kata-kata Anda dengan AI,<br/>
  lalu mengetikkannya langsung ke aplikasi yang sedang Anda gunakan.
</p>

<p align="center">
  <a href="https://github.com/rudy774/opentypeless/actions/workflows/ci.yml"><img src="https://github.com/rudy774/opentypeless/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rudy774/opentypeless/releases"><img src="https://img.shields.io/github/v/release/rudy774/opentypeless?color=2ABBA7" alt="Rilis" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/rudy774/opentypeless" alt="Lisensi" /></a>
  <a href="https://github.com/rudy774/opentypeless/stargazers"><img src="https://img.shields.io/github/stars/rudy774/opentypeless?style=social" alt="Bintang" /></a>
</p>

<p align="center">
  <img src="docs/images/v1.1.49-app-context-showcase.jpg" width="820" alt="Input suara OpenTypeless yang menyesuaikan Gmail, Slack, Google Docs, Cursor, Zendesk, dan LinkedIn" />
</p>

<p align="center">
  <img src="docs/images/voice-flow-demo.gif" width="720" alt="Demo OpenTypeless" />
</p>

## Inherited upstream capabilities

The capabilities below originated in the upstream project before this fork. This is historical attribution, not a release-version or support claim.

- **Penulisan berbasis aplikasi** mendeteksi aplikasi aktif secara lokal dan menyesuaikan struktur serta nada untuk email, obrolan, dokumen, pelacak isu, alat pengembangan, dan lingkungan lainnya.
- **Perutean maksud suara** membedakan dikte, penyuntingan teks terpilih, terjemahan, Ask Anything, dan tindakan suara yang didukung dalam bahasa Inggris, Mandarin Sederhana, dan Mandarin Tradisional.
- **Beberapa pintasan untuk setiap alur kerja** memungkinkan lebih dari satu kombinasi ditambahkan dan diurutkan untuk Dikte, Ask Anything, dan Terjemahan.
- **Target terjemahan yang dapat dialihkan** memudahkan perpindahan antara bahasa yang sering digunakan tanpa menetapkan satu bahasa keluaran.
- **Kamus lokal yang lebih kuat** menambahkan aturan koreksi serta impor dan ekspor kamus.
- **Pemetaan gaya per aplikasi** memungkinkan kategori bawaan diganti ketika suatu aplikasi memerlukan gaya penulisan lain.

Deteksi aplikasi, pemetaan, entri kamus, dan aturan koreksi disimpan secara lokal. Pemolesan berbasis aplikasi hanya mengirim kategori aplikasi internal dan metadata gaya yang disetujui ke jalur LLM yang dikonfigurasi; judul jendela mentah dan isi dokumen tidak dikirim sebagai konteks aplikasi atau disimpan dalam riwayat.

| Pemolesan AI berbasis aplikasi | Kamus lokal dan koreksi |
| --- | --- |
| <img src="docs/images/v1.1.49-app-aware-polish.jpg" width="420" alt="Pemolesan AI berbasis aplikasi di OpenTypeless inherited upstream" /> | <img src="docs/images/v1.1.49-dictionary.jpg" width="420" alt="Kamus lokal dan koreksi di OpenTypeless inherited upstream" /> |

<details>
<summary>Lihat lebih banyak tangkapan layar</summary>

<p align="center">
  <img src="docs/images/app-main-light.png" width="720" alt="Jendela Utama OpenTypeless" />
</p>

| Pengaturan | Riwayat |
|---|---|
| <img src="docs/images/app-settings.png" width="360" /> | <img src="docs/images/app-history.png" width="360" /> |

</details>

---

## Mengapa OpenTypeless?

| | OpenTypeless | macOS Dictation | Windows Voice Typing | Whisper Desktop |
|---|---|---|---|---|
| Pemolesan teks AI | ✅ Beberapa LLM | ❌ | ❌ | ❌ |
| Pilihan penyedia STT | ✅ 6+ penyedia | ❌ Hanya Apple | ❌ Hanya Microsoft | ❌ Hanya Whisper |
| Berfungsi di semua aplikasi | ✅ | ✅ | ✅ | ❌ Salin-tempel |
| Mode terjemahan | ✅ | ❌ | ❌ | ❌ |
| Sumber terbuka | ✅ MIT | ❌ | ❌ | ✅ |
| Lintas platform | ✅ Win/Mac/Linux | ❌ Hanya Mac | ❌ Hanya Windows | ✅ |
| Kamus kustom | ✅ | ❌ | ❌ | ❌ |
| Hosting mandiri | ✅ BYOK | ❌ | ❌ | ✅ |

## Fitur

- 🎙️ Tombol pintas perekaman global — tahan untuk merekam atau mode sakelar
- 💊 Widget kapsul mengambang yang selalu di atas
- 🗣️ 6+ penyedia STT: Deepgram, AssemblyAI, Whisper, Groq, GLM-ASR, SiliconFlow
- 🤖 Pemolesan teks melalui beberapa LLM: OpenAI, DeepSeek, Claude, Gemini, Ollama, dan lainnya
- ⚡ Output streaming — teks muncul saat LLM menghasilkannya
- ⌨️ Simulasi keyboard atau output clipboard
- 📝 Sorot teks sebelum merekam untuk memberikan konteks kepada LLM
- 🌐 Mode terjemahan: bicara dalam satu bahasa, output dalam bahasa lain (20+ bahasa)
- 📖 Kamus kustom untuk istilah khusus domain
- 🔍 Deteksi per-aplikasi untuk menyesuaikan format
- 📜 Riwayat lokal dengan pencarian teks lengkap
- 🌗 Tema gelap / terang / sistem
- 🚀 Mulai otomatis saat login

> [!TIP]
> **Konfigurasi yang Direkomendasikan untuk Pengalaman Terbaik**
>
> | | Penyedia | Model |
> |---|---|---|
> | 🗣️ STT | Groq | `whisper-large-v3-turbo` |
> | 🤖 AI Polish | Google | `gemini-2.5-flash` |
>
> Kombinasi ini memberikan transkripsi cepat dan akurat dengan pemolesan teks berkualitas tinggi — dan keduanya menawarkan paket gratis yang cukup besar.

## Unduh

Unduh versi terbaru untuk platform Anda:

**[Unduh dari Releases](https://github.com/rudy774/opentypeless/releases)**

| Platform | File |
|----------|------|
| Windows | Installer `.msi` |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.AppImage` / `.deb` |

## Prasyarat

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable toolchain)
- Dependensi khusus platform untuk Tauri: lihat [Prasyarat Tauri](https://v2.tauri.app/start/prerequisites/)

## Memulai

```bash
# Instal dependensi
npm install

# Jalankan dalam mode pengembangan
npm run tauri dev

# Build untuk production
npm run tauri build
```

Aplikasi yang telah di-build akan berada di `src-tauri/target/release/bundle/`.

## Konfigurasi

Semua pengaturan dapat diakses dari panel Pengaturan dalam aplikasi:

- **Pengenalan Suara** — pilih penyedia STT dan masukkan API key Anda
- **AI Polish** — pilih penyedia LLM, model, dan API key
- **Umum** — tombol pintas, mode output, tema, mulai otomatis
- **Kamus** — tambahkan istilah kustom untuk akurasi transkripsi yang lebih baik
- **Skenario** — template prompt untuk berbagai kasus penggunaan

API key disimpan secara lokal melalui `tauri-plugin-store`. Tidak ada key yang dikirim ke server OpenTypeless — semua permintaan STT/LLM langsung menuju penyedia yang Anda konfigurasi.

### Managed service status for this fork

This fork currently supports bring-your-own-key and local providers. It does not include a hosted paid service. Account, entitlement, checkout, backup, and managed transcription features remain disabled unless you build and operate a compatible backend yourself.

A self-hosted managed backend must be configured explicitly at build time with both `VITE_MANAGED_API_BASE_URL` and `OPENTYPELESS_MANAGED_API_BASE_URL`. There is no production default. Both values must be the same owned HTTPS origin; see `docs/MANAGED_SERVICE_API.md` and `docs/COMMERCIALIZATION.md`.
## Arsitektur

**Pipeline Aliran Data:**

```
Mikrofon → Perekaman Audio → Penyedia STT → Transkrip Mentah → LLM Polish → Output Keyboard/Clipboard
```

```
src/                  # React frontend (TypeScript)
├── components/       # Komponen UI (Pengaturan, Riwayat, Capsule, dll.)
├── hooks/            # React hooks (perekaman, tema, event Tauri)
├── lib/              # Utilitas (API client, router, konstanta)
└── stores/           # Manajemen state Zustand

src-tauri/src/        # Rust backend
├── audio/            # Perekaman audio melalui cpal
├── stt/              # Penyedia STT (Deepgram, AssemblyAI, kompatibel Whisper, Cloud)
├── llm/              # Penyedia LLM (kompatibel OpenAI, Cloud)
├── output/           # Output teks (simulasi keyboard, tempel clipboard)
├── storage/          # Konfigurasi (tauri-plugin-store) + riwayat/kamus (SQLite)
├── app_detector/     # Deteksi aplikasi aktif untuk konteks
├── pipeline.rs       # Orkestrasi Perekaman → STT → LLM → Output
└── lib.rs            # Setup aplikasi Tauri, perintah, penanganan tombol pintas
```

## Peta Jalan

- [ ] Sistem plugin untuk integrasi STT/LLM kustom
- [ ] Peningkatan akurasi STT multi-bahasa dan dukungan dialek
- [ ] Perintah suara (mis. "hapus kalimat terakhir")
- [ ] Kombinasi tombol pintas yang dapat disesuaikan
- [ ] Peningkatan pengalaman onboarding
- [ ] Aplikasi pendamping mobile

## FAQ

**Apakah audio saya dikirim ke cloud?**
Dalam mode BYOK, audio langsung menuju penyedia STT pilihan Anda (mis. Groq, Deepgram). Tidak ada yang melewati server OpenTypeless. Dalam mode Cloud (Pro), audio dikirim ke proxy terkelola kami untuk transkripsi.

**Bisakah saya menggunakannya secara offline?**
Dengan penyedia STT lokal (Whisper melalui Ollama) dan LLM lokal (Ollama), aplikasi bekerja sepenuhnya secara offline. Tidak perlu koneksi internet.

**Bahasa apa saja yang didukung?**
STT mendukung 99+ bahasa tergantung penyedia. AI polish dan terjemahan mendukung 20+ bahasa target.

**Apakah aplikasi ini gratis?**
Ya. Aplikasi berfungsi penuh dengan API key Anda sendiri (BYOK). Langganan Cloud Pro ($4.99/bulan) bersifat opsional.

## Komunitas

- 🗣️ [GitHub Discussions](https://github.com/rudy774/opentypeless/discussions) — Proposal fitur, Tanya Jawab
- 🐛 [Issue Tracker](https://github.com/rudy774/opentypeless/issues) — Laporan bug dan permintaan fitur
- 📖 [Panduan Kontribusi](CONTRIBUTING.md) — Setup pengembangan dan panduan
- 🔒 [Kebijakan Keamanan](SECURITY.md) — Laporkan kerentanan secara bertanggung jawab
- 🧭 [Visi](VISION.md) — Prinsip proyek dan arah peta jalan

## Kontribusi

Kontribusi sangat diterima! Lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk setup pengembangan dan panduan.

Mencari tempat untuk memulai? Lihat issue berlabel [`good first issue`](https://github.com/rudy774/opentypeless/labels/good%20first%20issue).

## Riwayat Star

<a href="https://star-history.com/#rudy774/opentypeless&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date" />
    <img alt="Grafik Riwayat Star" src="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date" />
  </picture>
</a>

## Dibangun dengan Claude Code

Seluruh proyek ini dibangun dalam satu hari menggunakan [Claude Code](https://claude.com/claude-code) — dari desain arsitektur hingga implementasi penuh, termasuk Tauri backend, React frontend, pipeline CI/CD, dan README ini.

## Lisensi

[MIT](LICENSE)
