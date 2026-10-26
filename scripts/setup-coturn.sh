#!/usr/bin/env bash
# Installs and configures coturn (our own STUN/TURN server for video calls) on the app server.
# Safe to run again: keeps an existing secret, rewrites the config, restarts the service.
#
#   sudo bash scripts/setup-coturn.sh [turn-host] [public-ip]
#
# The shared secret is written to /etc/turnserver.conf and to the app's .env as TURN_SECRET
# (never printed). The app hands out short-lived logins made from it (lib/video-calls/logic.ts).
# Ports to allow if a firewall is in front: 3478 UDP+TCP, and UDP 49160-49200 for relayed media.
set -euo pipefail

APP_DIR="${APP_DIR:-/root/apps/trimpro}"
TURN_HOST="${1:-app.trimprony.com}"
PUBLIC_IP="${2:-$(curl -fsS -4 https://api.ipify.org || hostname -I | awk '{print $1}')}"
ENV_FILE="$APP_DIR/.env"

if ! command -v turnserver >/dev/null 2>&1; then
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
fi

SECRET="$(grep -E '^TURN_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [ -z "$SECRET" ]; then
  SECRET="$(openssl rand -hex 32)"
fi

umask 077
cat > /etc/turnserver.conf <<EOF
# Managed by scripts/setup-coturn.sh
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$SECRET
realm=$TURN_HOST
external-ip=$PUBLIC_IP
min-port=49160
max-port=49200
total-quota=200
stale-nonce=600
no-multicast-peers
no-tcp-relay
no-cli
no-tlsv1
no-tlsv1_1
# Never relay into private / local networks (protects services on this box).
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
syslog
simple-log
EOF
chown root:turnserver /etc/turnserver.conf 2>/dev/null || true
chmod 640 /etc/turnserver.conf

if [ -f /etc/default/coturn ]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi

# App settings (replace existing lines, keep everything else in .env).
touch "$ENV_FILE"
sed -i -E '/^(TURN_HOST|TURN_SECRET|TURN_PORT)=/d' "$ENV_FILE"
{
  echo "TURN_HOST=$TURN_HOST"
  echo "TURN_PORT=3478"
  echo "TURN_SECRET=$SECRET"
} >> "$ENV_FILE"

systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 1
systemctl is-active coturn
ss -lnup | grep -q ':3478 ' && echo "coturn listening on 3478/udp" || { echo "coturn is not listening"; exit 1; }
echo "TURN ready for $TURN_HOST ($PUBLIC_IP). Restart the app so it picks up TURN_* from .env."
