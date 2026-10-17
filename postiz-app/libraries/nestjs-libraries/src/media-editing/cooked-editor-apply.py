"""Trusted boundary glue; all word/range edit decisions remain upstream."""
import json
from pathlib import Path
import sys

source_root, edit, request = map(Path, sys.argv[1:])
sys.path.insert(0, str(source_root / "plugins/ai-editor/lib"))
from ai_editor.review import apply_edits

edits = json.loads(request.read_text())
print(json.dumps(apply_edits(edit, edits.get("restore", []), edits.get("cut", []), edits.get("pause", []))))
