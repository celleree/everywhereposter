"""Build-only, checksum-pinned download with bounded transient retries.

The 30-second timeout is socket I/O, not total wall time. CI's build() retains
its outer 600-second subprocess timeout around the entire Docker build.
"""
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

MAX_BYTES = 16 * 1024 * 1024
SOCKET_TIMEOUT = 30
RETRY_DELAYS = (2, 4)
MAX_ATTEMPTS = len(RETRY_DELAYS) + 1


def verified_bytes(lock):
    for attempt in range(MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(lock['ytDlpUrl'], timeout=SOCKET_TIMEOUT) as response:
                payload = response.read(MAX_BYTES + 1)
        except (urllib.error.URLError, TimeoutError) as error:
            if isinstance(error, urllib.error.HTTPError):
                transient = error.code in (502, 503, 504)
                reason = f'HTTP {error.code}'
                error.close()
            else:
                cause = error.reason if isinstance(error, urllib.error.URLError) else error
                transient = isinstance(cause, TimeoutError)
                reason = 'socket timeout'
            if not transient or attempt == MAX_ATTEMPTS - 1:
                raise
            delay = RETRY_DELAYS[attempt]
            print(f'yt-dlp download attempt {attempt + 1}/{MAX_ATTEMPTS}: '
                  f'{reason}; retrying in {delay}s', file=sys.stderr)
            time.sleep(delay)
            continue
        if len(payload) > MAX_BYTES:
            raise ValueError('yt-dlp download exceeds build size limit')
        if hashlib.sha256(payload).hexdigest() != lock['ytDlpSha256']:
            raise ValueError('yt-dlp checksum mismatch')
        return payload
    raise AssertionError('Unreachable download state')


def install(lock_path, destination):
    lock = json.loads(Path(lock_path).read_text(encoding='utf-8'))
    payload = verified_bytes(lock)
    Path(destination).write_bytes(payload)


if __name__ == '__main__':
    install(Path(__file__).with_name('tools.lock.json'), '/opt/yt-dlp')
