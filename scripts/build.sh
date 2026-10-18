#!/usr/bin/env bash
# Cloudflare Pages build: copy the public website into dist/.
#
# Pages settings (Workers & Pages > project > Settings > Build):
#   Build command:          bash scripts/build.sh
#   Build output directory: dist
#
# Only what is listed here is published, so repo tooling (.github/, scripts/,
# README, .DS_Store) never ends up on the live site. Add a line when you add a
# new top-level file or folder the site needs.
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist

cp ./*.html ./*.css ./*.js favicon.ico dist/
cp -R img print dist/

# Pages config files, if present
for f in _headers _redirects; do
  [ -f "$f" ] && cp "$f" dist/
done

# macOS clutter that may have been committed inside folders
find dist -name '.DS_Store' -delete

echo "Built dist/ with $(find dist -type f | wc -l) files"
