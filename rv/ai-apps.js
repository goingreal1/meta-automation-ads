// Settings > AI apps: the AI assistants (ChatGPT, Claude...) connected to THIS person's Revora login, with Disconnect and install help.
// Each person sees and controls only their own connections. Talks to the `ai-connections` edge function.
(function () {
  var CONNECTOR_FALLBACK = "https://metaautomationads.vercel.app/mcp";
  function api(body) {
    return fetch(SUPA_URL + "/functions/v1/ai-connections", { method: "POST", headers: { Authorization: "Bearer " + (sessionData && sessionData.access_token || ""), "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { error: "Something went wrong." }; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .catch(function () { return { ok: false, j: { error: "Could not reach Revora. Check your connection." } }; });
  }
  function when(t) { return t ? new Date(t).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : ""; }
  function ago(t) {
    if (!t) return "not used yet";
    var s = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 1000));
    if (s < 90) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " days ago";
  }
  function installBlock(url) {
    var u = escH(url);
    return '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">' +
      '<div style="font-weight:600;font-size:13px;margin-bottom:6px;">Connect an AI app</div>' +
      '<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Add Revora as a connector in your AI app, then sign in with your Revora login when it asks. The app cannot be connected from here: you approve it inside the AI app.</div>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;"><code id="aiConnUrl" style="flex:1;min-width:0;overflow:auto;white-space:nowrap;background:var(--panel2);padding:7px 9px;border-radius:8px;font-size:12px;">' + u + '</code><button type="button" class="btn btn-g" id="aiCopyUrl" style="padding:6px 12px;font-size:11px;">Copy</button></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:230px;border:1px solid var(--border);border-radius:10px;padding:10px 12px;"><b style="font-size:12.5px;">ChatGPT</b><ol style="margin:6px 0 8px 16px;font-size:11.5px;color:var(--muted);line-height:1.5;"><li>Open Settings, then Connectors (turn on Developer mode if asked).</li><li>Create a connector, paste the address above, name it Revora.</li><li>Choose OAuth and sign in with your Revora login.</li></ol><a class="btn btn-a" style="padding:5px 12px;font-size:11px;text-decoration:none;display:inline-block;" href="https://chatgpt.com/#settings/Connectors" target="_blank" rel="noopener">Open ChatGPT settings</a></div>' +
      '<div style="flex:1;min-width:230px;border:1px solid var(--border);border-radius:10px;padding:10px 12px;"><b style="font-size:12.5px;">Claude</b><ol style="margin:6px 0 8px 16px;font-size:11.5px;color:var(--muted);line-height:1.5;"><li>Open Settings, then Connectors.</li><li>Add a custom connector, paste the address above, name it Revora.</li><li>Click Connect and sign in with your Revora login.</li></ol><a class="btn btn-a" style="padding:5px 12px;font-size:11px;text-decoration:none;display:inline-block;" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Open Claude connectors</a></div>' +
      '</div><div style="font-size:11px;color:var(--muted);margin-top:10px;">To reconnect an app you disconnected, add it again the same way. If an app stops working, disconnect it here and connect it again.</div></div>';
  }
  window.bvRenderAiApps = async function () {
    var el = document.getElementById("aiAppsPanel"); if (!el) return;
    el.innerHTML = '<div class="ph"><div class="ph-title">AI apps</div></div><div style="font-size:12px;color:var(--muted);">Loading…</div>';
    var r = await api({ action: "list" });
    if (!r.ok) { el.innerHTML = '<div class="ph"><div class="ph-title">AI apps</div></div><div class="msg err" style="display:block;">' + escH(r.j.error || "Could not load your connected apps.") + '</div>'; return; }
    var apps = r.j.apps || [], url = r.j.connector_url || CONNECTOR_FALLBACK;
    var list = apps.length ? apps.map(function (a) {
      return '<div style="display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;">' +
        '<div style="width:34px;height:34px;border-radius:9px;background:var(--accentBg);color:var(--accent);display:grid;place-items:center;font-weight:700;">' + escH(String(a.name || "?").slice(0, 1).toUpperCase()) + '</div>' +
        '<div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:13px;">' + escH(a.name) + '</div><div style="font-size:11px;color:var(--muted);">Connected ' + escH(when(a.connected_at)) + ' · last active ' + escH(ago(a.last_active)) + '</div></div>' +
        '<button type="button" class="btn btn-g aiDisc" data-name="' + escH(a.name) + '" style="padding:5px 12px;font-size:11px;">Disconnect</button></div>';
    }).join("") : '<div class="empty"><div class="empty-ico">🔌</div>No AI app is connected to your Revora login yet.</div>';
    el.innerHTML = '<div class="ph"><div class="ph-title">AI apps</div><div class="ph-count">' + apps.length + ' connected</div></div>' +
      '<div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">AI apps you have allowed to use Revora as you. Disconnecting removes the app’s access straight away: it cannot see or change anything until you connect it again. Only you can see and remove your own connections.</div>' +
      list + (apps.length > 1 ? '<div style="margin-top:4px;"><button type="button" class="btn btn-g" id="aiDiscAll" style="padding:5px 12px;font-size:11px;">Disconnect all</button></div>' : "") +
      installBlock(url);
    async function run(appName, label) {
      if (!confirm("Disconnect " + label + "? It will stop working until you connect it again.")) return;
      var d = await api({ action: "disconnect", name: appName || undefined });
      if (!d.ok) { bvToast(d.j.error || "Could not disconnect.", "err"); return; }
      bvToast("Disconnected"); window.bvRenderAiApps();
    }
    el.querySelectorAll(".aiDisc").forEach(function (b) { b.onclick = function () { run(b.dataset.name, b.dataset.name); }; });
    var all = document.getElementById("aiDiscAll"); if (all) all.onclick = function () { run(null, "all AI apps"); };
    var cp = document.getElementById("aiCopyUrl"); if (cp) cp.onclick = function () { try { navigator.clipboard.writeText(url); bvToast("Address copied"); } catch (e) { bvToast("Select the address and copy it", "err"); } };
  };
})();
