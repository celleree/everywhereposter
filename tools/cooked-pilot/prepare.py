"""Prepare a new local-only build context from reviewed, already downloaded inputs."""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path

PIN = 'bce911c1d0652f30b64fd5283cc4aa9fa92811c9'
MODEL = {
 'model.bin':'dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1',
 'config.json':'a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8',
 'tokenizer.json':'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
 'vocabulary.txt':'34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
}

def prepare(upstream, model, wheels, context, recipe):
    upstream, model, wheels, context, recipe = map(Path, (upstream, model, wheels, context, recipe))
    assert subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip() == PIN, 'UPSTREAM_PIN'
    subprocess.run(['git','-C',str(upstream),'diff','--quiet','HEAD','--'],check=True)
    assert all((model / name).is_file() and not (model / name).is_symlink() and hashlib.sha256((model / name).read_bytes()).hexdigest() == digest for name,digest in MODEL.items()), 'MODEL_HASH'
    assert not context.exists(), 'CONTEXT_MUST_BE_NEW'
    context.mkdir(mode=0o700,parents=False)
    source=context/'upstream'
    files=subprocess.check_output(['git','-C',str(upstream),'ls-files'],text=True).splitlines()
    selected=[name for name in files if name.startswith(('plugins/ai-editor/lib/ai_editor/','plugins/ai-editor/skills/cut/scripts/')) and Path(name).suffix in ('.py','.html','.js')]
    selected += [name for name in files if name.startswith('plugins/ai-editor/presets/captions/') and Path(name).suffix=='.json']
    selected += ['LICENSE','plugins/ai-editor/skills/style-edit/scripts/plan.py','plugins/ai-editor/skills/style-edit/scripts/export_nle.py']
    manifest={}
    for name in selected:
        original=upstream/name
        assert original.is_file() and not original.is_symlink(), 'REGULAR_SOURCE_REQUIRED'
        target=source/name;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(original,target)
        manifest[name]=hashlib.sha256(target.read_bytes()).hexdigest()
    (context/'model').mkdir()
    for name in MODEL:shutil.copyfile(model/name,context/'model'/name)
    shutil.copytree(wheels,context/'wheels')
    for name in ('Dockerfile','requirements.lock','worker-smoke.py','MODEL-NOTICES.md'):
        shutil.copyfile(recipe/name,context/name)
    (context/'source-manifest.json').write_text(json.dumps({'upstream':PIN,'modelRepositoryRevision':'d90ca5fe260221311c53c58e660288d3deb8d356','modelFiles':MODEL,'sourceFiles':manifest},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--upstream',required=True);p.add_argument('--model',required=True);p.add_argument('--wheels',required=True);p.add_argument('--context',required=True)
    a=p.parse_args();prepare(a.upstream,a.model,a.wheels,a.context,Path(__file__).parent)
