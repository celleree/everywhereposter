#!/bin/sh
# Local acceptance only. Never run this script against a production Docker daemon.
set -eu
if [ "$#" -ne 3 ] && [ "$#" -ne 5 ]; then echo 'Usage: run-local.sh LOCAL_IMAGE OWNED_SOURCE_MP4 NEW_OUTPUT_DIRECTORY [CUT_START CUT_END]' >&2; exit 2; fi
image=$1; source=$(realpath "$2"); output=$3
original=$2; shift 3
if [ "$#" -eq 2 ]; then set -- --cut "$1" "$2"; fi
[ -f "$source" ] && [ ! -L "$original" ] && [ ! -e "$output" ] || { echo 'Regular source and new output directory required.' >&2; exit 2; }
[ "$(docker context inspect --format '{{.Endpoints.docker.Host}}')" = 'unix:///var/run/docker.sock' ] || { echo 'Only the verified local Unix Docker endpoint is allowed.' >&2; exit 2; }
[ "$(docker info --format '{{.Name}}')" = "$(hostname)" ] || { echo 'Docker daemon must identify as this local host.' >&2; exit 2; }
image_id=$(docker image inspect "$image" --format '{{.Id}}')
mkdir -m700 "$output"; output=$(realpath "$output")
marker=$(cat /proc/sys/kernel/random/uuid); cid=
cleanup() {
  if [ -n "$cid" ] && [ "$(docker inspect --format '{{index .Config.Labels "celleree.cooked-pilot"}}' "$cid" 2>/dev/null || true)" = "$marker" ]; then
    docker rm -f "$cid" >/dev/null
  fi
}
trap cleanup EXIT HUP INT TERM
cid=$(docker create --pull never --name "ep-cooked-local-$marker" --label "celleree.cooked-pilot=$marker" \
 --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
 --memory 1g --memory-swap 1g --cpus 2 --pids-limit 128 --ulimit fsize=536870912:536870912 \
 --user "$(id -u):$(id -g)" --log-driver none \
 --tmpfs "/work:rw,noexec,nosuid,nodev,size=512m,mode=0700,uid=$(id -u),gid=$(id -g)" \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
 --mount "type=bind,source=$source,target=/input/source.mp4,readonly" \
 --mount "type=bind,source=$output,target=/output" \
 "$image_id" "$@")
status=0
(ulimit -f 8192; timeout --kill-after=5s 245s docker start -a "$cid") > "$output/native.log" 2>&1 || status=$?
docker inspect --format '{{json .State}}' "$cid" > "$output/container-state.json"
docker inspect --format '{{json .HostConfig}}' "$cid" > "$output/container-limits.json"
printf '%s\n' "$image_id" > "$output/image-id.txt"
[ "$status" -eq 0 ] || { echo "Local candidate failed; retained output directory: $output" >&2; exit "$status"; }
cat "$output/result.json"
