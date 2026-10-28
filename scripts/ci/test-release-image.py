#!/usr/bin/env python3
"""Focused fail-closed identity, isolation and resource-ownership checks."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("release_image", ROOT / "verify-release-image.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64


class SafetyTests(unittest.TestCase):
    def test_rejects_injected_and_abbreviated_identities(self):
        for sha, digest in [("a"*7, DIGEST), (SHA+";id", DIGEST), (SHA, "latest"), (SHA.upper(), DIGEST)]:
            with self.subTest(sha=sha), self.assertRaises(RuntimeError):
                module.identity(sha, digest)
        module.identity(SHA, DIGEST)

    def test_checks_registry_digest_previous_identity_and_platform(self):
        meta = {"Os":"linux","Architecture":"amd64","Id":DIGEST,
                "RepoDigests":[module.REPOSITORY+"@"+DIGEST]}
        self.assertEqual(module.image_identity(meta, DIGEST, DIGEST), DIGEST)
        for changed in [{"Architecture":"arm64"}, {"Id":"sha256:"+"c"*64}, {"RepoDigests":[]}]:
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                module.image_identity({**meta, **changed}, DIGEST, DIGEST)

    def test_rejects_duplicate_missing_changed_or_failed_migrations(self):
        expected={"one":"a","two":"b"}
        module.migration_rows("one|a|t\ntwo|b|t\n", expected)
        for rows in ["one|a|t", "one|a|t\none|a|t", "one|z|t\ntwo|b|t", "one|a|t\ntwo|b|f"]:
            with self.subTest(rows=rows), self.assertRaises(RuntimeError):
                module.migration_rows(rows, expected)

    def test_journals_before_creation_and_never_publishes_ports(self):
        with tempfile.TemporaryDirectory() as root:
            state=Path(root)/"state.json"
            check=module.Verification(root, state)
            with patch.object(check, "inspect", return_value=None):
                flags=check.flags("postgres", "none")
            self.assertEqual(flags[flags.index("--network")+1], "none")
            self.assertIn("--read-only",flags)
            self.assertIn("--cap-drop",flags)
            self.assertNotIn("-p",flags)
            self.assertNotIn("--publish",flags)
            self.assertNotIn("--volume",flags)
            self.assertNotIn("--mount",flags)
            self.assertEqual(json.loads(state.read_text())["owned"],check.owned)
            recovered=module.Verification.recover(state)
            self.assertEqual(recovered.owned,check.owned)

    def test_cleanup_rejects_replaced_resources_without_removal(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            check.owned=[check.owner+"-postgres"]
            with patch.object(check, "inspect", return_value={"Config":{"Labels":{module.LABEL:"other"}}}), \
                 patch.object(check, "docker") as docker, self.assertRaises(RuntimeError):
                check.cleanup()
            docker.assert_not_called()

    def test_uncertain_daemon_failure_is_not_absence(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            failure=subprocess.CompletedProcess([],1,"","permission denied")
            with patch.object(subprocess,"run",return_value=failure), self.assertRaises(RuntimeError):
                check.inspect("fixture")

    def test_cleanup_removes_owned_anonymous_volumes_by_verified_container_id(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            check.owned=[check.owner+"-seed"]
            meta={"Id":"verified-container-id","Config":{"Labels":{module.LABEL:check.owner}}}
            with patch.object(check,"inspect",side_effect=[meta,None]), patch.object(check,"docker") as docker:
                check.cleanup()
            docker.assert_called_once_with("rm","-f","-v","verified-container-id",timeout=30)

    def test_recovery_rejects_arbitrary_cleanup_targets(self):
        with tempfile.TemporaryDirectory() as root:
            state=Path(root)/"state.json"
            state.write_text(json.dumps({"owner":"release-preflight-"+"a"*32,"owned":["postiz"]}))
            with self.assertRaises(RuntimeError):
                module.Verification.recover(state)

    def test_app_receives_only_synthetic_settings_and_private_network(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            with patch.object(check,"inspect",return_value=None), patch.object(check,"docker",return_value="{}") as run:
                check.app(DIGEST,"seed","fixture",["node","-"],data=module.NODE_CHECK,action="seed")
            args=run.call_args.args
            self.assertIn("container:fixture",args)
            self.assertIn("-i",args)
            self.assertIn("DATABASE_URL="+module.DATABASE,args)
            self.assertFalse(any(x.startswith(("GH_TOKEN=","GITHUB_TOKEN=","OPENAI_API_KEY=","STRIPE_")) for x in args))
            self.assertIn("example.invalid",module.NODE_CHECK)
            self.assertIn("/config:rw,nosuid,noexec,size=16m",args)
            self.assertIn("/uploads:rw,nosuid,noexec,size=16m",args)

    def test_remaining_registry_auth_stops_before_any_docker_command(self):
        with tempfile.TemporaryDirectory() as root:
            argv=["verify","--candidate-sha",SHA,"--candidate-digest",DIGEST,
                  "--previous-sha",SHA,"--previous-id",DIGEST,"--auth-directory",root,
                  "--receipt",root+"/receipt.json","--state",root+"/state.json"]
            with patch.object(module.os.sys,"argv",argv), patch.object(module.subprocess,"run") as run, self.assertRaises(RuntimeError):
                module.main()
            run.assert_not_called()

    def test_workflow_has_no_production_connection_and_cleans_auth_first(self):
        text=(ROOT.parent.parent/".github/workflows/release-preflight.yml").read_text()
        self.assertNotIn("environment:",text)
        self.assertNotIn("SSH_",text)
        self.assertNotIn("secrets.",text)
        self.assertNotIn("packages: write",text)
        self.assertNotIn("contents: write",text)
        self.assertLess(text.index("Remove registry authentication before image execution"),
                        text.index("Rehearse migrations and legacy reads"))
        self.assertIn("if: always()",text)
        self.assertIn("--cleanup",text)

    def test_runner_context_is_used_only_after_job_dispatch(self):
        text=(ROOT.parent.parent/".github/workflows/release-preflight.yml").read_text()
        header=text.split("  verify:",1)[1].split("    steps:",1)[0]
        self.assertNotIn("runner.",header)
        self.assertEqual(text.count("DOCKER_CONFIG: ${{ runner.temp }}/release-preflight-auth"),4)


    def packaged_engine_case(self, mode="ok"):
        harness=r"""
