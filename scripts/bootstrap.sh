#!/usr/bin/env bash
set -e

echo "=== CozanetOS Monorepo Bootstrapper ==="
mkdir -p packages
cd packages

REPOS=(
  "cozanet-core"
  "cozanet-ceo"
  "cozanet-comms"
  "cozanet-memory"
  "cozanet-security"
  "cozanet-groq"
  "cozanet-plugins"
  "cozanet-agent"
  "cozanet-perception"
  "cozanet-action"
  "cozanet-ui"
  "cozanet-cli"
  "cozanet-db"
  "cozanet-analytics"
  "cozanet-auth"
  "cozanet-registry"
)

for REPO in "${REPOS[@]}"; do
  if [ -d "$REPO" ]; then
    echo " -> $REPO already exists, skipping clone. Pulling latest changes..."
    cd "$REPO" && git pull && cd ..
  else
    echo " -> Cloning $REPO from CozanetOS..."
    git clone "https://github.com/CozanetOS/${REPO}.git"
  fi
done

echo "=== All repositories successfully bootstrapped! ==="
