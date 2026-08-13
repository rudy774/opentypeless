<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_ko.md">한국어</a> | <a href="README_es.md">Español</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a> | <a href="README_pt.md">Português</a> | <strong>Русский</strong> | <a href="README_ar.md">العربية</a> | <a href="README_hi.md">हिन्दी</a> | <a href="README_it.md">Italiano</a> | <a href="README_tr.md">Türkçe</a> | <a href="README_vi.md">Tiếng Việt</a> | <a href="README_th.md">ภาษาไทย</a> | <a href="README_id.md">Bahasa Indonesia</a> | <a href="README_pl.md">Polski</a> | <a href="README_nl.md">Nederlands</a>
</p>

> [!IMPORTANT]
> **Fork status:** This is the **Rudy774 fork**, which differs from the original OpenTypeless project. Source code, releases, and support are provided only through [github.com/rudy774/opentypeless](https://github.com/rudy774/opentypeless). This fork does **not** currently provide a hosted paid service, and automatic updates are disabled.

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Логотип OpenTypeless" />
</p>

<h1 align="center">OpenTypeless</h1>

<p align="center">
  Голосовой ввод с ИИ для рабочего стола с открытым исходным кодом. Говорите естественно, получайте отшлифованный текст в любом приложении.
</p>

<p align="center">
  Пишете ли вы электронные письма, код, чат или заметки — просто нажмите клавишу,<br/>
  скажите свою мысль, и OpenTypeless расшифрует и отшлифует ваши слова с помощью ИИ,<br/>
  а затем введёт их прямо в приложение, которое вы используете.
</p>

<p align="center">
  <a href="https://github.com/rudy774/opentypeless/actions/workflows/ci.yml"><img src="https://github.com/rudy774/opentypeless/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rudy774/opentypeless/releases"><img src="https://img.shields.io/github/v/release/rudy774/opentypeless?color=2ABBA7" alt="Релиз" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/rudy774/opentypeless" alt="Лицензия" /></a>
  <a href="https://github.com/rudy774/opentypeless/stargazers"><img src="https://img.shields.io/github/stars/rudy774/opentypeless?style=social" alt="Звёзды" /></a>
</p>

<p align="center">
  <img src="docs/images/v1.1.49-app-context-showcase.jpg" width="820" alt="Контекстный голосовой ввод OpenTypeless в Gmail, Slack, Google Docs, Cursor, Zendesk и LinkedIn" />
</p>

<p align="center">
  <img src="docs/images/voice-flow-demo.gif" width="720" alt="Демо OpenTypeless" />
</p>

## Inherited upstream capabilities

The capabilities below originated in the upstream project before this fork. This is historical attribution, not a release-version or support claim.

- **Контекстное письмо с учётом приложения** локально определяет активную программу и адаптирует структуру и тон для почты, чатов, документов, трекеров задач, инструментов разработки и других сценариев.
- **Маршрутизация голосовых намерений** различает диктовку, редактирование выделенного текста, перевод, Ask Anything и поддерживаемые голосовые действия на английском, упрощённом и традиционном китайском языках.
- **Несколько сочетаний клавиш для каждого сценария** позволяют добавлять и менять порядок нескольких комбинаций для Диктовки, Ask Anything и Перевода.
- **Переключаемые языки перевода** позволяют быстро менять используемый язык вывода вместо одного фиксированного варианта.
- **Расширенный локальный словарь** поддерживает правила исправлений, а также импорт и экспорт словаря.
- **Стили для отдельных приложений** позволяют переопределить встроенную категорию, если приложению нужен другой стиль письма.

Распознавание приложений, сопоставления, словарь и правила исправлений хранятся локально. Контекстная обработка передаёт настроенной LLM только внутреннюю категорию приложения и разрешённые метаданные стиля; исходные заголовки окон и содержимое документов не отправляются как контекст и не сохраняются в истории.

| Контекстная обработка с ИИ | Локальный словарь и исправления |
| --- | --- |
| <img src="docs/images/v1.1.49-app-aware-polish.jpg" width="420" alt="Контекстная обработка с ИИ в OpenTypeless inherited upstream" /> | <img src="docs/images/v1.1.49-dictionary.jpg" width="420" alt="Локальный словарь и исправления в OpenTypeless inherited upstream" /> |

<details>
<summary>Ещё скриншоты</summary>

<p align="center">
  <img src="docs/images/app-main-light.png" width="720" alt="Главное окно OpenTypeless" />
</p>

| Настройки | История |
|---|---|
| <img src="docs/images/app-settings.png" width="360" /> | <img src="docs/images/app-history.png" width="360" /> |

</details>

---

## Почему OpenTypeless?

| | OpenTypeless | Диктовка macOS | Голосовой ввод Windows | Whisper Desktop |
|---|---|---|---|---|
| ИИ-полировка текста | ✅ Несколько LLM | ❌ | ❌ | ❌ |
| Выбор провайдера STT | ✅ 6+ провайдеров | ❌ Только Apple | ❌ Только Microsoft | ❌ Только Whisper |
| Работает в любом приложении | ✅ | ✅ | ✅ | ❌ Копировать-вставить |
| Режим перевода | ✅ | ❌ | ❌ | ❌ |
| Открытый исходный код | ✅ MIT | ❌ | ❌ | ✅ |
| Кроссплатформенность | ✅ Win/Mac/Linux | ❌ Только Mac | ❌ Только Windows | ✅ |
| Пользовательский словарь | ✅ | ❌ | ❌ | ❌ |
| Самостоятельный хостинг | ✅ BYOK | ❌ | ❌ | ✅ |

## Возможности

- 🎙️ Глобальная горячая клавиша — удержание или переключение
- 💊 Плавающий виджет-капсула, всегда поверх окон
- 🗣️ 6+ провайдеров STT: Deepgram, AssemblyAI, Whisper, Groq, GLM-ASR, SiliconFlow
- 🤖 Полировка текста через несколько LLM: OpenAI, DeepSeek, Claude, Gemini, Ollama и другие
- ⚡ Потоковый вывод — текст появляется по мере генерации
- ⌨️ Эмуляция клавиатуры или вывод через буфер обмена
- 📝 Выделите текст перед записью, чтобы дать контекст LLM
- 🌐 Режим перевода: говорите на одном языке, получайте на другом (20+ языков)
- 📖 Пользовательский словарь для специализированных терминов
- 🔍 Определение приложения для адаптации форматирования
- 📜 Локальная история с полнотекстовым поиском
- 🌗 Тёмная / светлая / системная тема
- 🚀 Автозапуск при входе в систему

> [!TIP]
> **Рекомендуемая конфигурация для лучшего опыта**
>
> | | Провайдер | Модель |
> |---|---|---|
> | 🗣️ STT | Groq | `whisper-large-v3-turbo` |
> | 🤖 ИИ-полировка | Google | `gemini-2.5-flash` |
>
> Эта комбинация обеспечивает быструю и точную транскрипцию с высококачественной полировкой текста — и оба предлагают щедрые бесплатные тарифы.

## Скачать

Скачайте последнюю версию для вашей платформы:

**[Скачать из Releases](https://github.com/rudy774/opentypeless/releases)**

| Платформа | Файл |
|-----------|------|
| Windows | Установщик `.msi` |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.AppImage` / `.deb` |

## Предварительные требования

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable toolchain)
- Платформенные зависимости для Tauri: см. [Предварительные требования Tauri](https://v2.tauri.app/start/prerequisites/)

## Начало работы

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки
npm run tauri dev

# Сборка для продакшена
npm run tauri build
```

Собранное приложение будет в `src-tauri/target/release/bundle/`.

## Настройка

Все параметры доступны из панели настроек приложения:

- **Распознавание речи** — выберите провайдера STT и введите API-ключ
- **ИИ-полировка** — выберите провайдера LLM, модель и API-ключ
- **Общие** — горячая клавиша, режим вывода, тема, автозапуск
- **Словарь** — добавьте пользовательские термины для повышения точности
- **Сцены** — шаблоны промптов для разных сценариев

API-ключи хранятся локально через `tauri-plugin-store`. Ключи не отправляются на серверы OpenTypeless — все STT/LLM-запросы идут напрямую к выбранному провайдеру.

### Managed service status for this fork

This fork currently supports bring-your-own-key and local providers. It does not include a hosted paid service. Account, entitlement, checkout, backup, and managed transcription features remain disabled unless you build and operate a compatible backend yourself.

A self-hosted managed backend must be configured explicitly at build time with both `VITE_MANAGED_API_BASE_URL` and `OPENTYPELESS_MANAGED_API_BASE_URL`. There is no production default. Both values must be the same owned HTTPS origin; see `docs/MANAGED_SERVICE_API.md` and `docs/COMMERCIALIZATION.md`.
## Архитектура

**Конвейер обработки данных:**

```
Микрофон → Захват аудио → Провайдер STT → Сырая транскрипция → Полировка LLM → Вывод через клавиатуру/буфер обмена
```

```
src/                  # React-фронтенд (TypeScript)
├── components/       # UI-компоненты (Настройки, История, Капсула и др.)
├── hooks/            # React-хуки (запись, тема, события Tauri)
├── lib/              # Утилиты (API-клиент, роутер, константы)
└── stores/           # Управление состоянием Zustand

src-tauri/src/        # Rust-бэкенд
├── audio/            # Захват аудио через cpal
├── stt/              # Провайдеры STT (Deepgram, AssemblyAI, Whisper-совместимый, Cloud)
├── llm/              # Провайдеры LLM (OpenAI-совместимый, Cloud)
├── output/           # Текстовый вывод (эмуляция клавиатуры, вставка из буфера обмена)
├── storage/          # Конфигурация (tauri-plugin-store) + история/словарь (SQLite)
├── app_detector/     # Обнаружение активного приложения
├── pipeline.rs       # Оркестрация: Запись → STT → LLM → Вывод
└── lib.rs            # Настройка Tauri, команды, обработка горячих клавиш
```

## Дорожная карта

- [ ] Система плагинов для пользовательских STT/LLM-интеграций
- [ ] Улучшение многоязычной точности STT и поддержка диалектов
- [ ] Голосовые команды
- [ ] Настраиваемые комбинации горячих клавиш
- [ ] Улучшенный процесс знакомства с приложением
- [ ] Мобильное приложение-компаньон

## FAQ

**Отправляется ли моё аудио в облако?**
В режиме BYOK аудио отправляется напрямую выбранному провайдеру STT (например, Groq, Deepgram). Ничего не проходит через серверы OpenTypeless. В режиме Cloud (Pro) аудио отправляется на наш управляемый прокси для транскрипции.

**Можно ли использовать офлайн?**
С локальным провайдером STT (Whisper через Ollama) и локальным LLM (Ollama) приложение работает полностью офлайн. Интернет не нужен.

**Какие языки поддерживаются?**
STT поддерживает 99+ языков в зависимости от провайдера. ИИ-полировка и перевод поддерживают 20+ целевых языков.

**Приложение бесплатное?**
Да. Приложение полностью функционально с вашими собственными API-ключами (BYOK). Подписка Cloud Pro ($4.99/месяц) опциональна.

## Сообщество

- 🗣️ [GitHub Discussions](https://github.com/rudy774/opentypeless/discussions) — Предложения функций, вопросы и ответы
- 🐛 [Issue Tracker](https://github.com/rudy774/opentypeless/issues) — Отчёты об ошибках и запросы функций
- 📖 [Руководство по вкладу](CONTRIBUTING.md) — Настройка разработки и рекомендации
- 🔒 [Политика безопасности](SECURITY.md) — Ответственно сообщить об уязвимостях
- 🧭 [Видение](VISION.md) — Принципы проекта и направление развития

## Вклад

Вклады приветствуются! См. [CONTRIBUTING.md](CONTRIBUTING.md) для настройки разработки и рекомендаций.

Ищете с чего начать? Посмотрите задачи с меткой [`good first issue`](https://github.com/rudy774/opentypeless/labels/good%20first%20issue).

## Star History

<a href="https://star-history.com/#rudy774/opentypeless&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date" />
    <img alt="График истории звёзд" src="https://api.star-history.com/svg?repos=rudy774/opentypeless&type=Date" />
  </picture>
</a>

## Создано с помощью Claude Code за один день

Весь этот проект был создан за один день с помощью [Claude Code](https://claude.com/claude-code) — от проектирования архитектуры до полной реализации, включая бэкенд Tauri, фронтенд React, конвейер CI/CD и этот README.

## Лицензия

[MIT](LICENSE)
