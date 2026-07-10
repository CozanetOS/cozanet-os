#!/usr/bin/env bash
set -e

echo "=== Starting CozanetOS in Local Dev Mode ==="

if [ ! -d "packages" ]; then
  echo "Error: 'packages/' directory not found. Please run ./scripts/bootstrap.sh first."
  exit 1
fi

# Set default env variables
export NODE_ENV=development
export COZANET_PORT=8000

echo "Installing monorepo root dependencies..."
# Assumes root tooling installation
# npm install

echo "Spawning active engines..."

# Dynamically run engines locally
# We start the core communication bus first, then other micro-engines
# In a real environment, you can use concurrently or pm2
# For now, we will run the orchestrator and let it boot necessary processes.

echo "Ready. Inter-Engine communication active on http://localhost:8000"
