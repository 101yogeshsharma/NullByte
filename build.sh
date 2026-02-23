#!/bin/bash

# NullByte Build Script (Bash)
# Usage: ./build.sh
# Can be run from Git Bash, WSL, or similar on Windows.

echo "============================"
echo "   NullByte Build Tool   "
echo "============================"
echo ""

# 2. Dependency Check & Install
echo "[1/2] Preparing Build Environment..."
if ! command -v npm &> /dev/null; then
    echo "Error: NPM is not installed. Please install Node.js."
    exit 1
fi

npm install

echo ""
echo "[2/2] Building Windows Executable (.exe)..."

# Set environment variables to prevent common build errors
export CSC_IDENTITY_AUTO_DISCOVERY=false

# Attempt clean build
rm -rf dist

# Run build
npm run build -- --config electron-builder.yml --win nsis

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "SUCCESS! Build complete."
    echo "Installer is located in the 'dist' folder."
    echo "=========================================="
else
    echo ""
    echo "Build Failed."
    echo "If you see 'privilege not held' errors, try running this terminal as Administrator."
    exit 1
fi
