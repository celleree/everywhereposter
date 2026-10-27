#!/usr/bin/env python3
"""Verify published app migrations using synthetic, isolated runner resources only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid

REPOSITORY = "ghcr.io/celleree/publish-everywhere-postiz"
SCHEMA = "libraries/nestjs-libraries/src/database/prisma/schema.prisma"
DATABASE = "postgresql://isolated@127.0.0.1:5432/isolated?schema=public"
LABEL = "everywhereposter.release-preflight"
ROLES = {"postgres", "baseline", "baseline-sql", "seed", "upgrade", "candidate-sql", "candidate-read", "legacy-read"}
NODE_CHECK = r"""
const {PrismaClient}=require('@prisma/client');
const {createHash}=require('crypto');
const db=new PrismaClient({log:[]});
(async()=>{
 if(process.env.PREFLIGHT_ACTION==='seed') await db.$transaction([
  db.organization.create({data:{id:'preflight-org',name:'Synthetic release preflight'}}),
  db.media.create({data:{id:'preflight-media',organizationId:'preflight-org',name:'Synthetic',path:'https://example.invalid/source.mp4',type:'video',fileSize:7}}),
  db.integration.create({data:{id:'preflight-integration',organizationId:'preflight-org',internalId:'synthetic',name:'Synthetic',providerIdentifier:'youtube',type:'social',token:'synthetic-not-valid'}}),
  db.subscription.create({data:{id:'preflight-subscription',organizationId:'preflight-org',subscriptionTier:'PRO',period:'MONTHLY',totalChannels:3,identifier:'synthetic'}})
 ]);
 const records=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const values=[
   await tx.organization.findUniqueOrThrow({where:{id:'preflight-org'},select:{id:true,name:true}}),
   await tx.media.findUniqueOrThrow({where:{id:'preflight-media'},select:{id:true,organizationId:true,name:true,path:true,type:true,fileSize:true}}),
   await tx.integration.findUniqueOrThrow({where:{id:'preflight-integration'},select:{id:true,organizationId:true,internalId:true,name:true,providerIdentifier:true,type:true,token:true,disabled:true}}),
   await tx.subscription.findUniqueOrThrow({where:{id:'preflight-subscription'},select:{id:true,organizationId:true,subscriptionTier:true,period:true,totalChannels:true,identifier:true}})
  ];
  return values;
 },{timeout:20000});
 console.log(JSON.stringify({fingerprint:createHash('sha256').update(JSON.stringify(records)).digest('hex'),models:4}));
})().catch(()=>{process.exitCode=1;}).finally(()=>db.$disconnect());
"""
NODE_MIGRATIONS = r"""
const fs=require('fs'),p=require('path'),h=require('crypto');
const root='/app/libraries/nestjs-libraries/src/database/prisma/migrations';
console.log(JSON.stringify(Object.fromEntries(fs.readdirSync(root).filter(x=>fs.existsSync(p.join(root,x,'migration.sql'))).sort().map(x=>[x,h.createHash('sha256').update(fs.readFileSync(p.join(root,x,'migration.sql'))).digest('hex')]))));
"""


# Use immutable image engines; the default CLI cache updater writes on read-only roots.
NODE_MIGRATE = r"""
const fs=require('fs'),path=require('path'),crypto=require('crypto'),child=require('child_process');
const version=require('@prisma/engines-version').enginesVersion;
if(!/^[a-f0-9]{40}$/.test(version) || require('@prisma/client').Prisma.prismaVersion.engine!==version) throw Error('Packaged Prisma engine version mismatch');
const root='/root/.cache/prisma/master/'+version+'/debian-openssl-3.0.x';
const schema=root+'/schema-engine';
const query=path.join(path.dirname(require.resolve('.prisma/client/default')),'libquery_engine-debian-openssl-3.0.x.so.node');
const files=[schema,query,root+'/libquery-engine'];
if(files.some(p=>!fs.lstatSync(p).isFile())) throw Error('Packaged Prisma engines must be regular files');
if(fs.statSync(schema).size+fs.statSync(query).size>48*1024*1024) throw Error('Packaged Prisma engine size exceeds bound');
fs.accessSync(schema,fs.constants.X_OK);
if(fs.statSync(query).size!==fs.statSync(root+'/libquery-engine').size) throw Error('Packaged query engine size mismatch');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(hash(query)!==hash(root+'/libquery-engine')) throw Error('Packaged query engine content mismatch');
const result=child.spawnSync('pnpm',['exec','prisma','migrate','deploy','--schema','libraries/nestjs-libraries/src/database/prisma/schema.prisma'],{stdio:'inherit',env:{...process.env,PRISMA_SCHEMA_ENGINE_BINARY:schema,PRISMA_QUERY_ENGINE_LIBRARY:query}});
if(result.error || result.status!==0) process.exitCode=1;
"""


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def identity(sha, digest):
    require(bool(re.fullmatch(r"[a-f0-9]{40}", sha)), "Invalid full commit SHA")
    require(bool(re.fullmatch(r"sha256:[a-f0-9]{64}", digest)), "Invalid image digest")


def image_identity(meta, expected_digest=None, expected_id=None):
    require(meta["Os"] == "linux" and meta["Architecture"] == "amd64", "Unexpected image platform")
    if expected_digest:
        require(REPOSITORY + "@" + expected_digest in meta.get("RepoDigests", []), "Published image digest mismatch")
    if expected_id:
        require(meta["Id"] == expected_id, "Previous runtime image ID mismatch")
    return meta["Id"]


def migration_rows(text, expected):
    rows = [line.split("|") for line in text.strip().splitlines()]
    require(len(rows) == len(expected) and all(len(r) == 3 for r in rows), "Incomplete migration evidence")
    require(len({r[0] for r in rows}) == len(rows), "Duplicate migration evidence")
    require({r[0]: r[1] for r in rows} == expected and all(r[2] == "t" for r in rows), "Migration identity/status mismatch")


class Verification:
    def __init__(self, logs, state=None):
        self.owner = "release-preflight-" + uuid.uuid4().hex
        self.logs = Path(logs)
        self.owned = []
        self.counter = 0
        self.state = state

    @classmethod
    def recover(cls, state):
        saved = json.loads(Path(state).read_text())
        require(bool(re.fullmatch(r"release-preflight-[a-f0-9]{32}", saved["owner"])), "Invalid cleanup owner")
        require(len(set(saved["owned"])) == len(saved["owned"]), "Duplicate cleanup entry")
        require(all(n in {saved["owner"] + "-" + r for r in ROLES} for n in saved["owned"]), "Invalid cleanup name")
        check = cls(Path(state).parent)
        check.owner, check.owned = saved["owner"], saved["owned"]
        return check

    def command(self, args, *, data=None, timeout=120):
        self.counter += 1
        try:
            result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Command timed out; owned resources require cleanup") from None
        path = self.logs / ("%03d.log" % self.counter)
        path.write_text(result.stdout + "\n" + result.stderr)
        require(result.returncode == 0, "Command failed: " + " ".join(args[:2]) + " (exit " + str(result.returncode) + ")")
        return result.stdout

    def docker(self, *args, **kwargs):
        return self.command(["docker", *args], **kwargs)

    def inspect(self, name):
        result = subprocess.run(["docker", "container", "inspect", name], text=True, capture_output=True, timeout=15)
        if result.returncode:
            absent = {f"Error: No such container: {name}", f"Error: No such object: {name}",
                      f"Error response from daemon: No such container: {name}"}
            require(result.stderr.strip() in absent, "Resource inspection uncertain")
            return None
        return json.loads(result.stdout)[0]

    def record(self, role):
        require(role in ROLES, "Invalid resource role")
        name = self.owner + "-" + role
        require(self.inspect(name) is None, "Resource already exists")
        self.owned.append(name)  # Journal before creation, including uncertain outcomes.
        if self.state:
            Path(self.state).write_text(json.dumps({"owner": self.owner, "owned": self.owned}))
        return name

    def cleanup(self):
        for name in reversed(self.owned):
            current = self.inspect(name)
            if current:
                require(current["Config"].get("Labels", {}).get(LABEL) == self.owner, "Cleanup ownership mismatch")
                self.docker("rm", "-f", "-v", current["Id"], timeout=30)
        require(all(self.inspect(n) is None for n in self.owned), "Owned resources remain")

    def flags(self, role, network, memory="512m"):
        return ["--name", self.record(role), "--label", LABEL + "=" + self.owner,
                "--pull", "never", "--network", network, "--read-only", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--memory", memory, "--memory-swap", memory,
                "--cpus", "1", "--pids-limit", "128", "--tmpfs", "/tmp:rw,nosuid,noexec,size=64m"]

    def app(self, image, role, db, command, data=None, action="check"):
        return self.docker("run", "-i", *self.flags(role, "container:" + db), "--workdir", "/app",
                           "--tmpfs", "/config:rw,nosuid,noexec,size=16m",
                           "--tmpfs", "/uploads:rw,nosuid,noexec,size=16m",
                           "-e", "DATABASE_URL=" + DATABASE, "-e", "NODE_OPTIONS=--max-old-space-size=256",
                           "-e", "PREFLIGHT_ACTION=" + action, "--entrypoint", command[0],
                           image, *command[1:], data=data, timeout=180)

    def migrate(self, image, role, db):
        self.app(image, role, db, ["node", "-"], data=NODE_MIGRATE)

    def migration_evidence(self, image, role, db):
        expected = json.loads(self.app(image, role, db, ["node", "-"], data=NODE_MIGRATIONS))
        require(expected, "Image contains no migration SQL")
        rows = self.docker("exec", db, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "isolated",
                           "-d", "isolated", "-Atc",
                           'SELECT migration_name,checksum,(finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM "_prisma_migrations" ORDER BY migration_name')
        migration_rows(rows, expected)
        return expected

    def run(self, candidate, previous, postgres):
        db = self.owner + "-postgres"
        self.docker("run", "-d", *self.flags("postgres", "none"), "--user", "70:70", "--shm-size", "16m",
                    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,noexec,size=256m,uid=70,gid=70,mode=0700",
                    "--tmpfs", "/var/run/postgresql:rw,nosuid,noexec,size=8m,uid=70,gid=70,mode=0700",
                    "-e", "POSTGRES_USER=isolated", "-e", "POSTGRES_DB=isolated",
                    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", postgres, "postgres",
                    "-c", "listen_addresses=127.0.0.1", "-c", "shared_buffers=16MB", "-c", "max_connections=10")
        ready = False
        for _ in range(40):
            result = subprocess.run(["docker", "exec", db, "pg_isready", "-U", "isolated", "-d", "isolated"],
                                    capture_output=True, timeout=10)
            if result.returncode == 0:
                ready = True
                break
            time.sleep(1)
        require(ready, "Fixture startup failed")
        meta = self.inspect(db)
        require(meta["HostConfig"]["NetworkMode"] == "none" and not meta["HostConfig"]["PortBindings"], "Fixture network mismatch")
        self.migrate(previous, "baseline", db)
        old_migrations = self.migration_evidence(previous, "baseline-sql", db)
        original = json.loads(self.app(previous, "seed", db, ["node", "-"], data=NODE_CHECK, action="seed"))
        self.migrate(candidate, "upgrade", db)
        new_migrations = self.migration_evidence(candidate, "candidate-sql", db)
        require(all(new_migrations.get(k) == v for k, v in old_migrations.items()), "Historical migration changed")
        current = json.loads(self.app(candidate, "candidate-read", db, ["node", "-"], data=NODE_CHECK))
        legacy = json.loads(self.app(previous, "legacy-read", db, ["node", "-"], data=NODE_CHECK))
        require(original == current == legacy and original["models"] == 4, "Synthetic record preservation failed")
        return {"baselineMigrations": old_migrations, "candidateMigrations": new_migrations,
                "syntheticRecordsPreserved": True, "previousClientCompatible": True}


def main():
    if len(os.sys.argv) == 3 and os.sys.argv[1] == "--cleanup":
        Verification.recover(os.sys.argv[2]).cleanup()
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--candidate-digest", required=True)
    parser.add_argument("--previous-sha", required=True)
    parser.add_argument("--previous-id", required=True)
    parser.add_argument("--auth-directory", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    identity(args.candidate_sha, args.candidate_digest)
    identity(args.previous_sha, args.previous_id)
    require(not args.auth_directory.exists(), "Registry authentication must be removed before execution")
    require(os.environ.get("GITHUB_ACTIONS") == "true", "Runner-only verification")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="release-preflight-") as logs:
        check = Verification(logs, args.state)
        try:
            candidate_ref = REPOSITORY + ":" + args.candidate_sha
            previous_ref = REPOSITORY + ":" + args.previous_sha
            candidate = image_identity(json.loads(check.docker("image", "inspect", candidate_ref))[0], args.candidate_digest)
            previous = image_identity(json.loads(check.docker("image", "inspect", previous_ref))[0], expected_id=args.previous_id)
            postgres = json.loads(check.docker("image", "inspect", "postgres:17-alpine"))[0]["Id"]
            receipt = check.run(candidate, previous, postgres)
            receipt.update({"candidateSha": args.candidate_sha, "candidateDigest": args.candidate_digest,
                            "candidateImageId": candidate, "previousSha": args.previous_sha,
                            "previousImageId": previous, "postgresImageId": postgres})
        finally:
            check.cleanup()
        receipt["ownedResourcesRemoved"] = True
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        raise SystemExit("Release preflight failed: " + str(error) + "; no production action was performed.")