const vm=require('vm'),crypto=require('crypto'),path=require('path');
let input='';process.stdin.on('data',c=>input+=c).on('end',()=>{
 const {source,mode}=JSON.parse(input),version='a'.repeat(40),calls=[];
 let writes=0,error=null;
 const readonly=new Proxy({
  constants:{X_OK:1},
  lstatSync:()=>({isFile:()=>mode!=='nonregular'}),
  statSync:p=>({size:mode==='oversize'?49*1024*1024:mode==='cache-size'&&p.startsWith('/root')&&p.endsWith('libquery-engine')?100:7}),
  accessSync:()=>{if(mode==='unexecutable')throw Error('EACCES')},
  readFileSync:p=>Buffer.from(mode==='content'&&p.startsWith('/app')?'changed':'engines')
 },{get:(o,k)=>k in o?o[k]:(()=>{writes++;throw Object.assign(Error('EROFS'),{code:'EROFS'})})});
 const modules={fs:readonly,path,crypto,'@prisma/engines-version':{enginesVersion:version},
 '@prisma/client':{Prisma:{prismaVersion:{engine:mode==='version'?'b'.repeat(40):version}}},
 child_process:{spawnSync:(command,args,options)=>{calls.push({command,args,env:options.env});return {status:0}}}};
 const req=name=>{if(!(name in modules))throw Error('Unexpected module');return modules[name]};
 req.resolve=()=>'/app/node_modules/.prisma/client/default.js';
 const fixtureProcess={env:{DATABASE_URL:'synthetic'},exitCode:0};
 try{vm.runInNewContext(source,{require:req,process:fixtureProcess,Buffer})}catch(e){error=e.message}
 console.log(JSON.stringify({writes,error,calls,exitCode:fixtureProcess.exitCode}));
});
"""
        result=subprocess.run(["node","-e",harness],input=json.dumps({"source":module.NODE_MIGRATE,"mode":mode}),
                              text=True,capture_output=True,check=True)
        return json.loads(result.stdout)

    def test_observed_erofs_is_avoided_without_cache_writes_or_exec_tmpfs(self):
        result=self.packaged_engine_case()
        self.assertIsNone(result["error"])
        self.assertEqual(result["writes"],0)
        self.assertEqual(len(result["calls"]),1)
        call=result["calls"][0]
        self.assertEqual(call["command"],"pnpm")
        self.assertEqual(call["args"],["exec","prisma","migrate","deploy","--schema",module.SCHEMA])
        self.assertTrue(call["env"]["PRISMA_SCHEMA_ENGINE_BINARY"].startswith("/root/.cache/prisma/master/"))
        self.assertTrue(call["env"]["PRISMA_QUERY_ENGINE_LIBRARY"].startswith("/app/node_modules/.prisma/client/"))
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            with patch.object(check,"inspect",return_value=None):
                flags=check.flags("baseline","container:fixture")
            self.assertIn("/tmp:rw,nosuid,noexec,size=64m",flags)
            self.assertIn("--read-only",flags)
            self.assertNotIn("--mount",flags)

    def test_packaged_engine_mismatch_or_size_fails_before_migration(self):
        for mode in ["version","oversize","cache-size","content","unexecutable","nonregular"]:
            with self.subTest(mode=mode):
                result=self.packaged_engine_case(mode)
                self.assertIsNotNone(result["error"])
                self.assertEqual(result["calls"],[])
                self.assertEqual(result["writes"],0)

    def test_migration_uses_immutable_engine_program(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            with patch.object(check,"app") as app:
                check.migrate(DIGEST,"baseline","fixture")
            self.assertEqual(app.call_args.args,(DIGEST,"baseline","fixture",["node","-"]))
            self.assertEqual(app.call_args.kwargs,{"data":module.NODE_MIGRATE})


    def test_wallet_proof_requires_each_guard_to_pass_explicitly(self):
        proof=dict.fromkeys(["legacyWrites","lifecycleWrites","immutableGuards","deleteGuards"],True)
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            with patch.object(check,"app",return_value=json.dumps(proof)) as app:
                self.assertEqual(check.wallet_writes(DIGEST,"candidate-wallet","fixture"),proof)
                self.assertEqual(app.call_args.args,(DIGEST,"candidate-wallet","fixture",["node","-"]))
                self.assertEqual(app.call_args.kwargs,{"data":module.NODE_WALLET_WRITES,"action":"candidate-wallet"})
            for bad in [{}, {**proof,"deleteGuards":False}, {**proof,"deleteGuards":1}, {**proof,"extra":True}]:
                with self.subTest(proof=bad), patch.object(check,"app",return_value=json.dumps(bad)), self.assertRaises(RuntimeError):
                    check.wallet_writes(DIGEST,"candidate-wallet","fixture")

    def test_migration20_requires_both_published_clients(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            with patch.object(check,"wallet_writes",return_value={"pass":True}) as probe:
                self.assertIsNone(check.wallet_compatibility("candidate","previous","fixture",{}))
                probe.assert_not_called()
                self.assertEqual(check.wallet_compatibility("candidate","previous","fixture",{module.WALLET_MIGRATION:"checksum"}),
                                 {"candidate":{"pass":True},"previous":{"pass":True}})
                self.assertEqual([c.args for c in probe.call_args_list],
                                 [("candidate","candidate-wallet","fixture"),("previous","legacy-wallet","fixture")])
            with patch.object(check,"wallet_writes",side_effect=RuntimeError("guard failed")), self.assertRaises(RuntimeError):
                check.wallet_compatibility("candidate","previous","fixture",{module.WALLET_MIGRATION:"checksum"})

    def test_wallet_probe_is_valid_node_program(self):
        subprocess.run(["node","--check"],input=module.NODE_WALLET_WRITES,text=True,capture_output=True,check=True)


if __name__ == "__main__":
    unittest.main()
