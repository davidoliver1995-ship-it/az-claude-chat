#!/bin/bash
# Domino Data Lab startup script for AZ Claude Chat

set -e

# Install Node.js if not available
if ! command -v npm &> /dev/null; then
  echo "Node.js not found — installing via nvm..."
  export NVM_DIR="$HOME/.nvm"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  echo "Node.js installed: $(node -v)"
fi

echo "Installing dependencies..."
npm install

echo "Starting AZ Claude Chat server..."
exec node server.js
