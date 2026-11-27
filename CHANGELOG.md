# Changelog

All notable changes to **NullByte** are documented in this file.

## [0.7.1] - 2026-11-27

### Added
- **Automatic Heavy-Load Retries (`providerClient.js`, `modelCatalog.js`, `main.js`)**:
  - Automatically retries transient overload / high-demand errors (`500`/`502`/`503`/`504`/`529`, `UNAVAILABLE`, `"heavy load"`, `"high demand"`, `"overloaded"`) up to **2 additional times** (`3` attempts total) with backoff across Google Gemini, OpenRouter, and Ollama while displaying live retry progress in the overlay.
  - Added `isOverloadError` classification and user-friendly fallback error messages when retries are exhausted.
- **Stop In-Flight Fetching via `Cmd/Ctrl + Shift + X` (`main.js`, `providerClient.js`, `renderer/overlay.html`)**:
  - Cancels active Gemini/OpenRouter/Ollama HTTP requests, SSE/NDJSON stream readers, async iterators, retry backoff sleeps, and pending auto-solve timers immediately when pressing `Cmd/Ctrl + Shift + X` (or clicking Tray **Clear Cache**), stopping the spinner and preventing stale chunks or captures from updating the overlay.
- **Retry & Cancellation Unit Tests (`test/providerRetryAndCancel.test.js`)**:
  - Added automated unit tests covering overload classification, error formatting, 2x automatic retries, non-retryable errors, and immediate `AbortController` stream and backoff cancellation.

### Fixed
- **macOS App Bundle & Menu Bar Tray Icons (`build/icon.icns`, `assets/icons/mac/icon.icns`, `main.js`)**:
  - Rebuilt `build/icon.icns` and `assets/icons/mac/icon.icns` with `iconutil` so the `.icns` file-length header matches the actual file size (`552015` bytes instead of a corrupt `8`-byte header that caused macOS Finder/IconServices to display a blank dark squircle).
  - Updated `main.js` with `createTrayIcon()` using Electron `nativeImage` (`18x18` `@1x` and `36x36` `@2x` representations) so the macOS menu bar tray icon renders cleanly.

## [0.7.0-beta] - 2026-11-27

### Added
- **Gemini 4 Hydrogen & Latest-Generation Curation (`modelCatalog.js`)**:
  - Dynamically syncs active models on startup and automatically selects **Gemini 4 Hydrogen** (`gemini-4-hydrogen`) as the Free Tier default.
  - Keeps only the latest active major generation per model family (automatically excluding legacy/deprecated `1.x`/`2.x` and superseded `3.x` Flash/Pro models once Gemini 4+ is available, and promoting future generations automatically).
  - Filters out non-chat/specialized endpoints (`-tts`, `-audio`, `-live`, `-image`, `-transcribe`, `robotics`, `embedding`, etc.) and models flagged as `LEGACY`, `DEPRECATED`, or `RETIRED`.
- **Free / Paid / Local Model Badges**:
  - Displays `FREE`, `PAID`, or `LOCAL` tags in the overlay model selector (`renderer/overlay.html`), `[Free]` / `[Paid]` / `[Local]` tags in Settings (`renderer/settings.html`), and `[FREE]` / `[PAID]` tags in `verify_key.js`.
- **Multi-Provider Support (`providerClient.js`)**:
  - Added **OpenRouter** (automatically filtering for free/paid vision-capable models) and **Ollama** (local vision/chat models) alongside **Google Gemini**.
  - Encrypted storage for OpenRouter API keys via Electron `safeStorage`, plus per-provider model persistence and quick access from `setup.html`.
- **Settings Key/Connection Tester & Live Apply**:
  - Added a **Test Key / Connection** button and inline status banner in `renderer/settings.html` to verify key validity, generation quota (`429 limit: 0`), OpenRouter auth, or local Ollama status.
  - Model lists and credentials now apply immediately without requiring an app restart.
- **Automated Tests & CI**:
  - Added unit tests (`npm test` using `node --test test/*.test.js`) and `.github/workflows/ci.yml`.

### Changed & Fixed
- **Migrated from `@google/generative-ai` to `@google/genai` (`^3.6.1`)**:
  - Uses header-based authentication (`x-goog-api-key`) to support Google AI Studio's `AQ.` authorization keys as well as legacy `AIza...` keys.
  - Trims whitespace on saved API keys.
- **Friendly Free-Tier & Quota Error Messages**:
  - Surfaces clear guidance prompting users to switch to a **Free** model (such as **Gemini 4 Hydrogen**, **Flash**, or **Gemma 4**) when a paid-only model or `429 limit: 0` quota restriction is hit, and removes runtime `404`/retired models from the active dropdown.
- **macOS Screenshot Capture & Shortcut Reliability (`Cmd+Shift+S` / `Alt+Shift+S`)**:
  - Added a `/usr/sbin/screencapture` fallback on macOS when Electron `desktopCapturer` fails (`Failed to get sources.`), capture debouncing for rapid key repeats, and Retina scale-factor sizing.
  - Added `NSScreenCaptureUsageDescription` in `electron-builder.yml`, visible overlay error messages with one-time macOS Screen Recording Settings guidance, a macOS Tray **Screen Recording Permissions** action, and shortcut registration logging.
- **Unified macOS & Windows App Icons**:
  - Regenerated `build/icon.ico` and `assets/icons/win/icon.ico` from the macOS source PNGs with valid 32-bit BGRA + 1-bpp AND-mask entries (`16–128px`) and PNG-encoded `256x256`.
  - Synced `assets/icon.png` to full 32-bit RGBA (`512x512`) and configured Windows `Tray`/`BrowserWindow` and NSIS installer icons cleanly.
- **Native CI Builds (`release.yml` & `release.sh`)**:
  - Updated `.github/workflows/release.yml` to run tests, build Windows `x64` installers natively on `windows-latest`, build both `arm64` and `x64` macOS DMGs on `macos-latest`, and publish a single complete release.
  - Updated `release.sh` to push `main` + tag, wait for CI release assets, and update the Homebrew Cask with per-arch SHA256 checksums.

## [0.6.1-beta] - 2026-08-10
- Implemented initial dynamic Gemini model fetching and auto-fallback.
- Added macOS Gatekeeper `INSTALL_INSTRUCTIONS.txt` to DMG root and Homebrew Cask caveats.
- Fixed Winget package identifier (`YogeshSharma.NullByte`).

## [0.6.0-beta] - 2026-03-26
- Added custom prompt input, UI animations, UX enhancements, and macOS app icon patch.

## [0.5.0-alpha] - 2026-03-09
- Added multi-platform release automation, Homebrew Cask, and Winget publishing support.

## [0.4.0-alpha] - 2026-03-06
- Added macOS build support and desktop packaging configuration.

## [0.3.0-alpha] - 2026-02-27
- UI and screenshot workflow improvements.

## [0.2.0-alpha] - 2026-02-23
- Added multi-platform application icons and Electron Builder setup.

## [0.1.0-alpha] - 2026-02-19
- Initial open-source release of NullByte.
