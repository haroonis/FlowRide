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

echo "==> Swap (the 1 GB Micro VM needs it before any package installs)"
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Base packages and automatic security updates"
if command -v dnf >/dev/null; then                 # Oracle Linux 8/9
  # tar/xz/curl are needed now; on Oracle Linux images they're normally already there.
  need=""; for p in tar xz curl; do command -v $p >/dev/null || need="$need $p"; done
  if [ -n "$need" ]; then
    echo "    installing:$need"
    # shellcheck disable=SC2086
    timeout 900 dnf install -y --setopt=install_weak_deps=False $need
  fi
  # Automatic security updates (Cyber Essentials: patch within 14 days). dnf is slow on the
  # 1 GB VM, so install it in the background instead of holding up the deploy.
  if rpm -q dnf-automatic >/dev/null 2>&1; then
    [ -f /etc/dnf/automatic.conf ] && sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf
    systemctl enable --now dnf-automatic.timer >/dev/null 2>&1 || true
    echo "    automatic security updates: on"
  elif ! systemctl is-active --quiet flowride-dnf-automatic 2>/dev/null; then
    # Only the BaseOS repo (much smaller metadata than all repos) and a hard memory cap,
    # so it can never push the website out of memory on the 1 GB VM.
    baseos=$(grep -ho '^\[ol[0-9]*_baseos_latest\]' /etc/yum.repos.d/*.repo 2>/dev/null | tr -d '[]' | head -1)
    systemd-run --unit=flowride-dnf-automatic --description="Install dnf-automatic" --nice=15 \
      -p MemoryMax=400M -p MemorySwapMax=600M \
      sh -c "dnf install -y --setopt=install_weak_deps=False ${baseos:+--disablerepo=* --enablerepo=$baseos} dnf-automatic && sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf && systemctl enable --now dnf-automatic.timer" >/dev/null 2>&1 || true
    echo "    automatic security updates: installing in the background"
  fi
elif command -v apt-get >/dev/null; then          # Ubuntu (unattended-upgrades is on by default)
  command -v xz >/dev/null || { apt-get update -qq && apt-get install -y -qq xz-utils >/dev/null; }
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
id flowride >/dev/null 2>&1 || useradd --system --home "$DATA" --shell "$(command -v nologin || echo /sbin/nologin)" flowride
id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell "$(command -v nologin || echo /sbin/nologin)" caddy
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

if command -v restorecon >/dev/null && command -v getenforce >/dev/null && [ "$(getenforce)" != Disabled ]; then
  # SELinux (Oracle Linux): give the new binaries and folders their standard labels
  restorecon -R /usr/local/bin /opt/node /opt/flowride /var/lib/flowride /var/lib/caddy /etc/caddy 2>/dev/null || true
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
