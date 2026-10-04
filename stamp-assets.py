#!/usr/bin/env python3
"""Give the page's script and stylesheet links a version from their contents (/app.js?v=1a2b3c4d).

Run this after changing public/app.js, public/site.js or public/style.css, before committing.
A browser then never pairs a new page with an old cached script (which leaves it stuck on "Loading...").
"""
import hashlib, pathlib, re

root = pathlib.Path(__file__).resolve().parent / "public"
page = root / "index.html"
html = page.read_text()
for name in ("style.css", "app.js", "site.js"):
    v = hashlib.sha256((root / name).read_bytes()).hexdigest()[:10]
    html, n = re.subn(r'"/' + re.escape(name) + r'(?:\?v=[0-9a-f]+)?"', '"/' + name + "?v=" + v + '"', html)
    if n != 1:
        raise SystemExit(f"expected one link to /{name} in index.html, found {n}")
    print(f"{name}: v={v}")
page.write_text(html)
