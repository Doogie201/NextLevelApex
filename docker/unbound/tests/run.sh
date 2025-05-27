#!/usr/bin/env bash
#
# End-to-end + stress test for cloudflared → unbound → Pi-hole
# Run from *host* shell:  ./tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."          # jump to project root

### ────────────────────────────── helpers ──────────────────────────────
red=$'\e[31m'; green=$'\e[32m'; yellow=$'\e[33m'; nc=$'\e[0m'
pass() {  printf "%b✔ %s%b\n" "$green" "$1" "$nc" ; }
fail() {  printf "%b✘ %s%b\n" "$red"   "$1" "$nc" ; exit 1 ;}
note() {  printf "%b➜ %s%b\n" "$yellow" "$1" "$nc" ; }

need() { command -v "$1" &>/dev/null || fail "$1 is required but not in PATH"; }

### ─────────────────────── 0. Pre-flight (Colima running?) ─────────────
colima status &>/dev/null || fail "Colima is not running"

VM_IP=$(colima status | grep -Eo '([0-9]{1,3}.){3}[0-9]{1,3}' | head -n1)
[ -n "$VM_IP" ] || fail "Could not read Colima address"

note "Colima VM IP → $VM_IP"
CONTAINERS=(cloudflared unbound pihole)
for c in "${CONTAINERS[@]}"; do
  docker inspect -f '{{ .State.Health.Status }}' "$c" 2>/dev/null | \
    grep -q healthy || fail "Container $c is not healthy"
done
pass "All three containers report healthy"

### ─────────────────────── 1. Smoke-tests (functional) ────────────────
# a) Direct to Cloudflare DoH proxy
dig @"$VM_IP" -p5053 cloudflare.com +short | grep -Eq '(^1\.1\.1\.1|^104\.)' \
  && pass "cloudflared returns real answers" \
  || fail "cloudflared did not answer"

# b) Direct to Unbound (validating resolver)
dig @"$VM_IP" -p5335 dnssec-failed.org +dnssec +auth +noall +answer \
  | grep -q 'SERVFAIL' && pass "Unbound DNSSEC validation works" \
  || fail "Unbound DNSSEC test failed (should SERVFAIL dnssec-failed.org)"

# c) Through the full Pi-hole chain
dig @"$VM_IP" google.com +short | grep -E '^[0-9.]+$' \
  && pass "Pi-hole answers via 53/UDP" \
  || fail "Pi-hole did not answer on port 53"

### ─────────────────────── 2. Cache-effect check  ─────────────────────
t1=$(dig @"$VM_IP" google.com +stats |& awk '/Query time/ {print $4}')
sleep 1
t2=$(dig @"$VM_IP" google.com +stats |& awk '/Query time/ {print $4}')
(( t2 < t1 )) && pass "Second query hit cache (${t1} ms → ${t2} ms)" \
               || fail "Cache seems ineffective (time did not drop)"

### ─────────────────────── 3. Stress test with dnsperf ────────────────
need docker
[[ -f tests/domains.txt ]] || curl -sSL \
  https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/DNS/clean-junk-10k.txt \
  -o tests/domains.txt

note "Pulling lightweight dnsperf image (first time only)…"
docker pull ghcr.io/looterz/dnsperf:latest &>/dev/null

note "Running 60-second load → 5 000 QPS, 100 parallel clients"
docker run --rm --network host ghcr.io/looterz/dnsperf \
       -s "$VM_IP" -p 53           \
       -d /clean-junk-10k.txt      \
       -l 60 -Q 5000 -c 100 > tests/dnsperf.out 2>&1 || true

QPS=$(awk '/Queries\/second:/ {print int($3)}' tests/dnsperf.out)
RC="$(grep 'Run completed' -c tests/dnsperf.out)"
[[ "$RC" -eq 1 && "$QPS" -ge 2000 ]] \
  && pass "Stress: sustained ${QPS} QPS without errors" \
  || fail  "Stress test failed – see tests/dnsperf.out"

### ─────────────────────── 4. Persistence / restart  ──────────────────
note "Restarting Colima VM… (takes ~15 s)"
colima stop -f >/dev/null
colima start >/dev/null
sleep 5   # let Docker start inside VM
VM_IP2=$(colima status | awk '/address:/ {print $2}')
[ "$VM_IP2" == "$VM_IP" ] || note "IP changed → $VM_IP2"
dig @"$VM_IP2" google.com +short | grep -q '^[0-9.]' \
  && pass "Pi-hole survived full Colima restart" \
  || fail "Pi-hole unreachable after restart"

### ─────────────────────── 5. High-TTL / UDP fragmentation ────────────
dig @"$VM_IP2" +bufsize=4096 +dnssec . soa | grep -q 'SOA' \
  && pass "Handles big DNSSEC packets (>1500 B) correctly" \
  || fail "Large UDP response failed (EDNS bufsize problem?)"

echo
pass "ALL TESTS PASSED 🎉"
