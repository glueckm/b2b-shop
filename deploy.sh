#!/usr/bin/env bash
#
# Deploy the B2B shop frontend to the mawa server.
# Run from the repo root on the build machine.
#
# The original is in mawav2, deploy/shop-frontend/deploy.sh, next to the unit,
# the vhost and the runbook. This copy is the one that runs, because the script
# resets this clone to origin/main before it builds.
#
# It is the CRM's deploy.sh with five values changed. If you fix something
# here, fix it there too -- there is no shared copy, and two scripts that drift
# is the price of each app owning its own.
#
set -euo pipefail
export PATH="/home/glueck/.local/share/vite-plus/bin:$PATH"
TARGET="mawa-deploy-target"
DEST="/opt/mawa-shop"
SERVICE="mawa-shop"
PUBLIC_URL="https://shop.mawa-trading.at"

echo "==> Updating source"
git diff --quiet || { echo "FAIL: working tree dirty, refusing to reset" >&2; exit 1; }
git fetch --prune origin
git reset --hard origin/main

echo "==> Building"
bun install --frozen-lockfile
rm -rf .output .nitro
# The Lovable vite config defaults nitro to the cloudflare target, which builds
# a worker this machine cannot run. Naming node-server is not optional.
SERVER_PRESET=node-server bun run build

echo "==> Verifying build"
if [ ! -f .output/server/index.mjs ]; then
  echo "FAIL: .output/server/index.mjs missing" >&2
  exit 1
fi
if ! grep -q '"preset": *"node-server"' .output/nitro.json; then
  echo "FAIL: wrong nitro preset — expected node-server, got:" >&2
  grep '"preset"' .output/nitro.json >&2
  exit 1
fi
if [ ! -d .output/public ]; then
  echo "FAIL: .output/public missing — client assets did not build" >&2
  exit 1
fi

echo "==> Recording version"
git rev-parse HEAD > .output/VERSION 2>/dev/null || echo "unknown" > .output/VERSION
git log -1 --pretty=%s >> .output/VERSION 2>/dev/null || true

echo "==> Deploying to $TARGET:$DEST"
rsync -az --delete .output/ "$TARGET:$DEST/.output/"

echo "==> Restarting $SERVICE"
ssh "$TARGET" "sudo systemctl restart $SERVICE"

sleep 3
if ! ssh "$TARGET" "systemctl is-active --quiet $SERVICE"; then
  echo "FAIL: service did not come up. Recent log:" >&2
  ssh "$TARGET" "journalctl -u $SERVICE -n 30 --no-pager" >&2
  exit 1
fi

echo "==> Smoke test"
# The front page rather than a route behind a login: the shop's catalogue is
# public, so a 200 here means the server rendered and reached the database.
# `/` itself answers 307 to the default channel's catalogue, and that redirect
# comes before any query -- so follow it, or the check proves only that node
# started. Unlike the CRM's script, which tests /login, a bare 307 is no pass.
code=$(curl -sL --max-redirs 3 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/")
if [ "$code" != "200" ]; then
  echo "FAIL: $PUBLIC_URL/ returned $code" >&2
  exit 1
fi

echo "==> Deployed $(head -1 .output/VERSION) OK"
