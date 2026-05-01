#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Install from nodejs.org"
  exit 1
fi
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi
if [ ! -f ".env" ]; then
  echo "No .env file found. Creating from example..."
  cp .env.example .env
  echo "Please edit .env and add your AI_GATEWAY_KEY, then run again."
  open .env
  exit 1
fi
echo "Starting AZ Claude Chat..."
npm start &
sleep 2
open http://localhost:3737
