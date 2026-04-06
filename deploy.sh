#!/bin/bash
set -e

echo "Building..."
npm run build

echo "Copying static assets, public, env, and drizzle migrations to standalone..."
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
cp .env.local .next/standalone/.env.local
cp -r drizzle .next/standalone/drizzle

echo "Done. Restart the server with:"
echo "  node .next/standalone/server.js"
