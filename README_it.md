<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_ko.md">한국어</a> | <a href="README_es.md">Español</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a> | <a href="README_pt.md">Português</a> | <a href="README_ru.md">Русский</a> | <a href="README_ar.md">العربية</a> | <a href="README_hi.md">हिन्दी</a> | <strong>Italiano</strong> | <a href="README_tr.md">Türkçe</a> | <a href="README_vi.md">Tiếng Việt</a> | <a href="README_th.md">ภาษาไทย</a> | <a href="README_id.md">Bahasa Indonesia</a> | <a href="README_pl.md">Polski</a> | <a href="README_nl.md">Nederlands</a>
</p>

> [!IMPORTANT]
> **Fork status:** This is the **Rudy774 fork**, which differs from the original OpenTypeless project. Source code, releases, and support are provided only through [github.com/rudy774/opentypeless](https://github.com/rudy774/opentypeless). This fork does **not** currently provide a hosted paid service, and automatic updates are disabled.

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Logo OpenTypeless" />
</p>

<h1 align="center">OpenTypeless</h1>

<p align="center">
  Input vocale IA open source per desktop. Parla in modo naturale, ottieni testo raffinato in qualsiasi applicazione.
</p>

<p align="center">
  Che tu stia scrivendo email, codice, chattando o prendendo appunti — basta premere un tasto,<br/>
  esprimi i tuoi pensieri, e OpenTypeless trascrive e raffina le tue parole con l'IA,<br/>
  poi le digita direttamente nell'applicazione che stai usando.
</p>

<p align="center">
  <a href="https://github.com/rudy774/opentypeless/actions/workflows/ci.yml"><img src="https://github.com/rudy774/opentypeless/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rudy774/opentypeless/releases"><img src="https://img.shields.io/github/v/release/rudy774/opentypeless?color=2ABBA7" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/rudy774/opentypeless" alt="Licenza" /></a>
  <a href="https://github.com/rudy774/opentypeless/stargazers"><img src="https://img.shields.io/github/stars/rudy774/opentypeless?style=social" alt="Stelle" /></a>
</p>

<p align="center">
  <img src="docs/images/v1.1.49-app-context-showcase.jpg" width="820" alt="Input vocale OpenTypeless adattato a Gmail, Slack, Google Docs, Cursor, Zendesk e LinkedIn" />
</p>

<p align="center">
  <img src="docs/images/voice-flow-demo.gif" width="720" alt="Demo OpenTypeless" />
</p>

## Inherited upstream capabilities

The capabilities below originated in the upstream project before this fork. This is historical attribution, not a release-version or support claim.

- **Scrittura consapevole dell’app** rileva localmente l’applicazione attiva e adatta struttura e tono per e-mail, chat, documenti, sistemi di gestione delle issue, strumenti di sviluppo e altro ancora.
- **Instradamento dell’intento vocale** distingue dettatura, modifica del testo selezionato, traduzione, Ask Anything e azioni vocali supportate in inglese, cinese semplificato e cinese tradizionale.
- **Più scorciatoie per flusso di lavoro** consentono di aggiungere e riordinare più combinazioni per Dettatura, Ask Anything e Traduzione.
- **Destinazioni di traduzione intercambiabili** permettono di passare rapidamente tra le lingue utilizzate senza fissare un’unica lingua di output.
- **Un dizionario locale più completo** aggiunge regole di correzione e importazione/esportazione del dizionario.
- **Associazioni di stile per app** consentono di sostituire la categoria integrata quando un’applicazione richiede uno stile di scrittura diverso.

Il rilevamento delle app, le associazioni, il dizionario e le regole di correzione vengono salvati localmente. La rifinitura consapevole dell’app invia al percorso LLM configurato solo la categoria interna dell’app e metadati di stile approvati; i titoli grezzi delle finestre e il contenuto dei documenti non vengono inviati come contesto né salvati nella cronologia.

| Rifinitura IA consapevole dell’app | Dizionario locale e correzioni |
| --- | --- |
| <img src="docs/images/v1.1.49-app-aware-polish.jpg" width="420" alt="Rifinitura IA consapevole dell’app in OpenTypeless inherited upstream" /> | <img src="docs/images/v1.1.49-dictionary.jpg" width="420" alt="Dizionario locale e correzioni in OpenTypeless inherited upstream" /> |

<details>
<summary>Altri screenshot</summary>

<p align="center">
  <img src="docs/images/app-main-light.png" width="720" alt="Finestra principale OpenTypeless" />
</p>

| Impostazioni | Cronologia |
|---|---|
| <img src="docs/images/app-settings.png" width="360" /> | <img src="docs/images/app-history.png" width="360" /> |

</details>

---

## Perché OpenTypeless?

| | OpenTypeless | Dettatura macOS | Digitazione vocale Windows | Whisper Desktop |
|---|---|---|---|---|
| Raffinamento testo con IA | ✅ Multipli LLM | ❌ | ❌ | ❌ |
| Scelta provider STT | ✅ 6+ provider | ❌ Solo Apple | ❌ Solo Microsoft | ❌ Solo Whisper |
| Funziona in qualsiasi app | ✅ | ✅ | ✅ | ❌ Copia-incolla |
| Modalità traduzione | ✅ | ❌ | ❌ | ❌ |
| Open source | ✅ MIT | ❌ | ❌ | ✅ |
| Multipiattaforma | ✅ Win/Mac/Linux | ❌ Solo Mac | ❌ Solo Windows | ✅ |
| Dizionario personalizzato | ✅ | ❌ | ❌ | ❌ |
| Self-hosting | ✅ BYOK | ❌ | ❌ | ✅ |

## Funzionalità

- 🎙️ Tasto rapido globale — tieni premuto o attiva/disattiva
- 💊 Widget capsula flottante, sempre in primo piano
- 🗣️ 6+ provider STT: Deepgram, AssemblyAI, Whisper, Groq, GLM-ASR, SiliconFlow
- 🤖 Raffinamento testo tramite più LLM: OpenAI, DeepSeek, Claude, Gemini, Ollama e altri
- ⚡ Output in streaming — il testo appare man mano che il LLM lo genera
- ⌨️ Simulazione tastiera o output tramite appunti
- 📝 Seleziona il testo prima di registrare per dare contesto al LLM
- 🌐 Modalità traduzione: parla in una lingua, ottieni l'output in un'altra (20+ lingue)
- 📖 Dizionario personalizzato per termini specifici del dominio
- 🔍 Rilevamento per applicazione per adattare la formattazione
- 📜 Cronologia locale con ricerca full-text
- 🌗 Tema scuro / chiaro / sistema
- 🚀 Avvio automatico all'accesso

> [!TIP]
> **Configurazione consigliata per la migliore esperienza**
>
> | | Provider | Modello |
> |---|---|---|
> | 🗣️ STT | Groq | `whisper-large-v3-turbo` |
> | 🤖 Raffinamento IA | Google | `gemini-2.5-flash` |
>
> Questa combinazione offre trascrizione veloce e accurata con raffinamento del testo di alta qualità — ed entrambi offrono generosi livelli gratuiti.

## Download

Scarica l'ultima versione per la tua piattaforma:

**[Scarica dalle Releases](https://github.com/rudy774/opentypeless/releases)**

| Piattaforma | File |
|-------------|------|
| Windows | Installer `.msi` |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.AppImage` / `.deb` |

## Prerequisiti

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (toolchain stabile)
- Dipendenze specifiche della piattaforma per Tauri: vedi [Prerequisiti Tauri](https://v2.tauri.app/start/prerequisites/)

## Per iniziare

```bash
# Installa le dipendenze
npm install

# Esegui in modalità sviluppo
npm run tauri dev

# Compila per la produzione
npm run tauri build
```

L'applicazione compilata si troverà in `src-tauri/target/release/bundle/`.

## Configurazione

Tutte le impostazioni sono accessibili dal pannello Impostazioni dell'app:

- **Riconoscimento vocale** — scegli il provider STT e inserisci la tua chiave API
- **Raffinamento IA** — scegli il provider LLM, modello e chiave API
- **Generale** — tasto rapido, modalità output, tema, avvio automatico
- **Dizionario** — aggiungi termini personalizzati per una migliore precisione di trascrizione
- **Scene** — modelli di prompt per diversi casi d'uso

Le chiavi API sono memorizzate localmente tramite `tauri-plugin-store`. Nessuna chiave viene inviata ai server OpenTypeless — tutte le richieste STT/LLM vanno direttamente al provider configurato.

### Managed service status for this fork

This fork currently supports bring-your-own-key and local providers. It does not include a hosted paid service. Account, entitlement, checkout, backup, and managed transcription features remain disabled unless you build and operate a compatible backend yourself.

A self-hosted managed backend must be configured explicitly at build time with both `VITE_MANAGED_API_BASE_URL` and `OPENTYPELESS_MANAGED_API_BASE_URL`. There is no production default. Both values must be the same owned HTTPS origin; see `docs/MANAGED_SERVICE_API.md` and `docs/COMMERCIALIZATION.md`.
## Architettura

**Pipeline del flusso dati:**

```
Microfono → Cattura audio → Provider STT → Trascrizione grezza → Raffinamento LLM → Output tastiera/appunti
```

```
src/                  # Frontend React (TypeScript)
├── components/       # Componenti UI (Impostazioni, Cronologia, Capsula, ecc.)
├── hooks/            # Hook React (registrazione, tema, eventi Tauri)
├── lib/              # Utility (client API, router, costanti)
└── stores/           # Gestione stato Zustand

src-tauri/src/        # Backend Rust
├── audio/            # Cattura audio via cpal
├── stt/              # Provider STT (Deepgram, AssemblyAI, compatibile Whisper, Cloud)
├── llm/              # Provider LLM (compatibile OpenAI, Cloud)
├── output/           # Output testo (simulazione tastiera, incolla da appunti)
├── storage/          # Configurazione (tauri-plugin-store) + cronologia/dizionario (SQLite)
├── app_detector/     # Rilevamento applicazione attiva per contesto
├── pipeline.rs       # Orchestrazione Registrazione → STT → LLM → Output
└── lib.rs            # Setup app Tauri, comandi, gestione tasti rapidi
```

## Roadmap

- [ ] Sistema di plugin per integrazioni STT/LLM personalizzate
- [ ] Miglioramento della precisione STT multilingue e supporto dialetti
- [ ] Comandi vocali
- [ ] Combinazioni di tasti personalizzabili
- [ ] Esperienza di onboarding migliorata
- [ ] App mobile companion

## FAQ

**Il mio audio viene inviato al cloud?**
In modalità BYOK, l'audio va direttamente al provider STT scelto (es. Groq, Deepgram). Niente passa attraverso i server OpenTypeless. In modalità Cloud (Pro), l'audio viene inviato al nostro proxy gestito per la trascrizione.

**Posso usarlo offline?**
Con un provider STT locale (Whisper tramite Ollama) e un LLM locale (Ollama), l'app funziona completamente offline. Nessuna connessione internet necessaria.

**Quali lingue sono supportate?**
STT supporta 99+ lingue a seconda del provider. Il raffinamento IA e la traduzione supportano 20+ lingue di destinazione.

**L'app è gratuita?**
Sì. L'app è pienamente funzionale con le proprie chiavi API (BYOK). L'abbonamento Cloud Pro ($4,99/mese) è opzionale.

## Comunità

- 🗣️ [GitHub Discussions](https://github.com/rudy774/opentypeless/discussions) — Proposte di funzionalità, domande e risposte
- 🐛 [Issue Tracker](https://github.com/rudy774/opentypeless/issues) — Segnalazioni bug e richieste funzionalità
- 📖 [Guida al contributo](CONTRIBUTING.md) — Setup di sviluppo e linee guida
- 🔒 [Politica di sicurezza](SECURITY.md) — Segnalare vulnerabilità in modo responsabile
- 🧭 [Visione](VISION.md) — Principi del progetto e direzione della roadmap

## Contribuire

I contributi sono benvenuti! Consulta [CONTRIBUTING.md](CONTRIBUTING.md) per il setup di sviluppo e le linee guida.

Cerchi da dove iniziare? Controlla le issue con l'etichetta [`good first issue`](https://github.com/rudy774/opentypeless/labels/good%20first%20issue).

## Star History

<a href="https://star-history.com/#rudy774/opentypeless&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date" />
    <img alt="Grafico Star History" src="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date" />
  </picture>
</a>

## Sviluppato con Claude Code in un giorno

L'intero progetto è stato costruito in un solo giorno usando [Claude Code](https://claude.com/claude-code) — dalla progettazione dell'architettura all'implementazione completa, inclusi backend Tauri, frontend React, pipeline CI/CD e questo README.

## Licenza

[MIT](LICENSE)
