#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "🔍 Verifying DNS flow → macOS → Pi-hole → Unbound → Cloudflared"
echo "──────────────────────────────────────────────────────────────"

VM_IP="192.168.66.2"
UNBOUND_PORT="5335"
PIHOLE_PORT="53"

run_test() {
  local name="$1"
  local cmd="$2"
  echo -n "🧪 $name... "
  if output=$(eval "$cmd" 2>/dev/null); then
    echo "✅"
    echo "$output" | sed 's/^/   /'
  else
    echo "❌"
    return 1
  fi
}

# 1. macOS → Pi-hole
run_test "macOS → Pi-hole (basic query)" \
  "dig example.com @$VM_IP -p $PIHOLE_PORT +short"

# 2. macOS → Pi-hole → Unbound with DNSSEC
run_test "macOS → Unbound (DNSSEC check)" \
  "dig +dnssec example.com @$VM_IP -p $PIHOLE_PORT"

# 3. macOS → Unbound direct (bypass Pi-hole)
run_test "Direct to Unbound (5335 bypass test)" \
  "dig example.com @$VM_IP -p $UNBOUND_PORT +short"

# 4. DNSSEC failure domain → should SERVFAIL
echo -n "🧪 DNSSEC validation (dnssec-failed.org)... "
if dig +dnssec dnssec-failed.org @$VM_IP -p $UNBOUND_PORT | grep -q 'SERVFAIL'; then
  echo "✅ SERVFAIL as expected"
else
  echo "❌ Unexpected result"
fi

# 5. Summary IP map
echo ""
echo "🔗 IP Mapping:"
for cid in $(docker ps -q); do
  docker inspect -f '{{.Name}} → {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$cid"
done | sed 's/^/   /'
