import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Uploads a product's own real photo (jar/bottle/package) -- distinct from
// upload-creative, which is ad content meant for Meta ads. This is the image
// the WhatsApp bot shows/sends to customers (warm-up message, order details).
// Stored under products/ in the same creative-vault bucket, separate from
// creative-assets/ so the two are never confused browsing Storage directly.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Caller must be the service role (internal) or a signed-in dashboard user --
// the public anon key alone is not enough.
type Caller = { service: boolean; company_id: string | null; role: string | null };
async function getCaller(req: Request, admin: ReturnType<typeof createClient>): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) return { service: true, company_id: null, role: null };
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id, role").eq("id", data.user.id).maybeSingle();
  if (!p?.company_id) return null;
  return { service: false, company_id: p.company_id, role: p.role };
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const caller = await getCaller(req, supabase);
    if (!caller) return json({ error: "Not signed in" }, 401);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const productId = formData.get("product_id") as string | null;
    // Defaults to the product's own photo; the Shop tab's ad-creative image
    // (falls back to this same photo when left blank) passes "ad_image_url"
    // instead -- same upload, same bucket, just a different column to save to.
    const targetField = (formData.get("field") as string | null) === "ad_image_url" ? "ad_image_url" : "product_image_url";

    if (!file || !productId) {
      return json({ error: "file and product_id are required." }, 400);
    }

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      return json({ error: `Invalid file type: ${file.type}. Use JPEG, PNG, or WEBP.` }, 400);
    }

    const { data: product, error: productErr } = await supabase
      .from("products")
      .select("id, company_id")
      .eq("id", productId)
      .maybeSingle();
    if (productErr || !product || (!caller.service && product.company_id !== caller.company_id)) {
      return json({ error: "Product not found." }, 404);
    }

    const timestamp = Date.now();
    const safeStem = file.name.replace(/[^a-z0-9.]/gi, "-");
    const bucketPath = `products/${productId}/${timestamp}-${safeStem}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: storageError } = await supabase.storage
      .from("creative-vault")
      .upload(bucketPath, new Uint8Array(arrayBuffer), { contentType: file.type, upsert: false });

    if (storageError) {
      return json({ error: `Storage error: ${storageError.message}` }, 500);
    }

    const { data: urlData } = supabase.storage.from("creative-vault").getPublicUrl(bucketPath);
    const publicUrl = urlData?.publicUrl ?? "";

    const { error: updateErr } = await supabase
      .from("products")
      .update({ [targetField]: publicUrl })
      .eq("id", productId);
    if (updateErr) {
      return json({ error: `Failed to save image URL: ${updateErr.message}` }, 500);
    }

    return json({ success: true, [targetField]: publicUrl });
  } catch (err: any) {
    console.error("upload-product-image error:", err);
    return json({ error: err.message }, 500);
  }
});
