#!/usr/bin/env python3
"""Stamp a content-hash cache-buster onto the dashboard.js <script> in index.html.

Static GitHub Pages can't set Cache-Control on its assets, so a returning
visitor can load fresh index.html but keep an old cached js/dashboard.js —
a version mismatch. Appending ?v=<hash> to the script src makes the URL
change whenever the file's contents change, so the browser fetches the new
JS immediately, while still caching it between deploys.

Stdlib only.

Usage:
  python scripts/stamp_version.py           # rewrite index.html in place
  python scripts/stamp_version.py --check    # exit 1 if the stamp is stale (CI)
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
JS = ROOT / "js" / "dashboard.js"
# matches  <script src="js/dashboard.js"  with an optional existing ?v=...
TAG = re.compile(r'(<script\s+src="js/dashboard\.js)(\?v=[0-9a-f]+)?(")')


def short_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def main():
    check = "--check" in sys.argv[1:]
    if not JS.exists() or not HTML.exists():
        sys.exit("stamp_version: missing index.html or js/dashboard.js")
    html = HTML.read_text(encoding="utf-8")
    m = TAG.search(html)
    if not m:
        sys.exit('stamp_version: could not find the <script src="js/dashboard.js"> tag')
    want = f"?v={short_hash(JS)}"
    current = m.group(2) or ""

    if check:
        if current != want:
            print(f"stamp_version: cache-buster is stale (have {current or 'none'}, want {want}).")
            print("Run: python scripts/stamp_version.py")
            sys.exit(1)
        print(f"OK: cache-buster up to date ({want})")
        return

    if current == want:
        print(f"unchanged ({want})")
        return
    HTML.write_text(TAG.sub(rf"\g<1>{want}\g<3>", html), encoding="utf-8")
    print(f"stamped js/dashboard.js{want}")


if __name__ == "__main__":
    main()
