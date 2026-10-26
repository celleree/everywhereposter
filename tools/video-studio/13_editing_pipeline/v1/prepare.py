"""Manifest-driven preparation; preserves approved aligned audio without DSP."""
import argparse,subprocess,sys,json
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--output',required=True);parser.add_argument('--runtime',required=True)
a=parser.parse_args()
try:
 runtime=json.loads(Path(a.runtime).read_text());node=runtime['nodeExecutable']
 result=subprocess.run([node,str(Path(__file__).with_name('owned-input.mjs')),str(Path(a.manifest).resolve()),str(Path(a.output).resolve()),str(Path(a.runtime).resolve())]);sys.exit(result.returncode)
except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
