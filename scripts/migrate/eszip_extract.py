#!/usr/bin/env python3
"""Pull the original source files (source/*.ts, deno.json ...) out of a Supabase edge function bundle (ESZIP2.x).
   Usage: eszip_extract.py <bundle.bin> <out_dir>        Only files under source/ are written."""
import struct, sys, os
def parse(b):
    assert b[:5] == b"ESZIP", "not an eszip bundle"
    ver = b[5:8].decode()                      # 2.3
    pos = 8
    def u32():
        nonlocal pos; v = struct.unpack(">I", b[pos:pos+4])[0]; pos += 4; return v
    if ver >= "2.3":                           # options header: length, options, hash
        n = u32(); pos += n
    hlen = u32(); hend = pos + hlen
    mods = []
    while pos < hend:
        sl = u32(); spec = b[pos:pos+sl].decode("utf-8", "replace"); pos += sl
        kind = b[pos]; pos += 1
        if kind == 0:                          # module
            so, ss, mo, ms = struct.unpack(">IIII", b[pos:pos+16]); pos += 16
            pos += 1                           # module kind
            mods.append((spec, so, ss))
        elif kind == 1:                        # redirect
            tl = u32(); pos += tl
        else:                                  # npm specifier
            pos += 4
    pos = hend                                 # npm snapshot block, then the sources block
    nl = u32(); pos += nl
    slen = u32(); sbase = pos
    out = {}
    for spec, so, ss in mods:
        schemeless = "://" not in spec and ":" not in spec.split("/")[0] and not spec.startswith("-") and spec.endswith((".ts", ".js", ".mjs", ".tsx", ".json"))
        if spec.startswith("file:///src/") or spec.startswith("source/") or "/source/" in spec or schemeless:
            out[spec] = b[sbase+so:sbase+so+ss]
    return out
if __name__ == "__main__":
    data = open(sys.argv[1], "rb").read(); files = parse(data)
    for spec, content in files.items():
        # Path relative to the bundle root: "source/index.ts" -> "index.ts"; nested bundles keep their folders ("source/source/index.ts" -> "source/index.ts", "source/_shared/x.ts" -> "_shared/x.ts").
        name = spec.split("file:///src/", 1)[1] if spec.startswith("file:///src/") else (spec[len("source/"):] if spec.startswith("source/") else spec.split("/source/", 1)[-1])
        p = os.path.join(sys.argv[2], name); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "wb").write(content); print("wrote", name, len(content))
