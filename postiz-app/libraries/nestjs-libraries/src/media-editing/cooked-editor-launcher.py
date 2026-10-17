"""Linux boundary launcher: constrain inherited CPU affinity before native execution."""
import os
import runpy
import sys

if not hasattr(os, "sched_setaffinity"):
    raise RuntimeError("Linux CPU affinity is required")
allowed = sorted(os.sched_getaffinity(0))
if not allowed:
    raise RuntimeError("No allowed CPUs")
os.sched_setaffinity(0, set(allowed[:2]))
sys.argv = sys.argv[1:]
sys.path.insert(0, os.path.dirname(os.path.abspath(sys.argv[0])))
runpy.run_path(sys.argv[0], run_name="__main__")
