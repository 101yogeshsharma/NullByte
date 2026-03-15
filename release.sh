#!/bin/bash

# Exit on error
set -e

if [ -z "$1" ]; then
  echo "Error: Version argument required."
  echo "Usage: ./release.sh <version> (e.g., ./release.sh 0.5.0-alpha)"
  exit 1
fi

VERSION=$1
# Remove 'v' prefix if user provided it
VERSION=${VERSION#v}

echo "==================================="
echo "🚀 Releasing NullByte v$VERSION"
echo "==================================="

# 1. Bump version in package.json (using sed or npm integration)
# A simple Node script to update package.json version
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 4));
"
echo "✅ Updated package.json version"

# 2. Build Mac & Win
echo "⏳ Building binaries (this may take a minute)..."
npm run build:mac
npm run build:win
echo "✅ Builds complete"

# 3. Commit codebase
git add package.json
git commit -m "chore: release v$VERSION" || true
git push origin main
echo "✅ Pushed codebase"

# 4. Create GitHub Release
echo "⏳ Creating GitHub release..."
DMG_FILE="dist/NullByte-${VERSION}-arm64.dmg"
EXE_FILE="dist/NullByte-Setup-${VERSION}.exe"
gh release create "v$VERSION" "$EXE_FILE" "$DMG_FILE" --title "v$VERSION" --notes "Release v$VERSION"
echo "✅ GitHub Release created"

# 5. Get SHA256 of the published DMG
echo "⏳ Calculating DMG SHA256..."
# Download directly from GH, or just calculate locally!
# We can just hash the local file since we just built it!
SHA256=$(shasum -a 256 "$DMG_FILE" | awk '{ print $1 }')
echo "✅ SHA256: $SHA256"

# 6. Update Homebrew Tap
echo "⏳ Updating Homebrew Tap..."
TAP_DIR="/tmp/homebrew-nullbyte-auto"
rm -rf "$TAP_DIR"
git clone https://github.com/101yogeshsharma/homebrew-nullbyte.git "$TAP_DIR"

cd "$TAP_DIR"
CASK_FILE="Casks/nullbyte.rb"

# Create architecture-aware Cask
cat <<EOF > "$CASK_FILE"
cask "nullbyte" do
  arch arm: "arm64", intel: "x64"

  version "$VERSION"
  sha256 "$SHA256"

  url "https://github.com/101yogeshsharma/NullByte/releases/download/v#{version}/NullByte-#{version}-#{arch}.dmg"
  name "NullByte"
  desc "AI Coding Assistant powered by Gemini"
  homepage "https://github.com/101yogeshsharma/NullByte"

  app "NullByte.app"

  zap trash: [
    "~/Library/Application Support/NullByte",
    "~/Library/Preferences/com.nullbyte.app.plist",
    "~/Library/Saved Application State/com.nullbyte.app.savedState",
  ]
end
EOF

git add "$CASK_FILE"
git commit -m "bump nullbyte to v$VERSION (arch-aware)"
git push origin main
cd - > /dev/null

echo "✅ Homebrew Tap updated!"
echo "🎉 Release fully automated and complete! Users can now 'brew upgrade nullbyte' or install the new version immediately."
