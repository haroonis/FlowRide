#!/usr/bin/env bash
# Installs a release tarball and switches to it with zero manual steps.
# Rolls back automatically if the new version does not answer its health check.
# Usage: sudo deploy.sh /tmp/release.tgz <release-id> <site-domain>
set -euo pipefail
TARBALL="$1"; ID="$2"; DOMAIN="$3"
APP=/opt/flowride
NEW="$APP/releases/$ID"
PREV=$(readlink -f "$APP/current" 2>/dev/null || true)

[ -s /etc/flowride/flowride.env ] || { echo "Missing /etc/flowride/flowride.env"; exit 1; }

echo "==> Unpacking $ID"
rm -rf "$NEW" && mkdir -p "$NEW"
tar -xzf "$TARBALL" -C "$NEW"
if ! (cd "$NEW" && npm install --omit=dev --no-audit --no-fund --loglevel=error); then
  # No prebuilt SQLite driver for this system: install compilers once and build it
  echo "==> Building the SQLite driver from source"
  if command -v dnf >/dev/null; then dnf install -y -q gcc-c++ make python3 >/dev/null; else apt-get install -y -qq g++ make python3 >/dev/null; fi
  (cd "$NEW" && npm install --omit=dev --no-audit --no-fund --loglevel=error --build-from-source)
fi
command -v restorecon >/dev/null && restorecon -R "$NEW" 2>/dev/null || true
chown -R root:root "$NEW" && chmod -R go-w "$NEW"

echo "==> HTTPS config for $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
{
	admin off
}
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
	header -Server
	# No access log: visitors' IP addresses are not recorded.
}
CADDY
chmod 644 /etc/caddy/Caddyfile

switch_to() { ln -sfn "$1" "$APP/current.tmp" && mv -T "$APP/current.tmp" "$APP/current"; systemctl restart flowride; }
healthy() { for _ in $(seq 1 20); do curl -fsS -o /dev/null http://127.0.0.1:3000/api/config && return 0; sleep 1; done; return 1; }

echo "==> Switching to new release"
switch_to "$NEW"
if ! healthy; then
  echo "!! New release failed its health check"
  journalctl -u flowride -n 30 --no-pager || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then echo "==> Rolling back to $(basename "$PREV")"; switch_to "$PREV"; healthy || true; fi
  exit 1
fi
systemctl restart caddy
systemctl start flowride-backup.timer

echo "==> Tidying old releases (keeping 3)"
ls -1dt "$APP"/releases/* | tail -n +4 | xargs -r rm -rf
rm -f "$TARBALL"
echo "Deployed $ID → https://$DOMAIN"
