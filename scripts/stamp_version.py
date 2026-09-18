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
# Every script the page loads gets its own stamp; fare-data.js carries the
# parsing rules, so shipping a stale cached copy of it is exactly as bad as
# shipping a stale dashboard.js.
SCRIPTS = ["js/fare-data.js", "js/dashboard.js"]


def tag_re(src):
    """matches  <script src="<src>"  with an optional existing ?v=..."""
    return re.compile(r'(<script\s+src="' + re.escape(src) + r')(\?v=[0-9a-f]+)?(")')


def short_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def main():
    check = "--check" in sys.argv[1:]
    if not HTML.exists():
        sys.exit("stamp_version: missing index.html")
    html = HTML.read_text(encoding="utf-8")
    stale, stamped = [], []

    for src in SCRIPTS:
        js = ROOT / src
        if not js.exists():
            sys.exit(f"stamp_version: missing {src}")
        rx = tag_re(src)
        m = rx.search(html)
        if not m:
            sys.exit(f'stamp_version: could not find the <script src="{src}"> tag')
        want = f"?v={short_hash(js)}"
        current = m.group(2) or ""
        if current == want:
            continue
        if check:
            stale.append((src, current or "none", want))
        else:
            html = rx.sub(rf"\g<1>{want}\g<3>", html)
            stamped.append(src + want)

    if check:
        if stale:
            for src, have, want in stale:
                print(f"stamp_version: {src} cache-buster is stale (have {have}, want {want}).")
            print("Run: python scripts/stamp_version.py")
            sys.exit(1)
        print("OK: cache-busters up to date for " + ", ".join(SCRIPTS))
        return

    if not stamped:
        print("unchanged")
        return
    HTML.write_text(html, encoding="utf-8")
    print("stamped " + ", ".join(stamped))


if __name__ == "__main__":
    main()
