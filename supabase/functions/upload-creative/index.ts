import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const primaryText = (formData.get('primary_text') as string) || null;
    const headline = (formData.get('headline') as string) || null;
    const description = (formData.get('description') as string) || null;
    const mechanism = (formData.get('mechanism') as string) || null;
    const format = (formData.get('format') as string) || null;
    const ctaType = (formData.get('cta_type') as string) || 'SHOP_NOW';
    const uploadedBy = (formData.get('uploaded_by') as string) || null;
    const adAccountId = formData.get('ad_account_id') as string;
    const productId = (formData.get('product_id') as string) || null;
    const launchAt = (formData.get('launch_at') as string) || null;
    let assetType = formData.get('asset_type') as string;

    if (!file || !adAccountId) {
      return new Response(
        JSON.stringify({ error: 'Missing file or ad_account_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    if (!assetType) {
      assetType = file.type.startsWith('video/') ? 'video' : 'image';
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: `Invalid file type: ${file.type}` }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Generate a unique storage path (kept distinct from the human-readable file_name column)
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeStem = file.name.replace(/[^a-z0-9.]/gi, '-');
    const filename = `${timestamp}-${random}-${safeStem}`;
    const bucketPath = `creative-assets/${assetType}s/${filename}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { data: storageData, error: storageError } = await supabase.storage
      .from('creative-vault')
      .upload(bucketPath, new Uint8Array(arrayBuffer), {
        contentType: file.type,
        upsert: false,
      });

    if (storageError) {
      console.error('Storage upload error:', storageError);
      return new Response(
        JSON.stringify({ error: `Storage error: ${storageError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('creative-vault')
      .getPublicUrl(bucketPath);

    const fileUrl = urlData?.publicUrl ?? '';

    // Insert into creative_assets table (columns must match the live schema exactly —
    // this previously wrote asset_name/file_url/status/test_count, none of which exist)
    const { data: creativeData, error: dbError } = await supabase
      .from('creative_assets')
      .insert({
        file_name: file.name,
        storage_path: bucketPath,
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
        uploaded_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (dbError) {
      console.error('Database insert error:', dbError);
      return new Response(
        JSON.stringify({ error: `Database error: ${dbError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        asset: creativeData,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      }
    );

  } catch (err: any) {
    console.error('Upload error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
