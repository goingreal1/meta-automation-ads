#!/usr/bin/env python3
"""Copy the production source (extracted bundles in <src_dir>/x_<slug>/) over supabase/functions/, in the standard layout:
   supabase/functions/<slug>/...  and shared helpers in supabase/functions/_shared/.   Usage: adopt_prod.py <src_dir> <slugs.txt>"""
import os, sys, shutil
src, slugs = sys.argv[1], open(sys.argv[2]).read().split()
FN = "supabase/functions"; changed = []; skipped = []
for slug in slugs:
    root = os.path.join(src, "x_" + slug)
    if not os.path.isdir(root): skipped.append(slug); continue
    files = {}
    for dp, _, fns in os.walk(root):
        for f in fns:
            p = os.path.join(dp, f); files[os.path.relpath(p, root)] = open(p, "rb").read()
    entry = next((e for e in ("index.ts", slug + "/index.ts", "source/index.ts") if e in files), None)
    if not entry: skipped.append(slug); continue
    base = os.path.dirname(entry)
    fdir = os.path.join(FN, slug); os.makedirs(fdir, exist_ok=True)
    for rel, data in files.items():
        if base and rel.startswith(base + "/"): dest = os.path.join(fdir, rel[len(base) + 1:])
        elif not base and "/" not in rel: dest = os.path.join(fdir, rel)
        elif rel.startswith("_shared/") or rel.startswith("source/_shared/"): dest = os.path.join(FN, "_shared", rel.split("_shared/", 1)[1])
        elif not base and rel.endswith("deno.json"): dest = os.path.join(fdir, "deno.json")
        else: dest = os.path.join(fdir, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        old = open(dest, "rb").read() if os.path.exists(dest) else None
        if old != data: open(dest, "wb").write(data); changed.append(dest)
print("changed", len(changed), "skipped", skipped)
