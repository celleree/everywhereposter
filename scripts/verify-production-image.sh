#!/bin/sh
set -eu

IMAGE_TAG="${1:?usage: verify-production-image.sh IMAGE_TAG}"
SCRIPT_DIRECTORY="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNTIME_CHECKER="$SCRIPT_DIRECTORY/../postiz-app/var/docker/verify-production-runtime.sh"

docker run --rm -i --entrypoint /bin/sh "$IMAGE_TAG" -s < "$RUNTIME_CHECKER"

echo "Production image checks passed for $IMAGE_TAG"
