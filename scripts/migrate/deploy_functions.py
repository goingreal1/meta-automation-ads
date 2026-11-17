#!/usr/bin/env python3
"""Deploy edge functions from supabase/functions to a project via the Management API.
   Usage: deploy_functions.py <project_ref> <flags.json> [slug ...]   (no slugs = every function in flags.json that exists in the repo)
   Auth: Authorization header is 'Bearer proxy-injected' (the sandbox proxy substitutes the real token).
   _shared imports (../_shared/x.ts) are included as extra files and the import path is rewritten."""
import json, os, re, subprocess, sys, tempfile
ref, flags_path, *slugs = sys.argv[1:]
flags = json.load(open(flags_path))
FN = "supabase/functions"
def flag(slug):
    f = flags.get(slug) if isinstance(flags, dict) else next((x for x in flags if x.get("slug") == slug), {})
    return f or {}
def deploy(slug):
    d = os.path.join(FN, slug)
    files = {}
    for root, _, names in os.walk(d):
        for n in names:
            p = os.path.join(root, n); files[os.path.relpath(p, d)] = open(p, "rb").read()
    shared = {}
    for name, data in list(files.items()):
        if name.endswith(".ts"):
            txt = data.decode()
            for m in set(re.findall(r'["\']\.\./_shared/([\w./-]+)["\']', txt)):
                shared[m] = open(os.path.join(FN, "_shared", m), "rb").read()
                txt = txt.replace("../_shared/" + m, "./_shared/" + m)
            files[name] = txt.encode()
    for m, data in shared.items(): files["_shared/" + m] = data
    meta = {"entrypoint_path": "index.ts", "name": slug, "verify_jwt": bool(flag(slug).get("verify_jwt", True))}
    if "deno.json" in files: meta["import_map_path"] = "deno.json"
    tmp = tempfile.mkdtemp(); args = ["curl", "-sS", "-X", "POST", f"https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={slug}",
        "-H", "Authorization: Bearer proxy-injected", "-F", "metadata=" + json.dumps(meta)]
    for name, data in files.items():
        p = os.path.join(tmp, name.replace("/", "__")); open(p, "wb").write(data)
        args += ["-F", f"file=@{p};filename={name}"]
    out = subprocess.run(args, capture_output=True, text=True).stdout
    ok = '"status"' in out and 'ACTIVE' in out or '"id"' in out
    print(("OK  " if ok else "FAIL"), slug, meta["verify_jwt"], out[:200] if not ok else "")
    return ok
if not slugs:
    slugs = sorted(s for s in (flags if isinstance(flags, dict) else [x["slug"] for x in flags]) if os.path.isdir(os.path.join(FN, s)))
for s in slugs: deploy(s)
