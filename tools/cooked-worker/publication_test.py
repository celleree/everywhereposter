import copy
import hashlib
import gzip
import importlib.util
import io
import json
from pathlib import Path
from email.message import Message
from urllib.response import addinfourl
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("publication", Path(__file__).with_name("publication.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
H = lambda b: hashlib.sha256(b).hexdigest()
J = lambda o: json.dumps(o).encode()


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.counter = 0
        # Incomplete fixture mocks must fail locally before Docker or network I/O.
        for target in ("subprocess.Popen", "socket.create_connection", "socket.socket.connect"):
            guard = patch(target, side_effect=AssertionError("Unstubbed external I/O: " + target))
            guard.start()
            self.addCleanup(guard.stop)

    def tar(self, files, extra=None):
        self.counter += 1
        path = self.root / str(self.counter)
        with tarfile.open(path, "w") as archive:
            for name, data in files:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            if extra:
                archive.addfile(extra)
        return path, H(path.read_bytes())

    def base(self, platform="amd64", compressed=False, wrong_diff=False):
        layer = b"synthetic layer bytes"
        diff = "0" * 64 if wrong_diff else H(layer)
        config = J(dict(os="linux", architecture=platform, config={"User": "10001:0"},
                        rootfs={"type": "layers", "diff_ids": ["sha256:" + diff]}))
        if compressed:
            layer = gzip.compress(layer)
        descriptor = lambda b: dict(digest="sha256:" + H(b), size=len(b))
        manifest = J(dict(schemaVersion=2, config=descriptor(config), layers=[descriptor(layer)]))
        index = J(dict(schemaVersion=2, manifests=[descriptor(manifest)]))
        blobs = [layer, config, manifest, index]
        files = [("blobs/sha256/" + H(b), b) for b in blobs]
        files += [("oci-layout", J({"imageLayoutVersion": "1.0.0"})),
                  ("index.json", J(dict(schemaVersion=2, manifests=[descriptor(index)]))),
                  ("manifest.json", J([dict(Config="blobs/sha256/" + H(config),
                    Layers=["blobs/sha256/" + H(layer)], RepoTags=["arbitrary/hostile:tag"])]))]
        return files, "sha256:" + H(index), "sha256:" + H(config)

    def validate(self, files, index, config):
        path, checksum = self.tar(files)
        output = self.root / (str(self.counter) + ".load.tar")
        with patch.object(p, "BASE_INDEX", index), patch.object(p, "BASE_CONFIG", config):
            result = p.validate_base(path, checksum, output)
        return result, output

    def test_valid_archive_preserves_bytes_and_replaces_untrusted_tags(self):
        files, index, config = self.base()
        result, output = self.validate(files, index, config)
        with tarfile.open(output) as archive:
            manifest = json.load(archive.extractfile("manifest.json"))[0]
            self.assertEqual(manifest["RepoTags"], [p.BASE_TAG])
            original = dict(files)
            for name in [manifest["Config"], *manifest["Layers"]]:
                self.assertEqual(archive.extractfile(name).read(), original[name])
        self.assertEqual(result["architecture"], "amd64")

    def test_compressed_layer_and_wrong_diff_id(self):
        files, index, config = self.base(compressed=True)
        self.validate(files, index, config)
        with self.assertRaises(ValueError):
            self.validate(*self.base(compressed=True, wrong_diff=True))

    def test_unsafe_duplicate_link_sparse_and_bounds(self):
        for name in ("../escape", "/absolute", "a/../b", "a//b", "a\\b", "./file"):
            with self.subTest(name=name):
                path, checksum = self.tar([(name, b"x")])
                with self.assertRaises(ValueError):
                    p.Archive(path, checksum)
        path, checksum = self.tar([("same", b"x"), ("same", b"y")])
        with self.assertRaises(ValueError):
            p.Archive(path, checksum)
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE):
            member = tarfile.TarInfo("link")
            member.type, member.linkname = kind, "target"
            path, checksum = self.tar([], member)
            with self.assertRaises(ValueError):
                p.Archive(path, checksum)
        path, checksum = self.tar([("file", b"123")])
        with patch.object(p, "MAX_BYTES", 2), self.assertRaises(ValueError):
            p.Archive(path, checksum)
        with self.assertRaises(ValueError):
            p.Archive(path, "0" * 64)
        with self.assertRaises(ValueError):
            p.js(b'{"duplicate":1,"duplicate":2}')

    def test_blob_hash_platform_index_config_and_rootfs_mismatch(self):
        files, index, config = self.base()
        bad = files.copy()
        bad[0] = bad[0][0], b"corrupted"
        for values in ((bad, index, config), (files, "sha256:" + "0" * 64, config),
                       (files, index, "sha256:" + "0" * 64), self.base("arm64")):
            with self.subTest(identity=values[1:]), self.assertRaises(ValueError):
                self.validate(*values)
        bad = copy.deepcopy(files)
        legacy = json.loads(bad[-1][1])
        legacy[0]["Layers"] = []
        bad[-1] = "manifest.json", J(legacy)
        with self.assertRaises(ValueError):
            self.validate(bad, index, config)

    def bundle(self):
        row = dict(path="/native/libexample.so", sha256="a" * 64)
        inventory = dict(base=dict(debian=[], python=[], native=[row], payload=[]),
                         node=dict(version="v22.20.0", licenseSHA256="b" * 64),
                         worker=dict(sourceSHA="c" * 40, sourceFiles={}, runtimeHashes={}))
        files = {"source.tar": b"synthetic source", "NOTICE": b"synthetic notice",
                 "build.txt": b"synthetic build/patch mapping", "delivery.txt": b"synthetic tested delivery"}
        components = [dict(kind=k, identity=i, disposition="bundled-source",
                           basis="Synthetic fixture includes complete corresponding source material.",
                           sources=["source.tar"], notices=["NOTICE"], build=["build.txt"])
                      for k, i in (("native", row), ("node", inventory["node"]), ("worker", inventory["worker"]))]
        manifest = dict(schema=1, sourceSHA="c" * 40, baseArchiveSHA256="d" * 64,
                        baseConfigDigest=p.BASE_CONFIG, baseIndexDigest=p.BASE_INDEX,
                        nodeBase="node@sha256:" + "e" * 64, inventory=inventory,
                        files={n:H(b) for n,b in files.items()}, components=components,
                        delivery=dict(owner="fixture", instructions="delivery.txt", testedEvidence="delivery.txt"))
        return manifest, inventory, files

    def check_bundle(self, m, inventory, files):
        path, checksum = self.tar([("manifest.json", J(m)), *files.items()])
        with patch.dict(p.os.environ, SOURCE_SHA="c" * 40):
            return p.validate_bundle(path, checksum, "d" * 64, inventory, "node@sha256:" + "e" * 64)

    def test_complete_synthetic_bundle_only(self):
        m, inventory, files = self.bundle()
        self.assertEqual(self.check_bundle(m, inventory, files), m)

    def test_missing_component_source_notice_build_inventory_and_delivery_reject(self):
        original, inventory, files = self.bundle()
        mutations = [lambda m:m["components"].pop(),
                     lambda m:m["components"][0].update(sources=[]),
                     lambda m:m["components"][0].update(notices=[]),
                     lambda m:m["components"][0].update(build=["absent"]),
                     lambda m:m["components"][0].update(basis="TODO resolve licensing"),
                     lambda m:m["components"].append(m["components"][0]),
                     lambda m:m["inventory"]["base"]["native"].clear(),
                     lambda m:m.update(nodeBase="node:latest"),
                     lambda m:m.update(sourceSHA="0" * 40),
                     lambda m:m["delivery"].update(testedEvidence="absent"),
                     lambda m:m["files"].update(NOTICE="0" * 64)]
        for mutate in mutations:
            m = copy.deepcopy(original)
            mutate(m)
            with self.subTest(manifest=m), self.assertRaises(ValueError):
                self.check_bundle(m, inventory, files)

    def test_token_redirect_cannot_forward_basic_credentials(self):
        calls = []
        class FakeHTTPS(p.urllib.request.HTTPSHandler):
            def https_open(self, req):
                calls.append(req)
                headers = Message()
                headers["Location"] = "https://untrusted.invalid/collect"
                response = addinfourl(io.BytesIO(b""), headers, req.full_url, 302)
                response.msg = "Found"
                return response
        original = p.urllib.request.build_opener
        def transport(*handlers):
            return original(*handlers, FakeHTTPS())
        with patch.object(p.urllib.request, "build_opener", side_effect=transport), \
             patch.dict(p.os.environ, GITHUB_ACTOR="fixture", GH_TOKEN="fixture-secret"):
            with self.assertRaisesRegex(ValueError, "token redirects forbidden"):
                p.registry_token(p.PACKAGES[0])
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0].full_url.startswith("https://ghcr.io/token?"))
        self.assertTrue(calls[0].get_header("Authorization").startswith("Basic "))

    def test_registry_only_structured_authenticated404_proves_absence(self):
        for status, code, accepted in ((404,"MANIFEST_UNKNOWN",True), (404,"NAME_UNKNOWN",True),
                                       (403,"DENIED",False), (401,"UNAUTHORIZED",False), (500,"UNKNOWN",False)):
            error = urllib.error.HTTPError("https://ghcr.io/", status, "fixture", {}, io.BytesIO(J(dict(errors=[dict(code=code)]))))
            with patch.object(p, "request", side_effect=error):
                if accepted:
                    self.assertIsNone(p.manifest_digest(p.PACKAGES[0], "f" * 40, "fixture", absent=True))
                else:
                    with self.assertRaises(ValueError):
                        p.manifest_digest(p.PACKAGES[0], "f" * 40, "fixture", absent=True)

    def test_shared_verification_contract_and_default_external_io_deny(self):
        root = Path(__file__).parents[2]
        script = Path(__file__).with_name("verify-image.py").read_text()
        compile(script, "shared image verification", "exec")
        self.assertIn("(10001, 0)", script)
        self.assertIn("runtimeHashes", script)
        self.assertIn("modelRepositoryRevision", script)
        self.assertIn("< tools/cooked-worker/verify-image.py", (root / ".github/workflows/prepare-cooked-worker.yml").read_text())
        self.assertIn('Path("tools/cooked-worker/verify-image.py").read_text()', Path(p.__file__).read_text())
        with self.assertRaisesRegex(AssertionError, "Unstubbed external I/O"):
            p.run("docker", "fixture-only")
        with self.assertRaisesRegex(AssertionError, "Unstubbed external I/O"):
            p.request("https://ghcr.io/fixture-only", "fixture-only")

    def test_bundle_failure_never_builds_or_publishes(self):
        (self.root / "context").mkdir()
        (self.root / "context/staging-manifest.json").write_bytes(J(dict(sourceSHA="c" * 40, sourceFiles={}, runtimeHashes={})))
        loaded = J([dict(Os="linux", Architecture="amd64", RootFS=dict(Layers=[]), Config={})]).decode()
        def fake_run(*args, **kwargs):
            return "v22.20.0" if args[-1] == "--version" else loaded
        with patch.object(p, "validate_base", return_value={"rootfs":{"diff_ids":[]},"config":{}}), \
             patch.object(p, "run", side_effect=fake_run), \
             patch.object(p.subprocess, "check_output", return_value=b"synthetic license"), \
             patch.object(p, "offline", return_value={}), \
             patch.object(p, "validate_bundle", side_effect=ValueError("fixture")) as bundle, \
             patch.dict(p.os.environ, BASE_SHA256="a" * 64, BUNDLE_SHA256="b" * 64,
                        SOURCE_SHA="c" * 40, NODE_BASE="node@sha256:" + "e" * 64):
            with self.assertRaisesRegex(ValueError, "fixture"):
                p.prepare(self.root)
            bundle.assert_called_once()
            self.assertFalse(any("build" in c.args or "push" in c.args for c in p.run.call_args_list))

    def test_workflow_manual_owner_gate_permissions_and_publication_order(self):
        workflow = Path(__file__).parents[2] / ".github/workflows/publish-cooked-worker.yml"
        text = workflow.read_text()
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("python3 -B -m unittest discover", text)
        self.assertNotIn("  push:", text)
        self.assertIn('"$GITHUB_ACTOR" == celleree', text)
        self.assertIn('"$TRIGGERING_ACTOR" == celleree', text)
        self.assertIn('"$SOURCE_SHA" == "$GITHUB_SHA"', text)
        self.assertIn('"$count" -ge 1', text)
        self.assertEqual(text.count("packages: write"), 1)
        source, publication = text.split("  publication:\n", 1)
        self.assertIn("pull-requests: read", source)
        self.assertNotIn("pull-requests:", publication)
        self.assertIn("pull-requests: read", (workflow.parent / "prepare-cooked-worker.yml").read_text())
        self.assertNotIn("id-token:", text)
        self.assertNotIn("${{ inputs.", "\n".join(line for line in text.splitlines() if "run:" in line))
        self.assertLess(text.index('publication.py prepare '), text.index('publication.py publish '))
        self.assertNotIn(":latest", text)
        self.assertNotIn("secrets.", text)
        self.assertEqual(p.PACKAGES, ("celleree/publish-everywhere-cooked-base", "celleree/publish-everywhere-cooked-worker"))


if __name__ == "__main__":
    unittest.main()
