#!/usr/bin/env bash

set -euo pipefail

cat >&2 <<'EOF'
[LEGACY] docker/orchestrate.sh is intentionally quarantined.

The canonical single-device DNS stack is no longer orchestrated from this shell
script. Use the Python task instead:

  poetry run nlx --task "DNS Stack Setup" --no-reports

Authoritative path:
  This Mac -> 192.168.64.2 -> Pi-hole on Colima -> host.docker.internal#5053
  -> host cloudflared on 127.0.0.1:5053 -> Cloudflare DoH

The older docker/unbound flow remains in the repository only as legacy reference
material and is not the default or supported local-device path.
EOF

exit 1
