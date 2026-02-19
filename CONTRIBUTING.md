# Contributing to NullByte

First off, thank you for considering contributing! 🎉 Every contribution — whether it's a bug report, a feature idea, or a code change — helps make NullByte better for everyone.

## 📜 Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## 🚀 How Can I Contribute?

### 1. Report Bugs

Found a bug? Please [open an issue](https://github.com/101yogeshsharma/NullByte/issues/new?template=bug_report.yml) using the **Bug Report** template. Include:

- A clear description of the problem
- Steps to reproduce the issue
- Your OS, Node.js version, and how you installed/run NullByte
- Screenshots or logs if possible (logs are at `%APPDATA%/NullByte/logs/app.log`)

### 2. Suggest Features

Have an idea? [Open a feature request](https://github.com/101yogeshsharma/NullByte/issues/new?template=feature_request.yml) using the **Feature Request** template. We welcome all suggestions!

### 3. Submit Code Changes

Ready to write code? Here's the workflow:

#### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Git](https://git-scm.com/)
- A text editor / IDE (VS Code recommended)

#### Setup

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/NullByte.git
cd NullByte

# 2. Add the upstream remote
git remote add upstream https://github.com/101yogeshsharma/NullByte.git

# 3. Install dependencies
npm install

# 4. Run in development mode
npm run start
```

#### Making Changes

```bash
# 1. Create a feature branch from main
git checkout -b feature/your-feature-name

# 2. Make your changes and test them
npm run start

# 3. Commit with a descriptive message
git commit -m "Add: description of your change"

# 4. Push to your fork
git push origin feature/your-feature-name
```

Then open a **Pull Request** on GitHub against the `main` branch.

#### Commit Message Convention

We use a simple prefix convention for commit messages:

| Prefix | Usage |
|---|---|
| `Add:` | New feature or file |
| `Fix:` | Bug fix |
| `Update:` | Changes to existing functionality |
| `Remove:` | Removing code or files |
| `Refactor:` | Code restructuring (no behavior change) |
| `Docs:` | Documentation only changes |
| `Style:` | Formatting, whitespace (no logic change) |

**Examples:**
```
Add: global shortcut for model selection
Fix: NullByte not appearing after screenshot
Update: Gemini prompt for better code output
Docs: add troubleshooting section to README
```

### 4. Improve Documentation

Documentation improvements are always welcome! This includes:

- Fixing typos or unclear wording in the README
- Adding examples or guides
- Improving inline code comments

## 🏗️ Project Structure

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

## ✅ Pull Request Guidelines

Before submitting a PR, make sure:

1. **Your branch is up to date** with `main`:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```
2. **The app runs without errors** in development mode (`npm run start`).
3. **Your code doesn't break the production build** (`npm run build`).
4. **You've tested your changes** on Windows (primary platform).
5. **The PR description** clearly explains what the change does and why.
6. **You've linked any related issues** using `Closes #123` syntax.

## 💡 Areas Where We Need Help

- 🐛 Bug fixes and stability improvements
- 🎨 UI/UX enhancements
- 🌐 Multi-platform support (macOS and Linux)
- ✨ New AI model integrations
- 📝 Documentation and guides
- 🧪 Testing and edge case coverage
- ♿ Accessibility improvements

## ❓ Questions?

If you have questions about contributing, feel free to:

- Open a [GitHub Discussion](https://github.com/101yogeshsharma/NullByte/discussions)
- Comment on the relevant issue

Thank you for helping make NullByte better! 🙌
