#!/usr/bin/env python3
"""Render Cloudflare Pages adapter files from the neutral site/ manifests.

website-portability 01: `routes.txt`, `redirects.yaml`, and `headers.yaml` are the
authoritative, host-neutral intent. Platform files (_headers, _redirects) are
GENERATED adapter output — never the source of truth, never hand-edited.

Deliberately stdlib-only (no PyYAML): these manifests use a tiny, fixed subset of
YAML, and the sites must build on a runner with nothing but python3 + coreutils.
The parser below FAILS on syntax it does not understand rather than silently
dropping a rule — a weakened header is the same lie as a green build that shipped
the wrong bytes.

Usage: python3 scripts/render-adapters.py <out-dir> [site-dir]
"""
import sys, os, json

class ManifestError(Exception):
    pass


def _strip(line):
    """Remove a trailing comment that is not inside quotes."""
    out, q = [], None
    for i, ch in enumerate(line):
        if q:
            out.append(ch)
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
            out.append(ch)
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        else:
            out.append(ch)
    return "".join(out).rstrip()


def _unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def parse_blocks(path, key):
    """Parse `key: []` or a list of single/nested-mapping items.

    Returns a list of dicts. Nested one-level mappings (e.g. `values:`) become
    a dict value. Anything else raises — no silent downgrade.
    """
    if not os.path.exists(path):
        raise ManifestError("missing manifest: %s" % path)
    lines = []
    for raw in open(path, encoding="utf-8").read().splitlines():
        s = _strip(raw)
        if s.strip():
            lines.append(s)

    if not lines:
        raise ManifestError("%s: empty manifest" % path)

    head = lines[0]
    if not head.startswith(key + ":"):
        raise ManifestError("%s: expected top-level key %r, got %r" % (path, key, head))
    rest = head[len(key) + 1:].strip()
    if rest in ("[]", "[ ]"):
        if len(lines) > 1:
            raise ManifestError("%s: %s declared empty but has entries" % (path, key))
        return []
    if rest:
        raise ManifestError("%s: inline value for %s unsupported: %r" % (path, key, rest))

    items, cur, nest = [], None, None
    for ln in lines[1:]:
        indent = len(ln) - len(ln.lstrip())
        body = ln.strip()
        if body.startswith("- "):
            if cur is not None:
                items.append(cur)
            cur, nest = {}, None
            body = body[2:].strip()
            if ":" not in body:
                raise ManifestError("%s: list item is not a mapping: %r" % (path, ln))
            k, v = body.split(":", 1)
            cur[k.strip()] = _unquote(v)
            base_indent = indent
        elif cur is None:
            raise ManifestError("%s: content before first list item: %r" % (path, ln))
        else:
            if ":" not in body:
                raise ManifestError("%s: unparsable line: %r" % (path, ln))
            k, v = body.split(":", 1)
            k, v = k.strip(), v.strip()
            if v == "":
                nest = k
                cur[k] = {}
            elif nest and indent > base_indent + 2:
                cur[nest][k] = _unquote(v)
            else:
                nest = None
                cur[k] = _unquote(v)
    if cur is not None:
        items.append(cur)
    return items


def header_values(entry, path):
    """Accept both shapes in use across the repos:
       - {path, values: {H: v}}          (contract 01 canonical)
       - {path, cache_control: "..."}    (shorthand)
    """
    if "path" not in entry:
        raise ManifestError("%s: header entry missing 'path': %r" % (path, entry))
    vals = {}
    for k, v in entry.items():
        if k == "path":
            continue
        if k == "values":
            if not isinstance(v, dict):
                raise ManifestError("%s: 'values' must be a mapping" % path)
            vals.update(v)
        elif k == "cache_control":
            vals["Cache-Control"] = v
        else:
            raise ManifestError(
                "%s: unsupported header field %r (add it to the renderer "
                "rather than dropping it)" % (path, k)
            )
    if not vals:
        raise ManifestError("%s: header entry for %s has no values" % (path, entry["path"]))
    return vals


def render(site_dir, out_dir):
    hpath = os.path.join(site_dir, "headers.yaml")
    rpath = os.path.join(site_dir, "redirects.yaml")

    headers = parse_blocks(hpath, "headers")
    redirects = parse_blocks(rpath, "redirects")

    written = []

    # _headers — Cloudflare Pages / Netlify format.
    lines = [
        "# GENERATED from site/headers.yaml by scripts/render-adapters.py.",
        "# Do not edit: the neutral manifest is the source of truth.",
        "",
    ]
    for e in headers:
        lines.append(e["path"])
        for k, v in header_values(e, hpath).items():
            lines.append("  %s: %s" % (k, v))
        lines.append("")
    hout = os.path.join(out_dir, "_headers")
    open(hout, "w", encoding="utf-8").write("\n".join(lines).rstrip() + "\n")
    written.append(("_headers", len(headers)))

    # _redirects — only emitted when there is intent to express.
    if redirects:
        rl = [
            "# GENERATED from site/redirects.yaml by scripts/render-adapters.py.",
            "# Do not edit: the neutral manifest is the source of truth.",
            "",
        ]
        for e in redirects:
            for req in ("from", "to"):
                if req not in e:
                    raise ManifestError("%s: redirect missing %r: %r" % (rpath, req, e))
            status = e.get("status", "301")
            frm = e["from"]
            if str(e.get("preserve_query", "")).lower() in ("true", "yes"):
                # Cloudflare preserves the query string by default; splat/placeholder
                # rules are the only way to reshape it. Assert the default rather
                # than pretending we rewrote anything.
                pass
            rl.append("%s  %s  %s" % (frm, e["to"], status))
        rout = os.path.join(out_dir, "_redirects")
        open(rout, "w", encoding="utf-8").write("\n".join(rl).rstrip() + "\n")
        written.append(("_redirects", len(redirects)))

    return written


def main():
    if len(sys.argv) < 2:
        print("usage: render-adapters.py <out-dir> [site-dir]", file=sys.stderr)
        return 2
    out_dir = sys.argv[1]
    site_dir = sys.argv[2] if len(sys.argv) > 2 else "site"
    if not os.path.isdir(out_dir):
        print("render-adapters: no such out dir: %s" % out_dir, file=sys.stderr)
        return 1
    try:
        written = render(site_dir, out_dir)
    except ManifestError as e:
        # Fail on unsupported semantics instead of silently weakening them (01).
        print("render-adapters: FAILED — %s" % e, file=sys.stderr)
        return 2
    for name, n in written:
        print("  rendered %s/%s (%d rules)" % (out_dir, name, n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
