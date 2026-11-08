#!/usr/bin/env bash
# One-time (and safe to re-run) setup of an Oracle Cloud Always Free VM for FlowRide.
# Works on Ubuntu 22.04/24.04 and Oracle Linux 8/9, on AMD (E2.1.Micro) or Arm (A1) shapes.
# Installs: Node.js 22, Caddy (HTTPS + compression), a locked-down systemd service, daily backups.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.4}"
CADDY_VERSION="${CADDY_VERSION:-2.10.0}"
APP=/opt/flowride
DATA=/var/lib/flowride

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)"; exit 1; }
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64; CADDY_ARCH=amd64 ;;
  aarch64) NODE_ARCH=arm64; CADDY_ARCH=arm64 ;;
  *) echo "Unsupported CPU $(uname -m)"; exit 1 ;;
esac

echo "==> Swap (the 1 GB Micro VM needs it for npm installs)"
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Node.js $NODE_VERSION"
if ! /opt/node/bin/node --version 2>/dev/null | grep -q "v$NODE_VERSION"; then
  tmp=$(mktemp -d)
  base="https://nodejs.org/dist/v$NODE_VERSION"
  file="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  curl -fsSL "$base/SHASUMS256.txt" | grep " $file\$" | (cd "$tmp" && sha256sum -c -)
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf "$tmp/$file" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node; ln -sf /opt/node/bin/npm /usr/local/bin/npm
  rm -rf "$tmp"
fi

echo "==> Caddy $CADDY_VERSION"
if ! /usr/local/bin/caddy version 2>/dev/null | grep -q "v$CADDY_VERSION"; then
  tmp=$(mktemp -d)
  file="caddy_${CADDY_VERSION}_linux_${CADDY_ARCH}.tar.gz"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION/$file" -o "$tmp/$file"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION/caddy_${CADDY_VERSION}_checksums.txt" | grep " $file\$" | (cd "$tmp" && sha512sum -c -)
  tar -xzf "$tmp/$file" -C "$tmp" caddy && install -m 755 "$tmp/caddy" /usr/local/bin/caddy
  rm -rf "$tmp"
fi

echo "==> Users and folders"
id flowride >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin flowride
id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy
install -d -m 755 "$APP" "$APP/releases"
install -d -m 700 -o flowride -g flowride "$DATA" "$DATA/backups"
install -d -m 700 /etc/flowride
install -d -m 755 /etc/caddy
install -d -m 700 -o caddy -g caddy /var/lib/caddy

echo "==> Firewall: allow HTTP and HTTPS"
if command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then   # Oracle Linux
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null && firewall-cmd --reload >/dev/null
elif command -v iptables >/dev/null; then                                              # Ubuntu images on OCI
  # OCI's Ubuntu images end the INPUT chain with a REJECT rule; open 80/443 just above it.
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null && continue
    pos=$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT" {print $1; exit}')
    if [ -n "$pos" ]; then iptables -I INPUT "$pos" -p tcp --dport $p -m state --state NEW -j ACCEPT
    else iptables -A INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT; fi
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
fi

echo "==> Services"
cat > /etc/systemd/system/flowride.service <<'UNIT'
[Unit]
Description=FlowRide
After=network-online.target
Wants=network-online.target

[Service]
User=flowride
Group=flowride
WorkingDirectory=/opt/flowride/current
EnvironmentFile=/etc/flowride/flowride.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=3000 DB_PATH=/var/lib/flowride/flowride.db TRUST_PROXY=loopback
ExecStart=/usr/local/bin/node --max-old-space-size=128 server.mjs
Restart=always
RestartSec=3
# Keep it small and sandboxed
MemoryMax=256M
CPUWeight=100
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths=/var/lib/flowride
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy (HTTPS for FlowRide)
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/caddy
MemoryMax=128M
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/flowride-backup.service <<'UNIT'
[Unit]
Description=FlowRide database backup (kept 7 days)

[Service]
Type=oneshot
User=flowride
WorkingDirectory=/opt/flowride/current
ExecStart=/usr/local/bin/node deploy/backup.mjs /var/lib/flowride/flowride.db /var/lib/flowride/backups 7
UNIT

cat > /etc/systemd/system/flowride-backup.timer <<'UNIT'
[Unit]
Description=Daily FlowRide backup

[Timer]
OnCalendar=*-*-* 03:17:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --quiet flowride caddy flowride-backup.timer
echo "Server setup complete."
