#!/bin/bash

# Exit on error
set -e

if [ -z "$1" ]; then
  echo "Error: Version argument required."
  echo "Usage: ./release.sh <version> (e.g., ./release.sh 0.7.0-beta)"
  exit 1
fi

VERSION=$1
VERSION=${VERSION#v}
TAG="v$VERSION"

echo "==================================="
echo "🚀 Releasing NullByte $TAG"
echo "==================================="

# 1. Run tests before bumping
echo "⏳ Running unit tests..."
npm test
echo "✅ Tests passed"

# 2. Bump version in package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 4) + '\n');
"
echo "✅ Updated package.json version to $VERSION"

# 3. Commit, tag, and push (CI builds Windows x64 .exe + macOS arm64/x64 .dmg natively)
git add package.json
git commit -m "chore: release $TAG" || true
git tag -f "$TAG"
git push origin main
git push origin "$TAG" --force
echo "✅ Pushed codebase and tag $TAG (GitHub Actions will build Windows + macOS installers)"

# 4. Wait for release workflow & GitHub Release to appear
echo "⏳ Waiting for GitHub Actions release build to finish..."
sleep 5
RUN_ID=$(gh run list --workflow release.yml --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -n "$RUN_ID" ]; then
  gh run watch "$RUN_ID" --exit-status
else
  echo "⚠️ Could not auto-detect workflow run; waiting for GitHub Release $TAG..."
  until gh release view "$TAG" >/dev/null 2>&1; do sleep 10; done
fi
echo "✅ GitHub Release $TAG published!"

# 5. Calculate SHA256 for both arm64 and x64 DMGs from the published release
echo "⏳ Fetching DMG checksums..."
TMP_DMG_DIR="/tmp/nullbyte-release-$VERSION"
rm -rf "$TMP_DMG_DIR"
mkdir -p "$TMP_DMG_DIR"
gh release download "$TAG" --pattern "*.dmg" --dir "$TMP_DMG_DIR"

ARM_DMG="$TMP_DMG_DIR/NullByte-${VERSION}-arm64.dmg"
X64_DMG="$TMP_DMG_DIR/NullByte-${VERSION}-x64.dmg"
SHA256_ARM=$(shasum -a 256 "$ARM_DMG" | awk '{ print $1 }')
SHA256_X64=$(shasum -a 256 "$X64_DMG" | awk '{ print $1 }')
rm -rf "$TMP_DMG_DIR"

echo "✅ arm64 SHA256: $SHA256_ARM"
echo "✅ x64   SHA256: $SHA256_X64"

# 6. Update Homebrew Tap
echo "⏳ Updating Homebrew Tap..."
TAP_DIR="/tmp/homebrew-nullbyte-auto"
rm -rf "$TAP_DIR"
git clone https://github.com/101yogeshsharma/homebrew-nullbyte.git "$TAP_DIR"

cd "$TAP_DIR"
CASK_FILE="Casks/nullbyte.rb"

cat <<EOF > "$CASK_FILE"
cask "nullbyte" do
  arch arm: "arm64", intel: "x64"

  version "$VERSION"
  sha256 arm:   "$SHA256_ARM",
         intel: "$SHA256_X64"

  url "https://github.com/101yogeshsharma/NullByte/releases/download/v#{version}/NullByte-#{version}-#{arch}.dmg"
  name "NullByte"
  desc "AI Coding Assistant powered by Gemini"
  homepage "https://github.com/101yogeshsharma/NullByte"

  app "NullByte.app"

  caveats do
    unsigned_accessibility
    <<~EOS
      macOS Gatekeeper may flag this application as damaged or unverified because it is not code-signed.
      To bypass this and run the application, open your terminal and run:
        sudo xattr -cr /Applications/NullByte.app
      
      Alternatively, right-click (Control-click) the application in your Applications folder and select "Open".
    EOS
  end

  zap trash: [
    "~/Library/Application Support/NullByte",
    "~/Library/Preferences/com.nullbyte.app.plist",
    "~/Library/Saved Application State/com.nullbyte.app.savedState",
  ]
end
EOF

git add "$CASK_FILE"
git commit -m "bump nullbyte to $TAG (arch-aware)"
git push origin main
cd - > /dev/null
rm -rf "$TAP_DIR"

echo "✅ Homebrew Tap updated!"
echo "🎉 Release $TAG complete! Both macOS and Windows packages are live."
