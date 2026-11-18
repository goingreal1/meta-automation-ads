// Sends uploads for the big public buckets to Cloudflare R2 instead of Supabase Storage, without changing the calling code.
//   const admin = withR2(createClient(url, key));   then  admin.storage.from("creative-vault").upload(path, bytes, opts)  and  .getPublicUrl(path)
// work as before but the file lands in R2 (key = "<bucket>/<path>") and getPublicUrl returns the R2 address.
// Reading and removing still work for files that were saved on Supabase earlier. If R2 is not configured nothing changes.
import { AwsClient } from "npm:aws4fetch@1.0.20";

const ACC = Deno.env.get("R2_ACCOUNT_ID") ?? "", BKT = Deno.env.get("R2_BUCKET") ?? "";
let PUB = (Deno.env.get("R2_PUBLIC_URL") ?? "").trim().replace(/\/+$/, "");
if (PUB && !/^https?:\/\//.test(PUB)) PUB = "https://" + PUB;
export const R2_ON = !!(ACC && BKT && PUB && Deno.env.get("R2_ACCESS_KEY_ID") && Deno.env.get("R2_SECRET_ACCESS_KEY"));
const aws = R2_ON ? new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!, secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!, service: "s3", region: "auto" }) : null;
const enc = (k: string) => k.split("/").map(encodeURIComponent).join("/");
const objUrl = (k: string) => `https://${ACC}.r2.cloudflarestorage.com/${BKT}/${enc(k)}`;
export const r2PublicUrl = (k: string) => `${PUB}/${enc(k)}`;
export const r2PublicBase = () => PUB;
/** The R2 object key for one of our public R2 links, or null if the link is not ours. */
export const r2KeyFromUrl = (url: string): string | null => (PUB && url.startsWith(PUB + "/")) ? decodeURIComponent(url.slice(PUB.length + 1).split("?")[0]) : null;
export async function r2Delete(key: string) { if (aws) await aws.fetch(objUrl(key), { method: "DELETE" }).catch(() => {}); }

const BUCKETS = new Set(["creative-vault", "site-media", "social-media"]);

export function withR2<T extends { storage: any }>(client: T): T {
  if (!R2_ON) return client;
  const origFrom = client.storage.from.bind(client.storage);
  client.storage.from = (bucket: string) => {
    const orig = origFrom(bucket);
    if (!BUCKETS.has(bucket)) return orig;
    const key = (p: string) => `${bucket}/${String(p).replace(/^\/+/, "")}`;
    return new Proxy(orig, {
      get(target: any, prop: string) {
        if (prop === "upload") return async (path: string, body: any, opts: any = {}) => {
          try {
            let data: Uint8Array;
            if (body instanceof Uint8Array) data = body;
            else if (body instanceof ArrayBuffer) data = new Uint8Array(body);
            else if (body && typeof body.arrayBuffer === "function") data = new Uint8Array(await body.arrayBuffer());
            else data = new TextEncoder().encode(String(body));
            const r = await aws!.fetch(objUrl(key(path)), { method: "PUT", body: data, headers: { "content-type": opts.contentType || "application/octet-stream", "cache-control": `public, max-age=${Number(opts.cacheControl) || 31536000}` } });
            if (!r.ok) return { data: null, error: { message: `Storage error (${r.status})` } };
            return { data: { path, id: key(path), fullPath: key(path) }, error: null };
          } catch (e) { return { data: null, error: { message: String((e as Error)?.message ?? e) } }; }
        };
        if (prop === "getPublicUrl") return (path: string) => ({ data: { publicUrl: r2PublicUrl(key(path)) } });
        if (prop === "remove") return async (paths: string[]) => {
          await Promise.all(paths.map((p) => r2Delete(key(p))));
          return await target.remove(paths).catch(() => ({ data: [], error: null }));
        };
        return target[prop];
      },
    });
  };
  return client;
}
