import hashlib, json, os, sys
from pathlib import Path
expected = json.loads(sys.argv[1])
assert (os.getuid(), os.getgid()) == (10001, 0)
def checked(root, entries):
    result = {}
    for name, want in entries.items():
        assert isinstance(name, str) and name and not Path(name).is_absolute() and '..' not in Path(name).parts
        p = root / name
        assert not p.is_symlink() and p.resolve().is_relative_to(root) and p.is_file()
        actual = hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
        assert actual == want, name
        result[name] = actual
    return result
runtime = Path('/opt/runtime')
assert sorted(p.name for p in runtime.iterdir()) == sorted(expected['runtimeHashes'])
runtime_hashes = checked(runtime, expected['runtimeHashes'])
manifest_path = Path('/opt/source-manifest.json')
manifest = json.loads(manifest_path.read_text())
for key in ('upstream', 'modelRepositoryRevision', 'modelFiles'):
    assert manifest[key] == expected[key], key
assert manifest['sourceFiles'] and 'LICENSE' in manifest['sourceFiles']
source_hashes = checked(Path('/opt/upstream'), manifest['sourceFiles'])
model_hashes = checked(Path('/opt/model'), expected['modelFiles'])
notices = ['/opt/upstream/LICENSE', '/opt/MODEL-NOTICES.md', '/opt/NODE-LICENSE', '/usr/local/lib/python3.12/LICENSE.txt', '/usr/share/doc/ffmpeg/copyright']
notice_hashes = {name: hashlib.file_digest(Path(name).open('rb'), 'sha256').hexdigest() for name in notices}
print(json.dumps(dict(runtimeHashes=runtime_hashes, upstream=manifest['upstream'], modelRepositoryRevision=manifest['modelRepositoryRevision'], sourceFiles=source_hashes, modelFiles=model_hashes, sourceManifestSHA256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(), noticeHashes=notice_hashes), indent=2))
