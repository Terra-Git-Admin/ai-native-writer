#!/bin/bash
set -e

echo "Building..."
npm run build

echo "Copying static assets, public, and env to standalone..."
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
cp .env.local .next/standalone/.env.local

echo "Done. Restart the server with:"
echo "  node .next/standalone/server.js"
