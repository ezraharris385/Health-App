#!/bin/bash
# macOS: double-click this file to start the Health app.
# (If macOS blocks it the first time: right-click the file and choose "Open".)
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed yet."
  echo "Install it from https://nodejs.org (big green button, then Next-Next-Finish),"
  echo "then double-click this file again."
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -f .env ]; then
  echo "One-time setup: the AI assistants need an Anthropic API key."
  echo "(Get one at https://platform.claude.com — or press Enter to skip for now;"
  echo "everything except the AI chats works without it.)"
  read -r -p "Paste your API key: " KEY
  echo "ANTHROPIC_API_KEY=$KEY" > .env
fi

if [ ! -d node_modules ]; then
  echo "First run: downloading the app's components (a few minutes)..."
  npm install || { read -r -p "Install failed — press Enter to close."; exit 1; }
fi

if [ ! -d client/dist ]; then
  echo "First run: building the app..."
  npm run build || { read -r -p "Build failed — press Enter to close."; exit 1; }
fi

echo
echo "================================================================"
echo "  Starting the Health app. LEAVE THIS WINDOW OPEN while using it."
echo "  On your phone (same Wi-Fi), open the 'on your phone' address"
echo "  shown below, then use Share -> Add to Home Screen."
echo "================================================================"
echo
npm start
read -r -p "Server stopped. Press Enter to close."
