/**
 * Quality Herb — WordPress lead capture snippet.
 *
 * Paste this inside a <script> tag in an Elementor "HTML" widget placed
 * near the order form on the product landing page (works with the free
 * version of Elementor — no Pro required).
 *
 * What it does:
 *  - Reads asid/crid (ad set + creative attribution) and fbclid from the
 *    page URL — these are appended automatically to every ad link by
 *    auto-launch-tests, so they'll be present when someone arrives from
 *    a real ad. They'll be missing for organic/direct visits, which is fine.
 *  - On ANY form submit on the page, captures the field values and sends a
 *    parallel copy to Supabase's receive-order function (which hashes the
 *    PII, fires the Meta CAPI Purchase event, and writes an `orders` row).
 *  - Does NOT call preventDefault() — the form still submits to the
 *    company CRM exactly as it does today. This only adds a copy, it
 *    doesn't change or block the existing submission.
 *
 * IMPORTANT — field names are a best-effort guess (common name/id
 * patterns across form plugins). Once this is live on the real page,
 * submit a real test order and check the `orders` table in Supabase —
 * if customer_name/email/phone/address come through empty, open the
 * form's HTML (right-click a field -> Inspect) and add its actual
 * name/id to the matching get(...) call below.
 *
 * If the order form has a specific ID, uncomment and set FORM_SELECTOR
 * below to avoid firing on unrelated forms on the same page (e.g. a
 * newsletter signup).
 */
(function () {
  const SUPABASE_FUNCTION_URL = "https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/receive-order";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2hraGdkeGhtb2d4eHRidnl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNTc3ODgsImV4cCI6MjEwMTYzMzc4OH0.zAWC-s3PVsYi_EIHibbqLkCQ0u095ppDh-2l_DA-_Pc";

  // const FORM_SELECTOR = "#your-real-form-id"; // set this once known, then use it in the guard below

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  const asid = getParam("asid");
  const crid = getParam("crid");
  const fbclid = getParam("fbclid");

  document.addEventListener(
    "submit",
    function (e) {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      // if (FORM_SELECTOR && !form.matches(FORM_SELECTOR)) return;

      const fd = new FormData(form);
      function get() {
        for (let i = 0; i < arguments.length; i++) {
          const v = fd.get(arguments[i]);
          if (v) return v;
        }
        return null;
      }

      const payload = {
        event_id: uuid(),
        customer_name: get("name", "full_name", "your-name", "customer_name", "fullname"),
        email: get("email", "your-email", "customer_email"),
        phone: get("phone", "tel", "your-phone", "customer_phone", "phone_number"),
        customer_address: get("address", "your-address", "customer_address", "delivery_address"),
        product_name: document.title,
        ad_set_id: asid || null,
        creative_id: crid || null,
        fbclid: fbclid || undefined,
        fbp: getCookie("_fbp") || undefined,
        fbc: getCookie("_fbc") || undefined,
      };

      fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_ANON_KEY },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function (err) {
        console.error("Lead capture failed (order still went to the CRM as normal):", err);
      });

      // No preventDefault() — native form submission to the CRM continues unchanged.
    },
    true,
  );
})();
