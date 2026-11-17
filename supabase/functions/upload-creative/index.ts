import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function getCaller(req, admin) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) return {
    service: true,
    company_id: null,
    role: null
  };
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id, role").eq("id", data.user.id).maybeSingle();
  if (!p?.company_id) return null;
  return {
    service: false,
    company_id: p.company_id,
    role: p.role
  };
}
Deno.serve(async (req)=>{
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const caller = await getCaller(req, supabase);
    if (!caller) {
      return new Response(JSON.stringify({
        error: 'Not signed in'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get('file');
    const primaryText = formData.get('primary_text') || null;
    const headline = formData.get('headline') || null;
    const creativeName = String(formData.get('creative_name') || '').trim().slice(0, 120) || null;
    const description = formData.get('description') || null;
    const mechanism = formData.get('mechanism') || null;
    const format = formData.get('format') || null;
    const ctaType = formData.get('cta_type') || 'SHOP_NOW';
    const uploadedBy = formData.get('uploaded_by') || null;
    const adAccountId = formData.get('ad_account_id');
    const productId = formData.get('product_id') || null;
    const launchAt = formData.get('launch_at') || null;
    let assetType = formData.get('asset_type');
    if (!file || !adAccountId) {
      return new Response(JSON.stringify({
        error: 'Missing file or ad_account_id'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    if (!assetType) {
      assetType = file.type.startsWith('video/') ? 'video' : 'image';
    }
    // Validate file type
    const validTypes = [
      'video/mp4',
      'video/quicktime',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];
    if (!validTypes.includes(file.type)) {
      return new Response(JSON.stringify({
        error: `Invalid file type: ${file.type}`
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    // Generate a unique storage path (kept distinct from the human-readable file_name column)
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeStem = file.name.replace(/[^a-z0-9.]/gi, '-');
    const filename = `${timestamp}-${random}-${safeStem}`;
    const bucketPath = `creative-assets/${assetType}s/${filename}`;
    // Tenant check: the ad account (and product, if given) must belong to the caller's company.
    const { data: ownAcct } = await supabase.from('ad_accounts').select('company_id').eq('id', adAccountId).maybeSingle();
    if (!ownAcct || !caller.service && ownAcct.company_id !== caller.company_id) {
      return new Response(JSON.stringify({
        error: 'Ad account not found'
      }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    if (productId) {
      const { data: ownProd } = await supabase.from('products').select('company_id').eq('id', productId).maybeSingle();
      if (!ownProd || !caller.service && ownProd.company_id !== caller.company_id) {
        return new Response(JSON.stringify({
          error: 'Product not found'
        }), {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    // Upload to Cloudflare R2 (big media lives there, not in Supabase Storage). Falls back to the old bucket only if R2 is not configured.
    const arrayBuffer = await file.arrayBuffer();
    let fileUrl = '';
    let storageProvider = 'supabase';
    let storedPath = bucketPath;
    const R2_ACCOUNT = Deno.env.get('R2_ACCOUNT_ID') ?? '', R2_BUCKET = Deno.env.get('R2_BUCKET') ?? '';
    let R2_PUBLIC = (Deno.env.get('R2_PUBLIC_URL') ?? '').trim().replace(/\/+$/, '');
    if (R2_PUBLIC && !/^https?:\/\//.test(R2_PUBLIC)) R2_PUBLIC = 'https://' + R2_PUBLIC;
    if (R2_ACCOUNT && R2_BUCKET && R2_PUBLIC && Deno.env.get('R2_ACCESS_KEY_ID')) {
      const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
      const key = `creative-vault/${ownAcct.company_id}/${assetType}s/${filename}`;
      const put = await r2.fetch(`https://${R2_ACCOUNT}.r2.cloudflarestorage.com/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: new Uint8Array(arrayBuffer), headers: { 'content-type': file.type, 'cache-control': 'public, max-age=31536000' } });
      if (!put.ok) {
        console.error('R2 upload error:', put.status, (await put.text()).slice(0, 200));
        return new Response(JSON.stringify({ error: `Storage error (${put.status})` }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      fileUrl = `${R2_PUBLIC}/${key.split('/').map(encodeURIComponent).join('/')}`;
      storageProvider = 'r2'; storedPath = key;
    } else {
      const { error: storageError } = await supabase.storage.from('creative-vault').upload(bucketPath, new Uint8Array(arrayBuffer), { contentType: file.type, upsert: false });
      if (storageError) {
        console.error('Storage upload error:', storageError);
        return new Response(JSON.stringify({ error: `Storage error: ${storageError.message}` }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      fileUrl = supabase.storage.from('creative-vault').getPublicUrl(bucketPath).data?.publicUrl ?? '';
    }

    // Multi-tenancy (Phase 1): stamp which company this creative belongs to,
    // via the ad account it's being uploaded for -- adAccountId is always
    // present (checked above), so this is a reliable resolution path.
    const { data: adAccountRow } = await supabase.from('ad_accounts').select('company_id').eq('id', adAccountId).maybeSingle();
    if (!adAccountRow) {
      return new Response(JSON.stringify({
        error: 'Unknown ad_account_id'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    // Insert into creative_assets table (columns must match the live schema exactly —
    // this previously wrote asset_name/file_url/status/test_count, none of which exist)
    const { data: creativeData, error: dbError } = await supabase.from('creative_assets').insert({
      company_id: adAccountRow.company_id,
      file_name: file.name,
      storage_path: storedPath,
      storage_provider: storageProvider,
      display_name: creativeName,
      public_url: fileUrl,
      asset_type: assetType,
      mechanism: mechanism,
      format: format,
      primary_text: primaryText,
      headline: headline,
      description: description,
      cta_type: ctaType,
      uploaded_by: uploadedBy,
      ad_account_id: adAccountId,
      product_id: productId,
      launch_at: launchAt,
      test_status: 'untested',
      uploaded_at: new Date().toISOString()
    }).select('*').single();
    if (dbError) {
      console.error('Database insert error:', dbError);
      return new Response(JSON.stringify({
        error: `Database error: ${dbError.message}`
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    return new Response(JSON.stringify({
      success: true,
      asset: creativeData
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    return new Response(JSON.stringify({
      error: err.message || 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});
