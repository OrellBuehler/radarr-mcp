#!/usr/bin/env bash
set -euo pipefail

url="${1:-https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json}"
out="$(dirname "$0")/../radarr-openapi.json"

curl -fsSL "$url" -o "$out"
echo "wrote $out from $url"
