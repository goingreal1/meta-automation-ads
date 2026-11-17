/* Upload a file straight to Revora's media storage (Cloudflare R2).
   rvUpload(supabaseClient, "site-media", file) -> public https URL.
   Asks the `media` function for a short-lived signed link, then PUTs the file to R2 from the browser. */
(function () {
  window.rvUpload = async function (sb, folder, file) {
    var s = (await sb.auth.getSession()).data.session;
    if (!s) throw new Error("Please log in again.");
    var res = await fetch(sb.supabaseUrl + "/functions/v1/media", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token, apikey: sb.supabaseKey },
      body: JSON.stringify({ action: "sign", folder: folder, filename: file.name || "file", contentType: file.type || "application/octet-stream", size: file.size }),
    });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok || !j.uploadUrl) throw new Error(j.error || "Couldn't start the upload.");
    var put = await fetch(j.uploadUrl, { method: "PUT", headers: j.headers || { "Content-Type": file.type }, body: file });
    if (!put.ok) throw new Error("Upload failed (" + put.status + ").");
    return j.publicUrl;
  };
})();
