#!/usr/bin/env python3
"""Point the whole site and docs at a NEW Supabase project.

  python3 scripts/migrate/swap-supabase.py <NEW_PROJECT_REF> <NEW_ANON_KEY>            # dry run: shows what would change
  python3 scripts/migrate/swap-supabase.py <NEW_PROJECT_REF> <NEW_ANON_KEY> --write    # rewrites the files

Replaces the old project address (https://rrkhkhgdxhmogxxtbvyt.supabase.co and the bare ref) and the old public (anon) key
in html, js, json, toml and md files. It never touches node_modules, .git or supabase/schema (those use __SUPABASE_URL__ placeholders).
"""
import os, re, sys
OLD_REF = "rrkhkhgdxhmogxxtbvyt"
def old_anon(root):
    s = open(os.path.join(root, "login.html"), encoding="utf-8").read()
    m = re.search(r'const ANON\s*=\s*"([^"]+)"', s)
    return m.group(1) if m else None
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    if len(args) != 2 or not re.fullmatch(r"[a-z0-9]{20}", args[0]):
        sys.exit(__doc__)
    new_ref, new_anon = args
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    anon_old = old_anon(root)
    total = 0
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in (".git", "node_modules", ".vercel") and not dp.endswith("supabase/schema")]
        for f in fn:
            if not f.endswith((".html", ".js", ".json", ".toml", ".md", ".ts")) or f == "package-lock.json":
                continue
            p = os.path.join(dp, f)
            try: s = open(p, encoding="utf-8").read()
            except Exception: continue
            n = s.replace(OLD_REF, new_ref)
            if anon_old and new_anon != anon_old: n = n.replace(anon_old, new_anon)
            if n != s:
                hits = s.count(OLD_REF) + (s.count(anon_old) if anon_old else 0)
                total += hits
                print(("rewrote " if write else "would change ") + os.path.relpath(p, root) + f"  ({hits})")
                if write: open(p, "w", encoding="utf-8").write(n)
    print(f"\n{total} replacement(s) in total." + ("" if write else "  (dry run: add --write to apply)"))
if __name__ == "__main__": main()
