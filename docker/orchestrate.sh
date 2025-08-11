#!/usr/bin/env bash

set -euo pipefail

### 🔧 ApexKit DNS Stack Orchestrator
# Modular, self-healing, idempotent stack manager for:
#   - cloudflared
#   - unbound
#   - pihole
# Supports dry-run, full rebuilds, diagnostics

# Constants
STACK_NAME="dns_stack"
DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

CLOUDFLARED_IMAGE="cloudflared:with-dig"
UNBOUND_IMAGE="apexkit-unbound:latest"

DRY_RUN=false
RESET_NET=false
REBUILD_ALL=false
SERVICES=(cloudflared unbound pihole)

# Helpers
print() { echo -e "[💡] $*"; }
run() { $DRY_RUN && echo "[DRY-RUN] $*" || eval "$*"; }

# Validate required tools
require_tools() {
  for tool in docker dig; do
    command -v "$tool" >/dev/null || {
      echo "❌ Required tool missing: $tool"; exit 1;
    done
  done
}

# Docker network setup
ensure_network() {
  if docker network inspect "$STACK_NAME" &>/dev/null; then
    $RESET_NET && {
      print "Resetting docker network: $STACK_NAME"
      run "docker network rm $STACK_NAME"
    } || return 0
  fi
  print "Creating docker network: $STACK_NAME"
  run "docker network create \
    --driver bridge \
    --subnet=172.19.0.0/24 \
    --gateway=172.19.0.1 \
    $STACK_NAME"
}

# Build image if missing
ensure_image() {
  local image=$1 dockerfile=$2
  if ! docker image inspect "$image" &>/dev/null; then
    print "Building image: $image"
    run "docker build -t $image -f $dockerfile $DIR"
  else
    $REBUILD_ALL && {
      print "Rebuilding image: $image"
      run "docker build --no-cache -t $image -f $dockerfile $DIR"
    }
  fi
}

# Bring up the stack
bring_up_stack() {
  print "Running docker-compose stack"
  run "docker-compose -f $DIR/docker-compose.yml up -d"
}

# Show container IPs
show_ips() {
  print "Active container IPs:"
  docker inspect -f '{{.Name}} → {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker ps -q) | sed 's/^/   /'
}

# Sanity script run
run_tests() {
  print "Running stack sanity checks..."
  run "chmod +x $DIR/tests/stack-sanity.sh"
  run "$DIR/tests/stack-sanity.sh"
}

# Main
main() {
  require_tools

  # Flags
  while [[ ${1:-} =~ ^- ]]; do
    case $1 in
      --dry-run) DRY_RUN=true;;
      --rebuild) REBUILD_ALL=true;;
      --reset-net) RESET_NET=true;;
      --help)
        echo "Usage: $0 [--dry-run] [--rebuild] [--reset-net]"; exit 0;;
    esac
    shift
  done

  ensure_network
  ensure_image "$CLOUDFLARED_IMAGE" "$DIR/docker/cloudflared/Dockerfile"
  ensure_image "$UNBOUND_IMAGE" "$DIR/docker/unbound/Dockerfile"
  bring_up_stack
  show_ips
  run_tests
  print "✅ DNS stack setup complete."
}

main "$@"
