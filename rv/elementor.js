/* Elementor template (.json) -> editable HTML for the website builder.
   Best-effort: layout (sections/columns/containers), spacing, colours, backgrounds, typography,
   and the common widgets. Anything it can't translate becomes a visible note and is listed in `warnings`. */
(function (global) {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function convert(json, RB) {
    var warnings = [], unsupported = {}, mobileCss = [], tabletCss = [], deskHide = [], fontsUsed = {}, uid = 0;
    var data = typeof json === "string" ? JSON.parse(json) : json;
    var content = Array.isArray(data) ? data : (data.content || (data.data && data.data.content) || []);
    var title = data.title || "";

    // Elementor titles/descriptions may hold inline HTML (<b>, <br>, <span style>, emoji <img>). Keep the safe formatting, drop the rest.
    function rich(html) {
      html = String(html == null ? "" : html); if (html.indexOf("<") < 0 && html.indexOf("&") < 0) return dateTokens(html);
      var KEEP = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, SMALL: 1, BR: 1, MARK: 1, SUP: 1, SUB: 1 };
      var root = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html").body;
      function walkN(n) {
        var out = "";
        n.childNodes.forEach(function (c) {
          if (c.nodeType === 3) out += dateTokens(c.nodeValue);
          else if (c.nodeType === 1) {
            var t = c.tagName;
            if (t === "IMG") out += esc(c.getAttribute("alt") || "");
            else if (t === "SCRIPT" || t === "STYLE") out += "";
            else if (KEEP[t]) out += t === "BR" ? "<br>" : "<" + t.toLowerCase() + ">" + walkN(c) + "</" + t.toLowerCase() + ">";
            else if (t === "SPAN" && /font-weight:\s*(bold|[6-9]00)/i.test(c.getAttribute("style") || "")) out += "<b>" + walkN(c) + "</b>";
            else out += walkN(c);
          }
        });
        return out;
      }
      return walkN(root);
    }
    // WordPress "date" shortcodes ([wpdts-custom format="D, d M" days="+1"]) become live date spans (the page fills in the real date when it loads)
    function dateTokens(raw) {
      var re = /\[wpdts-custom([^\]]*)\]/g, out = "", last = 0, m;
      while ((m = re.exec(raw))) {
        var f = /format="([^"]*)"/.exec(m[1]), dd = /days="([^"]*)"/.exec(m[1]), fmt = f ? f[1] : "D, d M", n = dd ? parseInt(dd[1], 10) : 0; if (isNaN(n)) n = 0;
        out += esc(raw.slice(last, m.index)) + '<span data-rv-date="' + n + '" data-rv-fmt="' + esc(fmt) + '">' + (global.RVDate ? esc(global.RVDate(fmt, n)) : "") + "</span>"; last = m.index + m[0].length;
      }
      return out + esc(raw.slice(last));
    }
    function size(v, dflt) { if (v == null || v === "") return dflt || ""; if (typeof v !== "object") return /^-?[\d.]+$/.test(String(v)) ? v + "px" : String(v); if (v.size === "" || v.size == null) return dflt || ""; var u = v.unit === "custom" ? "" : (v.unit || "px"); return v.size + u; }
    function dims(v) { if (!v || typeof v !== "object" || v.top === undefined) return ""; if ([v.top, v.right, v.bottom, v.left].every(function (x) { return x === "" || x == null; })) return ""; var u = v.unit || "px"; return [v.top, v.right, v.bottom, v.left].map(function (x) { return (x === "" || x == null ? 0 : x) + (x === 0 || x === "0" || x === "" || x == null ? "" : u); }).join(" "); }
    function color(v) { return v && typeof v === "string" ? v : ""; }
    function url(v) { return v && typeof v === "object" ? (v.url || "") : (typeof v === "string" ? v : ""); }
    function pickIcon(i) { if (!i) return "•"; var val = typeof i === "object" ? (i.value || "") : String(i); if (typeof val === "object") return "•"; if (/check|circle-check|tick/.test(val)) return "✓"; if (/star/.test(val)) return "★"; if (/arrow|chevron/.test(val)) return "→"; if (/phone/.test(val)) return "📞"; if (/envelope|mail/.test(val)) return "✉"; if (/whatsapp/.test(val)) return "💬"; if (/map|location/.test(val)) return "📍"; if (/heart/.test(val)) return "♥"; if (/truck|shipping/.test(val)) return "🚚"; if (/lock|shield/.test(val)) return "🔒"; return "✓"; }
    function addFont(f) { if (f && !/^(inherit|sans-serif|serif|arial|helvetica|georgia|verdana|tahoma|times)/i.test(f)) fontsUsed[f] = 1; }
    function fontCss(s, p) {
      var o = [], fam = s[p + "_font_family"], fs = size(s[p + "_font_size"]), fw = s[p + "_font_weight"], lh = size(s[p + "_line_height"]), ls = size(s[p + "_letter_spacing"]), tt = s[p + "_text_transform"];
      if (fam) { addFont(fam); o.push("font-family:'" + String(fam).replace(/'/g, "") + "',sans-serif"); }
      if (fs) o.push("font-size:" + fs); if (fw) o.push("font-weight:" + fw); if (lh) o.push("line-height:" + lh); if (ls) o.push("letter-spacing:" + ls); if (tt) o.push("text-transform:" + tt);
      return o;
    }
    function bgCss(s, pre) {
      pre = pre || "background";
      var o = [], kind = s[pre + "_background"];
      if (kind === "gradient" || (s[pre + "_color"] && s[pre + "_color_b"])) { var a = color(s[pre + "_color"]) || "transparent", b = color(s[pre + "_color_b"]) || "transparent", ang = (s[pre + "_gradient_angle"] && s[pre + "_gradient_angle"].size) || 180; o.push("background-image:linear-gradient(" + ang + "deg," + a + "," + b + ")"); }
      else if (s[pre + "_color"]) o.push("background-color:" + color(s[pre + "_color"]));
      var img = url(s[pre + "_image"]);
      if (img && (kind === "classic" || kind == null || kind === "")) { o.push("background-image:url('" + img + "')"); o.push("background-size:" + (s[pre + "_size"] || "cover")); o.push("background-position:" + String(s[pre + "_position"] || "center center").replace(/\s+/g, " ")); o.push("background-repeat:" + (s[pre + "_repeat"] || "no-repeat")); }
      return o;
    }
    function borderCss(s) {
      var o = [], bw = dims(s.border_width), bt = s.border_border;
      if (bt && bt !== "none") { o.push("border-style:" + bt); if (bw) o.push("border-width:" + bw); if (s.border_color) o.push("border-color:" + s.border_color); }
      var br = dims(s.border_radius); if (br) o.push("border-radius:" + br);
      var sh = s.box_shadow_box_shadow; if (sh && typeof sh === "object" && sh.color) o.push("box-shadow:" + (sh.horizontal || 0) + "px " + (sh.vertical || 0) + "px " + (sh.blur || 0) + "px " + (sh.spread || 0) + "px " + sh.color);
      return o;
    }
    function spacing(s, padKey, marKey) {
      var o = [], p = dims(s[padKey]), m = dims(s[marKey]); if (p) o.push("padding:" + p); if (m) o.push("margin:" + m); return o;
    }
    // responsive overrides -> generated classes with media queries
    function responsive(s, cls, extra) {
      var tab = [], mob = [], before = mobileCss.length + tabletCss.length;
      var kv = [["_padding", "padding"], ["padding", "padding"], ["_margin", "margin"], ["margin", "margin"]];
      kv.forEach(function (k) { var t = dims(s[k[0] + "_tablet"]), m = dims(s[k[0] + "_mobile"]); if (t) tab.push(k[1] + ":" + t + "!important"); if (m) mob.push(k[1] + ":" + m + "!important"); });
      // font sizes sit on the inner element (inline), so the media rules must target it
      [["title_typography", "font-size"], ["typography", "font-size"], ["text_typography", "font-size"]].forEach(function (k) { var f = k[0] + "_font_size"; var t = size(s[f + "_tablet"]), m = size(s[f + "_mobile"]); if (t) tabletCss.push("." + cls + ">*{font-size:" + t + "!important}"); if (m) mobileCss.push("." + cls + ">*{font-size:" + m + "!important}"); });
      if (s.align_mobile) mob.push("text-align:" + s.align_mobile + "!important"); if (s.align_tablet) tab.push("text-align:" + s.align_tablet + "!important");
      if (s.hide_mobile) mob.push("display:none!important"); if (s.hide_tablet) tab.push("display:none!important");
      if (s.hide_desktop) deskHide.push(cls);
      if (extra) { mob = mob.concat(extra.mobile || []); tab = tab.concat(extra.tablet || []); }
      if (mob.length) mobileCss.push("." + cls + "{" + mob.join(";") + "}"); if (tab.length) tabletCss.push("." + cls + "{" + tab.join(";") + "}");
      return mobileCss.length + tabletCss.length > before || !!s.hide_desktop;
    }
    function attrs(s, style, cls) {
      var a = ' style="' + esc(style.filter(Boolean).join(";")) + '"';
      var c = [cls, s._css_classes, s.css_classes].filter(Boolean).join(" "); if (c) a += ' class="' + esc(c) + '"';
      var id = s._element_id || s.css_id; if (id) a += ' id="' + esc(id) + '"';
      return a;
    }
    function link(l) { var u = url(l); return u ? { href: u, ext: l && l.is_external === "on" } : null; }

    function widget(w) {
      var s = w.settings || {}, t = w.widgetType, cls = "rvx" + (++uid), id = w.id;
      var common = spacing(s, "_padding", "_margin"); var bg = bgCss(s, "_background"); var bd = borderCss(s);
      var width = s._element_width === "initial" ? (s._element_custom_width ? "width:" + size(s._element_custom_width) : "") : (s._element_width === "inherit" ? "width:" + (s._element_custom_width && size(s._element_custom_width) || "auto") : "");
      var wrapStyle = common.concat(bg, bd, width);
      var hasResp = responsive(s, cls);
      var open = function (extraStyle, extraCls) { return "<div" + attrs(s, wrapStyle.concat(extraStyle || []), (hasResp ? cls : "") + (extraCls ? " " + extraCls : "")) + ">"; };
      var al = s.align ? "text-align:" + s.align : "";
      switch (t) {
        case "heading": {
          var tag = /^h[1-6]$/.test(s.header_size) ? s.header_size : "h2", fnt = fontCss(s, "typography");
          var defSize = { h1: "44px", h2: "34px", h3: "28px", h4: "22px", h5: "18px", h6: "16px" }[tag];
          var st = ["margin:0", "color:" + (color(s.title_color) || "inherit"), fnt.some(function (x) { return /^font-size/.test(x); }) ? "" : "font-size:" + defSize, "line-height:1.2", "font-weight:700"].concat(fnt).concat(s.text_shadow_text_shadow ? [] : []);
          var inner = rich(s.title || ""); var l = link(s.link);
          if (l) inner = '<a href="' + esc(l.href) + '"' + (l.ext ? ' target="_blank" rel="noopener"' : "") + ' style="color:inherit;text-decoration:none">' + inner + "</a>";
          return open([al]) + "<" + tag + ' style="' + esc(st.filter(Boolean).join(";")) + '">' + inner + "</" + tag + "></div>";
        }
        case "text-editor": {
          var fnt2 = fontCss(s, "typography"); var st2 = ["color:" + (color(s.text_color) || "inherit"), "line-height:1.7"].concat(fnt2);
          return open([al]) + '<div style="' + esc(st2.filter(Boolean).join(";")) + '">' + (s.editor || "") + "</div></div>";
        }
        case "image": {
          var src = url(s.image) || ""; var wpx = size(s.width) || ""; var l2 = link(s.link);
          var im = '<img src="' + esc(src) + '" alt="' + esc((s.image && s.image.alt) || "") + '" style="max-width:100%;height:auto;' + (wpx ? "width:" + wpx + ";" : "") + (size(s.height) ? "height:" + size(s.height) + ";object-fit:" + (s.object_fit || "cover") + ";" : "") + (dims(s.image_border_radius) ? "border-radius:" + dims(s.image_border_radius) + ";" : "") + 'display:inline-block">';
          if (l2) im = '<a href="' + esc(l2.href) + '"' + (l2.ext ? ' target="_blank" rel="noopener"' : "") + ">" + im + "</a>";
          return open([al || "text-align:center"]) + im + "</div>";
        }
        case "button": {
          var l3 = link(s.link) || { href: "#" }; var fnt3 = fontCss(s, "typography");
          var pad = dims(s.text_padding) || (s.size === "xs" ? "8px 16px" : s.size === "sm" ? "10px 22px" : s.size === "lg" ? "18px 36px" : s.size === "xl" ? "22px 44px" : "14px 30px");
          var bst = ["display:inline-block", "text-decoration:none", "text-align:center", "padding:" + pad, "background-color:" + (color(s.background_color) || "#1a7a5e"), "color:" + (color(s.button_text_color) || "#fff"), "border-radius:" + (dims(s.border_radius) || "6px"), "font-weight:600"].concat(fnt3);
          if (s.border_border && s.border_border !== "none") bst.push("border:" + (size(s.border_width && s.border_width.top !== undefined ? { size: s.border_width.top, unit: s.border_width.unit } : null) || "1px") + " " + s.border_border + " " + (s.border_color || "currentColor"));
          var shadow = s.button_box_shadow_box_shadow; if (shadow && shadow.color) bst.push("box-shadow:" + (shadow.horizontal || 0) + "px " + (shadow.vertical || 0) + "px " + (shadow.blur || 0) + "px " + (shadow.spread || 0) + "px " + shadow.color);
          if (s.align === "justify") bst.push("display:block");
          return open([al || "text-align:left"]) + '<a href="' + esc(l3.href) + '"' + (l3.ext ? ' target="_blank" rel="noopener"' : "") + ' style="' + esc(bst.join(";")) + '">' + esc(s.text || "Click here") + "</a></div>";
        }
        case "icon-list": {
          var items = (s.icon_list || []).map(function (it) { var ic = pickIcon(it.selected_icon); var l4 = link(it.link); var txt = esc(it.text || ""); if (l4) txt = '<a href="' + esc(l4.href) + '" style="color:inherit;text-decoration:none">' + txt + "</a>"; return '<li style="display:flex;gap:10px;align-items:flex-start;margin:0 0 8px"><span style="color:' + (color(s.icon_color) || "inherit") + ';flex:none">' + ic + "</span><span>" + txt + "</span></li>"; }).join("");
          return open([]) + '<ul style="list-style:none;margin:0;padding:0;color:' + (color(s.text_color) || "inherit") + '">' + items + "</ul></div>";
        }
        case "divider": return open([]) + '<hr style="border:0;border-top:' + (size(s.weight && s.weight.size !== undefined ? s.weight : { size: 1, unit: "px" }) || "1px") + " " + (s.style || "solid") + " " + (color(s.color) || "#ddd") + ';margin:' + (size(s.gap) ? size(s.gap) + " 0" : "15px 0") + '"></div>';
        case "spacer": return open([]) + '<div style="height:' + (size(s.space) || "50px") + '"></div></div>';
        case "video": {
          var vu = s.youtube_url || s.vimeo_url || s.dailymotion_url || url(s.hosted_url) || s.external_url || "";
          if (!vu) { warnings.push("Video widget without a link was skipped"); return ""; }
          var emb = RB ? RB.videoEmbed(vu, { autoplay: s.autoplay === "yes", loop: s.loop === "yes", controls: s.controls !== "" && s.controls !== "no" }) : '<iframe src="' + esc(vu) + '"></iframe>';
          var ratio = RB ? RB.videoRatioFor(vu) : "16:9"; if (s.aspect_ratio === "11") ratio = "1:1"; else if (s.aspect_ratio === "916") ratio = "9:16"; else if (s.aspect_ratio === "43") ratio = "4:3";
          return open([]) + '<div class="rv-video" data-src="' + esc(vu) + '" data-ratio="' + ratio + '">' + emb + "</div></div>";
        }
        case "image-box": case "icon-box": {
          var topImg = t === "image-box" ? (url(s.image) ? '<img src="' + esc(url(s.image)) + '" alt="" style="max-width:100%;height:auto;margin-bottom:14px">' : "") : '<div style="font-size:' + (size(s.primary_color) ? "40px" : "40px") + ';margin-bottom:12px;color:' + (color(s.primary_color) || "inherit") + '">' + pickIcon(s.selected_icon) + "</div>";
          return open([al || "text-align:center"]) + topImg + '<h3 style="margin:0 0 8px;font-size:' + (fontCss(s, "title_typography").join(";").match(/font-size:([^;]+)/) || [0, "20px"])[1] + ';color:' + (color(s.title_color) || "inherit") + '">' + rich(s.title_text || "") + '</h3><p style="margin:0;color:' + (color(s.description_color) || "inherit") + '">' + esc(s.description_text || "") + "</p></div>";
        }
        case "testimonial": return open([]) + '<div style="padding:24px;border:1px solid #e5e5e5;border-radius:14px;background:#fff"><p style="margin:0 0 16px;font-size:17px;line-height:1.6">“' + esc(s.testimonial_content || "") + '”</p><div style="display:flex;gap:12px;align-items:center">' + (url(s.testimonial_image) ? '<img src="' + esc(url(s.testimonial_image)) + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover" alt="">' : "") + "<div><b>" + esc(s.testimonial_name || "") + '</b><div style="font-size:13px;opacity:.7">' + esc(s.testimonial_job || "") + "</div></div></div></div></div>";
        case "accordion": case "toggle": {
          var rows = (s.tabs || []).filter(function (tb) { return String(tb.tab_title || "").trim().toLowerCase() !== "default" || String(tb.tab_content || "").trim(); }).map(function (tb) { return '<details style="border:1px solid #e5e5e5;border-radius:10px;margin-bottom:10px;background:#fff"><summary style="cursor:pointer;font-weight:700;padding:16px 20px">' + esc(tb.tab_title || "") + '</summary><div style="padding:0 20px 18px">' + (tb.tab_content || "") + "</div></details>"; }).join("");
          return open([]) + rows + "</div>";
        }
        case "tabs": {
          var tabs = s.tabs || [];
          return open([]) + '<div class="rv-tabs" data-rv-tabs="1"><div class="rv-tablist">' + tabs.map(function (tb, i) { return "<button" + (i === 0 ? ' class="on"' : "") + ">" + esc(tb.tab_title || "Tab") + "</button>"; }).join("") + "</div>" + tabs.map(function (tb, i) { return '<div class="rv-tabpanel' + (i === 0 ? " on" : "") + '">' + (tb.tab_content || "") + "</div>"; }).join("") + "</div></div>";
        }
        case "counter": return open([al || "text-align:center"]) + '<div style="font-size:48px;font-weight:800;line-height:1.1">' + esc((s.prefix || "") + (s.ending_number || "0") + (s.suffix || "")) + '</div><div style="opacity:.8">' + esc(s.title || "") + "</div></div>";
        case "progress": return open([]) + '<div style="display:flex;justify-content:space-between;font-weight:600;margin-bottom:6px"><span>' + esc(s.title || "") + "</span><span>" + esc((s.percent && s.percent.size) || 0) + '%</span></div><div style="height:12px;border-radius:99px;background:#e9e6dd;overflow:hidden"><i style="display:block;height:100%;width:' + esc((s.percent && s.percent.size) || 0) + "%;background:" + (color(s.bar_color) || "#1a7a5e") + '"></i></div></div>';
        case "star-rating": return open([al || "text-align:left"]) + '<span style="color:' + (color(s.star_color) || "#f5a623") + ';letter-spacing:3px;font-size:22px">' + "★".repeat(Math.round(Number(s.rating) || 5)) + "☆".repeat(Math.max(0, 5 - Math.round(Number(s.rating) || 5))) + "</span></div>";
        case "social-icons": return open([al || "text-align:center"]) + (s.social_icon_list || []).map(function (it) { var l5 = link(it.link); var n = String((it.social_icon && it.social_icon.value) || it.social || "").replace(/fab fa-|fa-brands |fa-/g, "").slice(0, 2).toUpperCase(); return '<a href="' + esc((l5 && l5.href) || "#") + '" target="_blank" rel="noopener" style="display:inline-flex;width:42px;height:42px;border-radius:50%;background:#eef1f4;color:#333;align-items:center;justify-content:center;margin:0 5px;text-decoration:none;font-weight:700">' + esc(n) + "</a>"; }).join("") + "</div>";
        case "image-gallery": case "gallery": return open([]) + '<div style="display:grid;grid-template-columns:repeat(' + (Number(s.gallery_columns) || 3) + ',1fr);gap:10px">' + (s.wp_gallery || s.gallery || []).map(function (g) { return '<img src="' + esc(g.url || "") + '" alt="" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px">'; }).join("") + "</div></div>";
        case "google_maps": return open([]) + '<div class="rv-map" data-q="' + esc(s.address || "") + '">' + (RB ? RB.mapEmbed(s.address || "") : "") + "</div></div>";
        case "html": return open([]) + '<div class="rv-custom" data-rv-html="1">' + (s.html || "") + "</div></div>";
        case "shortcode": {
          var sc = String(s.shortcode || ""), left = sc.replace(/\[wpdts-custom[^\]]*\]/g, "").replace(/<[^>]+>/g, "");
          if (/\[\w[^\]]*\]/.test(left)) { warnings.push("A WordPress shortcode (" + left.match(/\[\w[^\]]*\]/)[0].slice(0, 30) + ") can't run outside WordPress and was removed"); sc = sc.replace(/\[(?!wpdts-custom)\w[^\]]*\]/g, ""); }
          return open([al]) + '<div style="line-height:1.6">' + rich(sc) + "</div></div>";
        }
        case "e-youtube": {
          var yv = s.source && typeof s.source === "object" ? (s.source.value || "") : (s.source || "");
          if (!yv) { warnings.push("A YouTube widget without a link was skipped"); return ""; }
          return open([]) + '<div class="rv-video" data-src="' + esc(yv) + '" data-ratio="' + (RB ? RB.videoRatioFor(yv) : "16:9") + '">' + (RB ? RB.videoEmbed(yv) : '<iframe src="' + esc(yv) + '"></iframe>') + "</div></div>";
        }
        case "rating": case "star-rating-v2": return open([al || "text-align:left"]) + '<span style="color:#f5a623;letter-spacing:3px;font-size:22px">★★★★★</span></div>';
        case "nested-accordion": {
          var its = s.items || [], kids2 = w.elements || [];
          return open([]) + its.map(function (it, i) { return '<details style="border:1px solid #e5e5e5;border-radius:10px;margin-bottom:10px;background:#fff"><summary style="cursor:pointer;font-weight:700;padding:16px 20px">' + rich(it.item_title || "") + '</summary><div style="padding:0 20px 16px">' + (kids2[i] ? node(kids2[i], true) : "") + "</div></details>"; }).join("") + "</div>";
        }
        case "menu-anchor": return '<span id="' + esc(s.anchor || "") + '"></span>';
        case "form": case "woocommerce-checkout-page": case "wpforms": warnings.push("An Elementor form was replaced by the built-in Order form (orders go to your Orders tab)"); return open([]) + '<div data-rv-form="1"></div></div>';
        default: unsupported[t] = (unsupported[t] || 0) + 1; return open([]) + '<div class="rv-note warn">Elementor widget “' + esc(t) + "” isn't supported yet. Replace it with a builder widget.</div></div>";
      }
    }

    function column(c, gapPx, dir) {
      var s = c.settings || {}, cls = "rvx" + (++uid), pct = Number(s._column_size) || 100; var w = s._inline_size ? Number(s._inline_size) : pct;
      var st = ["flex:0 0 calc(" + w + "% - " + 0 + "px)", "max-width:" + w + "%", "min-width:0", "box-sizing:border-box", "padding:" + (dims(s.padding) || gapPx + "px"), "display:flex", "flex-direction:column", "justify-content:" + ({ top: "flex-start", middle: "center", bottom: "flex-end" }[s.content_vertical_align] || (s.content_position === "center" ? "center" : s.content_position === "bottom" ? "flex-end" : "flex-start"))].concat(bgCss(s), borderCss(s), s.margin ? ["margin:" + dims(s.margin)] : []);
      var rs = responsive(s, cls, { mobile: ["flex-basis:100%!important", "max-width:100%!important"], tablet: [] });
      var kids = (c.elements || []).map(function (x) { return node(x, true); }).join("");
      return "<div" + attrs(s, st, "rvx-col " + cls) + ">" + kids + "</div>";
    }

    function boxStyleFrom(s, isContainer) {
      var st = [].concat(spacing(s, "padding", "margin"), bgCss(s), borderCss(s));
      var h = s.height === "min-height" ? size(s.custom_height) : (s.height === "full" ? "100vh" : ""); if (h) st.push("min-height:" + h);
      if (s.height_inner) st.push("min-height:" + size(s.height_inner));
      return st;
    }

    function overlay(s) {
      var kind = s.background_overlay_background, col = color(s.background_overlay_color); if (!(kind || col)) return "";
      var op = (s.background_overlay_opacity && s.background_overlay_opacity.size != null) ? s.background_overlay_opacity.size : 0.5;
      var ob = bgCss(s, "background_overlay"); return '<div style="position:absolute;inset:0;pointer-events:none;opacity:' + op + ";" + ob.join(";") + '"></div>';
    }

    function section(sec) {
      var s = sec.settings || {}, cls = "rvx" + (++uid);
      var gapMap = { no: 0, narrow: 5, extended: 15, wide: 20, wider: 30 }, gapPx = s.gap === undefined || s.gap === "default" ? 10 : (gapMap[s.gap] !== undefined ? gapMap[s.gap] : 10);
      if (s.gap === "custom" && s.gap_columns_custom) gapPx = Number(s.gap_columns_custom.size) || 10;
      var boxed = s.layout !== "full_width", maxW = boxed ? (s.content_width && s.content_width.size ? size(s.content_width) : "1140px") : "none";
      var st = boxStyleFrom(s).concat(["position:relative", "box-sizing:border-box"]);
      var ov = overlay(s); responsive(s, cls);
      var cols = (sec.elements || []).map(function (c) { return c.elType === "column" ? column(c, gapPx) : node(c); }).join("");
      var inner = '<div style="max-width:' + maxW + ';margin:0 auto;display:flex;flex-wrap:wrap;position:relative;align-items:' + ({ top: "flex-start", middle: "center", bottom: "flex-end" }[s.content_position] || "stretch") + '">' + cols + "</div>";
      return "<section" + attrs(s, st, cls) + ">" + ov + inner + "</section>";
    }

    function container(c, nested) {
      var s = c.settings || {}, cls = "rvx" + (++uid);
      var dir = s.flex_direction || "column", wrap = s.flex_wrap === "wrap";
      var st = boxStyleFrom(s, true).concat(["position:relative", "box-sizing:border-box", "display:flex", "flex-direction:" + dir]);
      if (wrap) st.push("flex-wrap:wrap");
      var gap = s.flex_gap && s.flex_gap.column !== undefined ? (s.flex_gap.column || 0) + (s.flex_gap.unit || "px") : (s.flex_gap && s.flex_gap.size ? size(s.flex_gap) : ""); if (gap) st.push("gap:" + gap);
      if (s.flex_justify_content) st.push("justify-content:" + s.flex_justify_content); if (s.flex_align_items) st.push("align-items:" + s.flex_align_items);
      if (nested && s.width && s.width.size) st.push("width:" + size(s.width)); else if (nested) st.push("flex:1 1 0");
      var boxed = !nested && s.content_width !== "full", maxW = boxed ? (s.boxed_width && s.boxed_width.size ? size(s.boxed_width) : "1140px") : "";
      var m = dir === "row" || dir === "row-reverse";
      var mobile = m ? ["flex-direction:column!important"] : []; responsive(s, cls, { mobile: mobile });
      var ov = overlay(s), kids = (c.elements || []).map(function (x) { return node(x, true); }).join("");
      if (boxed) { st.push("align-items:center"); return "<section" + attrs(s, boxStyleFrom(s).concat(["position:relative", "box-sizing:border-box"]), cls) + ">" + ov + '<div style="max-width:' + maxW + ";margin:0 auto;display:flex;flex-direction:" + dir + (wrap ? ";flex-wrap:wrap" : "") + (gap ? ";gap:" + gap : "") + (s.flex_justify_content ? ";justify-content:" + s.flex_justify_content : "") + (s.flex_align_items ? ";align-items:" + s.flex_align_items : "") + ';position:relative" class="' + (m ? "rvx-row " : "") + cls + '-in">' + kids + "</div></section>"; }
      return "<div" + attrs(s, st, (m ? "rvx-row " : "") + cls) + ">" + ov + kids + "</div>";
    }

    // Elementor's newer "Flexbox" element keeps its layout in a styles map instead of settings; read the bits that matter.
    function flexSettings(n) {
      var out = { flex_direction: "column" };
      Object.keys(n.styles || {}).forEach(function (k) {
        ((n.styles[k] || {}).variants || []).forEach(function (v) {
          if (v.meta && v.meta.breakpoint && v.meta.breakpoint !== "desktop") return;
          var p = v.props || {}, val = function (x) { return x && typeof x === "object" && "value" in x ? x.value : x; };
          if (p["flex-direction"]) out.flex_direction = val(p["flex-direction"]);
          if (p["flex-wrap"]) out.flex_wrap = val(p["flex-wrap"]);
          if (p["justify-content"]) out.flex_justify_content = val(p["justify-content"]);
          if (p["align-items"]) out.flex_align_items = val(p["align-items"]);
          var g = val(p.gap); if (g && typeof g === "object" && g.size != null) out.flex_gap = { size: g.size, unit: g.unit || "px" };
        });
      });
      return out;
    }
    function node(n, nested) {
      if (!n) return "";
      if (n.elType === "e-flexbox") return container(Object.assign({}, n, { settings: flexSettings(n) }), nested || n.isInner);
      if (n.elType === "section") return section(n);
      if (n.elType === "container") return container(n, nested || n.isInner);
      if (n.elType === "column") return column(n, 10);
      if (n.elType === "widget") return widget(n);
      return "";
    }

    var body = content.map(function (n) { return node(n, false); }).join("\n");
    Object.keys(unsupported).forEach(function (k) { warnings.push(unsupported[k] + " “" + k + "” widget" + (unsupported[k] > 1 ? "s" : "") + " couldn't be converted"); });
    var css = ".rvx-col img{max-width:100%}.rvx-row>*{min-width:0}@media(max-width:1024px){" + tabletCss.join("") + "}@media(max-width:767px){.rvx-row{flex-direction:column!important}" + mobileCss.join("") + "}";
    if (deskHide.length) css += deskHide.map(function (c) { return "@media(min-width:1025px){." + c + "{display:none!important}}"; }).join("");
    var fonts = Object.keys(fontsUsed);
    var head = fonts.length ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' + fonts.map(function (f) { return "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;500;600;700;800"; }).join("&") + '&display=swap">' : "";
    return { html: body, css: css, head: head, warnings: warnings, title: title, fonts: fonts };
  }

  global.RVElementor = { convert: convert };
})(typeof window !== "undefined" ? window : globalThis);
