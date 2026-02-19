# NullByte — AI Coding Assistant

NullByte is a lightweight Electron-based desktop tool that gives you instant access to Google's Gemini AI while you code. It sits on top of your IDE, browser, or terminal as a non-intrusive floating panel — perfect for quick code explanations, debugging help, and on-the-fly learning.

> **⚠️ Disclaimer:** NullByte is designed as a **personal productivity and learning tool**. It is **not** intended for use during interviews, exams, proctored assessments, or any scenario where external assistance is prohibited. Please use this tool ethically and responsibly.

## ✨ Features

- **Always-On-Top Panel** — A floating panel that stays visible over your IDE, browser, or any other application so you can reference AI-generated solutions without switching windows.
- **Click-Through Mode** — The panel doesn't interfere with your workflow; mouse events pass through to the application underneath.
- **Global Hotkeys** — Control everything via keyboard shortcuts without leaving your current app.
- **Gemini AI Integration** — Leverages Google's latest multimodal AI models for intelligent code analysis and solutions.
- **Screenshot & Solve** — Capture a portion of your screen (error messages, code snippets, UI bugs) and let AI analyze it instantly.
- **Secure API Key Storage** — Your Gemini API key is stored with encryption on your local machine.

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed on your machine:

| Tool | Version | Download |
|---|---|---|
| **Node.js** | v18 or higher | [nodejs.org](https://nodejs.org/) |
| **NPM** | Comes with Node.js | — |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com/) |

### 1. Clone the Repository

```bash
git clone https://github.com/101yogeshsharma/NullByte.git
cd NullByte
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Get a Gemini API Key

NullByte uses Google's Gemini AI under the hood. You'll need a free API key:

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click **"Get API Key"** → **"Create API Key"**.
4. Copy the key — you'll paste it into NullByte when you first launch it.

### 4. Run in Development Mode

```bash
npm run start
```

This launches NullByte directly. You can also use:

```bash
npm run dev
```

### 5. Build for Production (Windows `.exe`)

To create a standalone installer that you can share or install on any Windows machine:

```bash
npm run build
```

The output installer (`NullByte.exe`) will be in the `dist/` folder.

> **💡 Tip for Git Bash / WSL users:** You can also use the included build script:
> ```bash
> chmod +x build.sh
> ./build.sh
> ```
> It handles dependency checks, cleans previous builds, and creates the `.exe` in one step.

## 📁 Project Structure

```
NullByte/
├── main.js                 # Electron main process — window creation, hotkeys, AI logic
├── preload.js              # Preload script — bridges main ↔ renderer securely
├── renderer/               # Frontend UI files
│   └── overlay.html        # The overlay's HTML, CSS, and client-side JS
├── assets/
│   └── icon.png            # App icon (512×512)
├── build/
│   └── installer.nsh       # NSIS installer customization script
├── verify_key.js           # Gemini API key validation utility
├── electron-builder.yml    # Electron Builder configuration
├── package.json            # Project metadata and scripts
└── build.sh                # Bash build helper script
```

## 🎮 Usage

1. **Launch** NullByte.
2. **Enter your API Key** — Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/) and paste it when prompted.
3. **Use keyboard shortcuts** to interact with NullByte:

| Shortcut | Action |
|---|---|
| `Ctrl + Shift + S` | Capture a screenshot (adds to queue) |
| `Ctrl + Shift + G` / `Ctrl + Shift + Enter` | Solve with AI |
| `Ctrl + Shift + D` | Solve (alternative shortcut) |
| `Ctrl + Shift + Q` | Toggle NullByte visibility |
| `Ctrl + Shift + X` | Clear screenshot queue |
| `Ctrl + Shift + M` | Toggle AI model selection |
| `Ctrl + Shift + Arrow Keys` | Scroll through the solution |

4. **Workflow**: Capture a screenshot of a coding problem or error → press Solve → read the AI-generated explanation and solution right in NullByte.

## 🔧 Technical Details

- **Always-On-Top Window** — Built as an Electron `BrowserWindow` with `alwaysOnTop` enabled, using a frameless, transparent design for minimal visual footprint.
- **Click-Through** — Uses Electron's `setIgnoreMouseEvents` API so the tool doesn't block interaction with underlying apps.
- **Compact UI** — Uses a toolbar-style window to keep the interface minimal and out of the way.
- **Self-Hiding Capture** — NullByte temporarily hides before taking screenshots to ensure clean captures of the content beneath it.

## 🎨 Customization

- **Icon** — Replace `assets/icon.png` with your own 512×512 PNG.
- **Theme** — Edit the styles in `renderer/overlay.html` to customize colors, fonts, and layout.

## ❓ Troubleshooting

| Problem | Solution |
|---|---|
| `npm install` fails | Make sure you have Node.js v18+ installed. Run `node -v` to check. |
| NullByte doesn't appear | Press `Ctrl + Shift + Q` to toggle visibility. Check if the app is running in the system tray. |
| "Invalid API Key" error | Double-check your Gemini API key at [Google AI Studio](https://aistudio.google.com/). Make sure there are no extra spaces. |
| Build fails with privilege errors | Run your terminal as **Administrator** and try again. |
| Screenshots are blank | Make sure you're not running the app in a virtual machine, as some VMs restrict screen capture APIs. |

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** this repository.
2. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** and commit them:
   ```bash
   git commit -m "Add: your feature description"
   ```
4. **Push** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
5. **Open a Pull Request** against the `main` branch of this repository.

### Ideas for Contributions
- 🐛 Bug fixes and stability improvements
- 🎨 UI/UX enhancements
- 🌐 Multi-platform support (macOS, Linux)
- 📝 Documentation improvements
- ✨ New AI model integrations

## 📄 License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

