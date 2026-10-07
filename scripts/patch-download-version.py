from pathlib import Path
import re

root = Path("/root/apps/trimpro/.next")
n = 0
for p in root.rglob("*"):
    if not p.is_file():
        continue
    if "download" not in str(p).lower():
        continue
    if p.suffix not in {".html", ".rsc", ".js", ".json"}:
        continue
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    new = re.sub(r"1\.0\.(9|10|11|12|13|14|15)\b", "1.0.16", text)
    if new != text:
        p.write_text(new, encoding="utf-8")
        n += 1
        print("patched", p)
print("total", n)
