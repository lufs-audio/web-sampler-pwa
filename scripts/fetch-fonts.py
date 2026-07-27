#!/usr/bin/env python3
"""Refresh the self-hosted font snapshot (web/fonts.b64.json).

DEV-TIME ONLY. The production build never touches the network: scripts/build
decodes the committed base64 snapshot into real .woff2 files. That keeps the
artifact's `external_origins: []` claim true and the PWA genuinely offline
(website-portability 02: snapshot and digest your build inputs; don't fetch
"whatever is current" during a production build).

Run this only when the type stack changes, then commit the regenerated JSON.

Usage: python3 scripts/fetch-fonts.py [out=web/fonts.b64.json]
"""
import base64, hashlib, json, os, re, sys, urllib.request

# A modern-Chrome UA is required: the CSS API serves woff2 only to browsers that
# advertise support. With a default UA you silently get legacy TTF.
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

FAMILIES = [
    "Host+Grotesk:wght@400;500;600;700;800",
    "Public+Sans:wght@300;400;500;600;800",
    "Space+Mono:wght@400;700",
]

# Google's opaque hashed filenames -> stable names the CSS references.
NAMES = {
    "Host Grotesk": lambda w: "host-grotesk-var-latin.woff2",
    "Public Sans": lambda w: "public-sans-var-latin.woff2",
    "Space Mono": lambda w: "space-mono-%s-latin.woff2" % w,
}


def get(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30
    ).read()


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "web/fonts.b64.json"
    fonts, seen = {}, set()

    for fam in FAMILIES:
        css = get("https://fonts.googleapis.com/css2?family=%s&display=swap" % fam).decode()
        for blk in re.findall(r"@font-face \{[^}]+\}", css):
            # latin subset only — the app is English-only; the other subsets
            # would triple the payload for glyphs nothing renders.
            if "U+0000-00FF" not in blk:
                continue
            url = re.search(r"src: url\((https://[^)]+\.woff2)\)", blk)
            name = re.search(r"font-family: '([^']+)'", blk)
            weight = re.search(r"font-weight: ([^;]+);", blk)
            if not (url and name and weight):
                raise SystemExit("fetch-fonts: unparsable @font-face for %s" % fam)
            fname = NAMES[name.group(1)](weight.group(1).strip())
            if fname in seen:
                continue
            data = get(url.group(1))
            if data[:4] != b"wOF2":
                raise SystemExit("fetch-fonts: %s is not woff2 (bad UA?)" % fname)
            fonts[fname] = {
                "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data),
                "b64": base64.b64encode(data).decode(),
            }
            seen.add(fname)

    missing = {"host-grotesk-var-latin.woff2", "public-sans-var-latin.woff2",
               "space-mono-400-latin.woff2", "space-mono-700-latin.woff2"} - seen
    if missing:
        raise SystemExit("fetch-fonts: missing expected faces: %s" % sorted(missing))

    doc = {
        "_comment": (
            "Snapshotted Google Fonts latin subsets, base64. Source of truth for the "
            "self-hosted webfonts; scripts/build decodes these to real .woff2 so the "
            "artifact has ZERO external origins and the PWA is genuinely offline. "
            "Regenerate with scripts/fetch-fonts.py."
        ),
        "fonts": fonts,
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    total = sum(f["bytes"] for f in fonts.values())
    print("wrote %s — %d faces, %d bytes" % (out_path, len(fonts), total))
    for k, v in sorted(fonts.items()):
        print("  %-32s %6d  %s" % (k, v["bytes"], v["sha256"][:16]))


if __name__ == "__main__":
    main()
