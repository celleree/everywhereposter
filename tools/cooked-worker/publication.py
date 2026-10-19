"""Bounded, fail-closed Cooked release preparation; no publication on import."""
import ast
import base64
import hashlib
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import runpy
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request

BASE_INDEX = "sha256:3d118a94c192655d02f186449f00d41a48a4f896cb93850006139dcba4b3a9d3"
BASE_CONFIG = "sha256:eff48e58dd5a40c9bd9308b81232b6c520fdf81a1e40a8e424388726e35cc17c"
BASE_TAG = "cooked-import:verified"
FINAL_TAG = "cooked-final:verified"
PACKAGES = ("celleree/publish-everywhere-cooked-base", "celleree/publish-everywhere-cooked-worker")
SHA = r"[0-9a-f]{64}"
MAX_BYTES = 8 * 1024**3
MAX_JSON = 4 * 1024**2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(file):
    with open(file, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe(name):
    require(isinstance(name, str) and name and name != "." and len(name) <= 512 and
            not any(ord(c) < 32 or ord(c) == 127 for c in name) and
            str(PurePosixPath(name)) == name and not name.startswith("/") and
            ".." not in PurePosixPath(name).parts and "\\" not in name,
            "Unsafe member path")
    return name


def obj(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def js(data):
    require(len(data) <= MAX_JSON, "Oversized JSON")
    return json.loads(data, object_pairs_hook=obj)


class Archive:
    def __init__(self, path, expected):
        require(Path(path).stat().st_size <= MAX_BYTES and re.fullmatch(SHA, expected) and
                digest(path) == expected, "Archive checksum/size")
        self.tar = tarfile.open(path, "r:")
        self.members = {}
        names = set()
        total = 0
        for member in self.tar:
            name = member.name.rstrip("/") if member.isdir() else member.name
            safe(name)
            require(name not in names and len(names) < 20000, "Duplicate/bounded members")
            names.add(name)
            if member.isdir():
                continue
            require(member.isfile() and not member.sparse, "Nonregular archive member")
            require(member.size >= 0, "Negative member size")
            total += member.size
            require(len(self.members) < 20000 and total <= MAX_BYTES, "Archive bounds")
            self.members[member.name] = member

    def __del__(self):
        if hasattr(self, "tar"):
            self.tar.close()

    def read(self, name):
        require(name in self.members and self.members[name].size <= MAX_JSON, "Missing/large metadata")
        return self.tar.extractfile(self.members[name]).read()

    def json(self, name):
        return js(self.read(name))

    def verify(self, name, expected):
        require(name in self.members and re.fullmatch(SHA, expected), "Missing file/hash")
        actual = hashlib.file_digest(self.tar.extractfile(self.members[name]), "sha256").hexdigest()
        require(actual == expected, "Member checksum: " + name)


def validate_base(archive, expected, output):
    a = Archive(archive, expected)
    require(a.json("oci-layout") == {"imageLayoutVersion": "1.0.0"}, "OCI layout")
    blobs = {n for n in a.members if re.fullmatch("blobs/sha256/" + SHA, n)}
    require(set(a.members) == blobs | {"index.json", "manifest.json", "oci-layout"}, "Unexpected save member")
    for name in blobs:
        a.verify(name, name.rsplit("/", 1)[1])
    seen = set()

    def descriptor(d, depth=0):
        require(depth <= 3 and re.fullmatch("sha256:" + SHA, d["digest"]), "OCI descriptor")
        name = "blobs/sha256/" + d["digest"][7:]
        require(name in blobs and a.members[name].size == d["size"], "OCI blob size")
        seen.add(name)
        return a.json(name)

    index = a.json("index.json")
    require(index["schemaVersion"] == 2 and len(index["manifests"]) == 1 and
            index["manifests"][0]["digest"] == BASE_INDEX, "Vetted base index identity")
    nested = descriptor(index["manifests"][0])
    # Docker's dual export may retain a provenance/attestation manifest. Validate
    # every descriptor while selecting exactly one linux/amd64 runnable image.
    images = []
    def visit(d, depth=0):
        node = descriptor(d, depth)
        if "manifests" in node:
            require(node["schemaVersion"] == 2, "OCI index version")
            for child in node["manifests"]:
                visit(child, depth + 1)
        else:
            require(node["schemaVersion"] == 2, "OCI manifest version")
            config = descriptor(node["config"], depth + 1)
            for layer in node["layers"]:
                name = "blobs/sha256/" + layer["digest"][7:]
                require(re.fullmatch("sha256:" + SHA, layer["digest"]) and name in blobs and
                        a.members[name].size == layer["size"], "OCI layer")
                seen.add(name)
            if (config.get("os"), config.get("architecture")) == ("linux", "amd64"):
                images.append((node, config))
    for d in nested.get("manifests", []):
        visit(d, 1)
    require(len(images) == 1, "Exactly one linux/amd64 image required")
    manifest, config = images[0]
    require(manifest["config"]["digest"] == BASE_CONFIG, "Vetted config identity")
    legacy = a.json("manifest.json")
    require(len(legacy) == 1 and legacy[0]["Config"] == "blobs/sha256/" + BASE_CONFIG[7:], "Legacy identity")
    layers = ["blobs/sha256/" + d["digest"][7:] for d in manifest["layers"]]
    require(legacy[0]["Layers"] == layers and len(config["rootfs"]["diff_ids"]) == len(layers), "Rootfs layers")
    require(seen == blobs, "Unreferenced OCI blob")
    for name, expected_diff in zip(layers, config["rootfs"]["diff_ids"]):
        with a.tar.extractfile(a.members[name]) as raw:
            magic = raw.read(2)
            raw.seek(0)
            stream = gzip.GzipFile(fileobj=raw) if magic == b"\x1f\x8b" else raw
            count, h = 0, hashlib.sha256()
            while chunk := stream.read(1024**2):
                count += len(chunk)
                require(count <= MAX_BYTES, "Expanded layer bound")
                h.update(chunk)
            require(expected_diff == "sha256:" + h.hexdigest(), "Rootfs diff_id")
            stream.close()
    # Never load archive-controlled tags or annotations. Preserve config/layers.
    with tarfile.open(output, "x:") as target:
        for name in [legacy[0]["Config"], *layers]:
            target.addfile(a.members[name], a.tar.extractfile(a.members[name]))
        data = json.dumps([dict(Config=legacy[0]["Config"], Layers=layers, RepoTags=[BASE_TAG])]).encode()
        member = tarfile.TarInfo("manifest.json")
        member.size = len(data)
        target.addfile(member, io.BytesIO(data))
    a.tar.close()
    return config


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def offline(image, script, *args):
    return js(run("docker", "run", "--pull=never", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
                  "--security-opt", "no-new-privileges", "--memory", "512m", "--pids-limit", "32",
                  "--entrypoint", "python", "-i", image, "-I", "-", *args, input=script).encode())


# The same observer runs inside the verified base; never infer its inventory from
# a different worker. Native records cover wheel-native files as well as *.libs.
OBSERVER = r"""
import hashlib, importlib.metadata, json, subprocess
from pathlib import Path
h=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
rows=subprocess.check_output(['dpkg-query','-W','-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n'],text=True).splitlines()
debian=[dict(zip(('binary','version','source','sourceVersion'),r.split('\t'))) for r in rows]
python=sorted([dict(name=d.metadata['Name'],version=d.version) for d in importlib.metadata.distributions()],key=lambda x:x['name'])
root=Path('/usr/local/lib/python3.12/site-packages')
native=[]
for p in sorted(root.rglob('*')):
    if p.is_file() and ('.so' in p.name or any(x.endswith('.libs') for x in p.relative_to(root).parts[:-1])):
        native.append(dict(path=str(p),sha256=h(p)))
manifest=json.loads(Path('/opt/source-manifest.json').read_text())
paths=[Path('/opt/upstream')/n for n in manifest['sourceFiles']]
paths += [Path('/opt/model')/n for n in manifest['modelFiles']]
paths += list(map(Path,('/opt/source-manifest.json','/opt/MODEL-NOTICES.md','/usr/local/lib/python3.12/LICENSE.txt')))
assert all(p.is_file() and not p.is_symlink() for p in paths)
payload=[dict(path=str(p),sha256=h(p)) for p in sorted(paths)]
print(json.dumps(dict(debian=debian,python=python,native=native,payload=payload)))
"""


def validate_bundle(path, expected, archive_hash, inventory, node_base):
    a = Archive(path, expected)
    m = a.json("manifest.json")
    require(m["schema"] == 1 and m["sourceSHA"] == os.environ["SOURCE_SHA"] and m["baseArchiveSHA256"] == archive_hash and
            m["baseConfigDigest"] == BASE_CONFIG and m["baseIndexDigest"] == BASE_INDEX and
            m["nodeBase"] == node_base and m["inventory"] == inventory, "Bundle identity/inventory")
    require(set(a.members) == set(m["files"]) | {"manifest.json"}, "Bundle file inventory")
    for name, value in m["files"].items():
        safe(name)
        a.verify(name, value)
    expected_rows = [(kind, row) for kind, rows in inventory["base"].items() for row in rows]
    expected_rows.extend((("node", inventory["node"]), ("worker", inventory["worker"])))
    actual = []
    for c in m["components"]:
        require(c["disposition"] in ("bundled-source", "source-present", "notice-only") and
                isinstance(c["basis"], str) and len(c["basis"].strip()) >= 20 and
                not re.search(r"(?i)\b(todo|unresolved|unknown|pending)\b", c["basis"]), "Unresolved disposition")
        for field in ("sources", "notices", "build"):
            require(isinstance(c[field], list) and all(n in m["files"] for n in c[field]), "Missing component file")
        require(c["notices"] and c["build"] and
                (c["sources"] or c["disposition"] == "notice-only"), "Incomplete source/notice/build mapping")
        actual.append((c["kind"], c["identity"]))
    canonical = lambda rows: sorted(json.dumps(row, sort_keys=True) for row in rows)
    require(canonical(actual) == canonical(expected_rows) and len(set(canonical(actual))) == len(actual), "Component coverage")
    require(m["delivery"]["owner"].strip() and all(m["delivery"][k] in m["files"] for k in
            ("instructions", "testedEvidence")), "Recipient delivery evidence")
    a.tar.close()
    return m


class AssetRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        from urllib.parse import urlsplit
        parsed = urlsplit(newurl)
        require(parsed.scheme == "https" and parsed.hostname in
                ("api.github.com", "release-assets.githubusercontent.com"), "Unexpected asset redirect")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if parsed.hostname != "api.github.com":
            redirected.remove_header("Authorization")
        return redirected


def request(url, token, accept="application/json"):
    require(url.startswith(("https://api.github.com/", "https://ghcr.io/")), "Unexpected API host")
    opener = urllib.request.build_opener(AssetRedirect())
    return opener.open(urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Accept": accept}), timeout=60)


def download(asset, checksum, output):
    require(re.fullmatch(r"[1-9][0-9]{0,18}", asset) and re.fullmatch(SHA, checksum), "Asset input")
    url = "https://api.github.com/repos/celleree/everywhereposter/releases/assets/" + asset
    metadata = js(request(url, os.environ["GH_TOKEN"]).read(MAX_JSON + 1))
    require(metadata["id"] == int(asset) and metadata["state"] == "uploaded" and
            0 < metadata["size"] <= MAX_BYTES, "Release asset metadata")
    with request(url, os.environ["GH_TOKEN"], "application/octet-stream") as src, open(output, "xb") as dst:
        size = 0
        while data := src.read(1024**2):
            size += len(data)
            require(size <= metadata["size"], "Asset download bound")
            dst.write(data)
    require(size == metadata["size"] and digest(output) == checksum, "Release asset checksum")


def validate_custody(work):
    # An operator attestation binds custody intent; it does not prove access control.
    require(work.is_dir() and not work.is_symlink() and
            work.absolute() == work.resolve(), "Private work directory must be direct")
    require({p.name for p in work.iterdir()} == {"base.tar", "custody.json"},
            "Private directory requires only inputs; outputs must be new")
    for name in ("base.tar", "custody.json"):
        path = work / name
        require(path.is_file() and not path.is_symlink(), "Private input must be a regular file")
    path = work / "custody.json"
    expected = os.environ["CUSTODY_SHA256"]
    require(path.stat().st_size <= 16384 and re.fullmatch(SHA, expected) and
            digest(path) == expected, "Custody checksum/size")
    record = js(path.read_bytes())
    identity = dict(schema=1, sourceSHA=os.environ["SOURCE_SHA"],
                    baseArchiveSHA256=os.environ["BASE_SHA256"], baseIndexDigest=BASE_INDEX,
                    baseConfigDigest=BASE_CONFIG, nodeBase=os.environ["NODE_BASE"],
                    owner="celleree", allowedAccess=["owner", "deployment-automation"],
                    independentRecipients=False, customerDelivery="edited-videos-only")
    require(isinstance(record, dict) and set(record) == set(identity) | {"attestedBy"} and
            all(type(record[k]) is type(v) and record[k] == v for k, v in identity.items()) and
            record["attestedBy"] == "celleree",
            "Private custody identity/access attestation")
    return expected


def prepare(work, *, private=False):
    require(re.fullmatch(r"[0-9a-f]{40}", os.environ["SOURCE_SHA"]) and
            re.fullmatch(r"(node|docker\.io/library/node)@sha256:" + SHA, os.environ["NODE_BASE"]), "Source/Node digest input")
    custody_hash = validate_custody(work) if private else None
    if private:
        require(run("git", "rev-parse", "HEAD") == os.environ["SOURCE_SHA"] and
                not run("git", "status", "--porcelain", "--untracked-files=normal"), "Exact clean source required")
        run("node", "tools/cooked-worker/stage-runtime.cjs", os.environ["SOURCE_SHA"], str(work / "context"))
    archive_hash = os.environ["BASE_SHA256"]
    config = validate_base(work / "base.tar", archive_hash, work / "load.tar")
    run("docker", "load", "--input", str(work / "load.tar"))
    loaded = js(run("docker", "image", "inspect", BASE_TAG).encode())[0]
    require((loaded["Os"], loaded["Architecture"]) == ("linux", "amd64") and
            loaded["RootFS"]["Layers"] == config["rootfs"]["diff_ids"] and
            loaded["Config"] == config["config"], "Loaded config/rootfs mismatch")
    base_inventory = offline(BASE_TAG, OBSERVER)
    node = os.environ["NODE_BASE"]
    if not private:
        run("docker", "pull", "--platform", "linux/amd64", node)
    node_inventory = dict(version=run("docker", "run", "--pull=never", "--rm", "--network", "none", "--entrypoint", "node", node, "--version"))
    license_text = subprocess.check_output(["docker", "run", "--pull=never", "--rm", "--network", "none", "--entrypoint", "cat", node, "/usr/local/LICENSE"])
    node_inventory["licenseSHA256"] = hashlib.sha256(license_text).hexdigest()
    require(node_inventory["version"] == "v22.20.0", "Pinned Node version")
    node_image = js(run("docker", "image", "inspect", node).encode())[0]
    require((node_image["Os"], node_image["Architecture"]) == ("linux", "amd64"), "Node platform")
    if not private:
        run("node", "tools/cooked-worker/stage-runtime.cjs", os.environ["SOURCE_SHA"], str(work / "context"))
    staged = js((work / "context/staging-manifest.json").read_bytes())
    worker = {k:staged[k] for k in ("sourceSHA", "sourceFiles", "runtimeHashes")}
    inventory = dict(base=base_inventory, node=node_inventory, worker=worker)
    if not private:
        validate_bundle(work / "bundle.tar", os.environ["BUNDLE_SHA256"], archive_hash, inventory, node)
    run("docker", "build", "--platform", "linux/amd64", "--build-arg", "NODE_BASE=" + node,
        "--build-arg", "COOKED_BASE=" + BASE_TAG, "--tag", FINAL_TAG, str(work / "context"))
    final = js(run("docker", "image", "inspect", FINAL_TAG).encode())[0]
    require((final["Os"], final["Architecture"], final["Config"]["User"]) == ("linux", "amd64", "10001:0"), "Worker platform/user")
    staged = js((work / "context/staging-manifest.json").read_bytes())
    policy = runpy.run_path("tools/cooked-pilot/prepare.py")
    tree = ast.parse(Path("tools/cooked-pilot/prepare.py").read_text())
    revisions = [v.value for n in ast.walk(tree) if isinstance(n, ast.Dict) for k,v in zip(n.keys,n.values)
                 if isinstance(k,ast.Constant) and k.value == "modelRepositoryRevision" and isinstance(v,ast.Constant)]
    require(len(revisions) == 1, "Model revision policy")
    expected = dict(upstream=policy["PIN"], modelFiles=policy["MODEL"], modelRepositoryRevision=revisions[0], runtimeHashes=staged["runtimeHashes"])
    script = Path("tools/cooked-worker/verify-image.py").read_text()
    verified = offline(FINAL_TAG, script, json.dumps(expected))
    require(offline(FINAL_TAG, OBSERVER) == base_inventory, "Final image base inventory changed")
    require(verified["noticeHashes"]["/opt/NODE-LICENSE"] == node_inventory["licenseSHA256"], "Copied Node license")
    receipt = dict(sourceSHA=os.environ["SOURCE_SHA"], mainSHA=None if private else os.environ["GITHUB_SHA"],
                   importedDockerImageId=loaded["Id"], workerDockerImageId=final["Id"], baseIndexDigest=BASE_INDEX,
                   baseConfigDigest=BASE_CONFIG, baseArchiveSHA256=archive_hash, bundleSHA256=None if private else os.environ["BUNDLE_SHA256"],
                   nodeBase=node, verification=verified, staging=staged)
    if private:
        receipt.update(status="PRIVATE_PREPARED_NOT_PUBLISHED", custodySHA256=custody_hash,
                       registry=None, custodyEvidence="operator-attestation-only")
    with (work / "verification.json").open("x") as output:
        output.write(json.dumps(receipt, indent=2))


class NoTokenRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Registry token redirects forbidden")


def registry_token(package):
    require(package in PACKAGES, "Fixed registry target required")
    credentials = base64.b64encode((os.environ["GITHUB_ACTOR"] + ":" + os.environ["GH_TOKEN"]).encode()).decode()
    url = "https://ghcr.io/token?service=ghcr.io&scope=repository:" + package + ":pull,push"
    opener = urllib.request.build_opener(NoTokenRedirect())
    with opener.open(urllib.request.Request(url, headers={"Authorization": "Basic " + credentials}), timeout=60) as response:
        token = js(response.read(MAX_JSON + 1))["token"]
    require(isinstance(token, str) and token, "Registry authentication")
    return token


def manifest_digest(package, sha, token, absent=False):
    require(package in PACKAGES and re.fullmatch(r"[0-9a-f]{40}", sha) and token, "Fixed authenticated registry target required")
    try:
        with request("https://ghcr.io/v2/" + package + "/manifests/" + sha, token,
                     "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json") as response:
            value = response.headers.get("Docker-Content-Digest", "")
            require(not absent and re.fullmatch("sha256:" + SHA, value), "Tag exists or unknown registry digest")
            return value
    except urllib.error.HTTPError as error:
        require(absent and error.code == 404 and
                set(e["code"] for e in js(error.read(MAX_JSON + 1))["errors"]) in ({"MANIFEST_UNKNOWN"}, {"NAME_UNKNOWN"}),
                "Registry absence/access unproven")


def publish(work):
    receipt = js((work / "verification.json").read_bytes())
    sha = os.environ["SOURCE_SHA"]
    require(receipt["sourceSHA"] == sha == os.environ["GITHUB_SHA"], "Publication source changed")
    tokens = [registry_token(p) for p in PACKAGES]
    for package, token in zip(PACKAGES, tokens):
        manifest_digest(package, sha, token, absent=True)
    run("docker", "login", "ghcr.io", "--username", os.environ["GITHUB_ACTOR"], "--password-stdin", input=os.environ["GH_TOKEN"])
    receipt["registry"] = {}
    for local, package, token in zip((BASE_TAG, FINAL_TAG), PACKAGES, tokens):
        # Recheck immediately before each write; workflow concurrency serializes our writers.
        manifest_digest(package, sha, token, absent=True)
        tag = "ghcr.io/" + package + ":" + sha
        run("docker", "tag", local, tag)
        receipt["registry"][tag] = None  # Attempted; leave unknown truthful on failure.
        (work / "publication-receipt.json").write_text(json.dumps(receipt, indent=2))
        pushed = run("docker", "push", tag)
        reported = re.findall(r"digest: (sha256:[0-9a-f]{64})", pushed)
        actual = manifest_digest(package, sha, token)
        require(reported and reported[-1] == actual, "Pushed/registry digest mismatch")
        receipt["registry"][tag] = actual
        (work / "publication-receipt.json").write_text(json.dumps(receipt, indent=2))


def main(args):
    require(len(args) == 2 and args[0] == "prepare-private",
            "Public Release download/publication retired; private local preparation only")
    prepare(Path(args[1]), private=True)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as error:
        # Do not print HTTP bodies, credentials or signed asset redirect URLs.
        print("Private preparation blocked: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
