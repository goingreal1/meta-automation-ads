// Revora dashboard, part 19 of 23

async function renderWallet(el) {
  const isAdmin = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";
  const myId = window.myProfile?.media_buyer_id || null;
  const blank = walletBlank;

  const [{ buyers, fundRequests, withdrawals, walletBalances, companyTopups, totalRevenue, fundingWalletBalance, managedSpend }, company] = await Promise.all([
    fetchWalletBalances(),
    sbQuery("companies", "select=id,name,dedicated_account_number,dedicated_account_bank&limit=1").then(r => r?.[0]).catch(() => null),
  ]);
  // Richer than fetchWalletBalances' own payments query (which only pulls
  // the columns it needs for sums) -- this one is for the transaction
  // ledger below, so it needs the order link and timestamp too. RLS scopes
  // it the same way: a buyer only ever gets their own.
  const confirmedPayments = await sbQuery("payments", "select=id,amount_naira,paid_at,media_buyer_id,source,held_for_buyer_id,sender_name,sender_bank,sender_account,narration,orders(customer_name)&status=eq.confirmed&order=paid_at.desc&limit=100").catch(() => []);
  // Deposits that arrived in a buyer's account but could not be matched to an order. The company holds the money; the buyer can see it.
  const heldDeposits = (confirmedPayments || []).filter(p => p.held_for_buyer_id && (isAdmin || p.held_for_buyer_id === myId));
  const heldTotal = heldDeposits.reduce((s, p) => s + Number(p.amount_naira || 0), 0);
  const heldFrom = p => [p.sender_name, p.sender_bank, p.sender_account].filter(Boolean).join(" · ") || "sender not shown";
  // Requests from buyers asking the admin to match a held deposit to one of their orders.
  const matchReqs = await sbQuery("payment_match_requests", "select=id,payment_id,order_id,media_buyer_id,status,requested_at,orders(customer_name,product_name,order_value_naira)&order=requested_at.desc&limit=100").catch(() => []);
  const pendingByPayment = new Map((matchReqs || []).filter(r => r.status === "pending").map(r => [r.payment_id, r]));

  const rw = await sbFn("wallet-topup", { action: "overview" }).catch(() => null);
  const myRevenue = myId ? (walletBalances[myId] || walletBlank()) : walletBlank();
  const myRequests = myId ? (fundRequests || []).filter(f => f.media_buyer_id === myId) : [];

  // One combined, chronological ledger -- "where did this number come
  // from": a customer payment or an admin deposit is a credit; a transfer
  // out to an ad account or a withdrawal to the admin's own bank is a
  // debit. Buyers see only their own payments; admins see everything.
  const ledger = [];
  for (const p of confirmedPayments || []) {
    if (p.held_for_buyer_id) {
      if (!isAdmin && p.held_for_buyer_id !== myId) continue;
      const bn = (buyers || []).find(b => b.id === p.held_for_buyer_id)?.name;
      ledger.push({ date: p.paid_at, type: "credit", label: "Unmatched deposit (held by company)", detail: "From " + heldFrom(p), buyerName: bn, amount: p.amount_naira });
      continue;
    }
    if (p.source === "admin_topup") {
      if (!isAdmin) continue;
      ledger.push({ date: p.paid_at, type: "credit", label: "Company funding (admin deposit)", detail: null, buyerName: null, amount: p.amount_naira });
      continue;
    }
    if (!isAdmin && p.media_buyer_id !== myId) continue;
    const buyerName = (buyers || []).find(b => b.id === p.media_buyer_id)?.name;
    ledger.push({ date: p.paid_at, type: "credit", label: "Customer payment", detail: p.orders?.customer_name || null, buyerName, amount: p.amount_naira });
  }
  for (const f of fundRequests || []) {
    if (f.status !== "transferred") continue;
    if (!isAdmin && f.media_buyer_id !== myId) continue;
    const buyerName = (buyers || []).find(b => b.id === f.media_buyer_id)?.name;
    ledger.push({ date: f.transferred_at, type: "debit", label: "Sent to ad account", detail: f.destination_account_name || null, buyerName, amount: f.amount_naira });
  }
  if (isAdmin) {
    for (const w of withdrawals || []) {
      if (w.status !== "sent") continue;
      ledger.push({ date: w.sent_at || w.created_at, type: "debit", label: "Withdrawn to bank", detail: w.destination_account_name || null, buyerName: null, amount: w.amount_naira });
    }
  }
  ledger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Receipts for money Revora sent out (dashboard or assistant). Admins see the company's; a buyer sees their own.
  const receipts = await sbQuery("transfer_receipts", "select=id,receipt_no,kind,source,amount_naira,account_name,bank_name,status,created_at&order=created_at.desc&limit=30" + (isAdmin ? "" : "&user_id=eq." + (window.myProfile?.id || ""))).catch(() => []);
  const rcPill = st => st === "delivered" ? `<span class="pill" style="background:rgba(22,163,74,.15);color:#16a34a;">Sent</span>` : st === "failed" ? `<span class="pill" style="background:rgba(220,38,38,.15);color:#dc2626;">Failed</span>` : `<span class="pill watch">Processing</span>`;
  const receiptsPanel = (receipts || []).length ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Transfer receipts</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Every transfer Revora sent, from this dashboard or from ChatGPT / Claude. Open one to print it, save it as PDF or share the link.</div>
      <div class="tbl-wrap"><table>
        <tr><th>Receipt</th><th>When</th><th>To</th><th>Via</th><th>Amount</th><th>Status</th><th></th></tr>
        ${receipts.map(r => `<tr>
          <td class="n">RV-${new Date(r.created_at).getUTCFullYear()}-${String(r.receipt_no).padStart(6, "0")}</td>
          <td class="s">${new Date(r.created_at).toLocaleString()}</td>
          <td class="s n">${escH(r.account_name || "—")}<div style="color:var(--muted);font-size:10px;">${escH(r.bank_name || "")}</div></td>
          <td class="s">${r.source === "assistant" ? "AI assistant" : "Dashboard"}</td>
          <td class="n">${fN(r.amount_naira)}</td>
          <td>${rcPill(r.status)}</td>
          <td><button type="button" class="btn btn-a" style="padding:3px 10px;font-size:10px;" onclick="window.open('receipt.html?r=${r.id}','_blank')">Receipt</button></td>
        </tr>`).join("")}
      </table></div>
    </div>` : "";

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Wallet</div></div>

    <div class="g2">
      <div class="wallet-hero" style="margin-bottom:0;">
        <div class="wallet-hero-lbl">Revenue wallet${isAdmin ? " (all buyers)" : ""}</div>
        <div class="wallet-hero-val">${fN(isAdmin ? totalRevenue : myRevenue.confirmed)}</div>
        <div class="wallet-hero-sub">${isAdmin
          ? "Every confirmed customer payment, across every buyer. Informational -- this doesn't fund buyer requests by itself; you decide how much of it to move into the funding wallet below."
          : "Confirmed customer payments on orders you generated. Informational, feeds your ROAS -- not something you can spend directly."}</div>
      </div>

      <div class="wallet-hero" style="margin-bottom:0;${isAdmin && fundingWalletBalance < 0 ? "outline:2px solid var(--danger);" : ""}">
        <div class="wallet-hero-lbl">${isAdmin ? "Funding wallet" : "Waiting for your admin"}</div>
        <div class="wallet-hero-val" style="${!isAdmin || fundingWalletBalance >= 0 ? "" : "color:var(--danger);"}">${fN(isAdmin ? fundingWalletBalance : myRequests.filter(f => f.status === "pending").reduce((t, f) => t + Number(f.amount_naira || 0), 0))}</div>
        <div class="wallet-hero-sub">${isAdmin
          ? (fundingWalletBalance < 0
              ? "⚠️ Low balance -- you've approved more than you've deposited."
              : "What you've personally deposited, minus what's approved/sent/withdrawn" + (managedSpend > 0 ? `, minus ${fN(managedSpend)} spent on your Revora ad accounts.` : "."))
          : "Ad funding you asked for. Your admin approves it with their PIN and the money goes straight to your Meta ad account. You never send money yourself."}</div>
        <div class="wallet-hero-actions">
          ${isAdmin ? `
          ${fundingWalletBalance < 0 ? `<button type="button" class="btn" style="background:var(--danger);border-color:var(--danger);color:#fff;" onclick="bvShowAddFundsModal()">⚠️ Top up now</button>` : `<button type="button" class="btn" onclick="bvShowAddFundsModal()">+ Add funds</button>`}
          <button type="button" class="btn" onclick="bvShowAdminWithdrawModal()">Send money</button>
          ${myId ? `<button type="button" class="btn" onclick="bvShowRequestFundsModal()">Send to Meta</button>` : ""}
          ` : myId ? `
          <button type="button" class="btn" onclick="bvShowRequestFundsModal()">+ Request funds for my own Meta account</button>
          ` : ""}
        </div>
      </div>
    </div>
    ${bvRevoraWalletPanel(rw, isAdmin)}
    ${heldDeposits.length ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Unmatched deposits${isAdmin ? "" : " to your account"} (${fN(heldTotal)})</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">${isAdmin
        ? "Money that arrived in a buyer's account but couldn't be matched to an order (often a POS or a different sender name). It is held in the company funding wallet. Trace it by sender, then match it to the right order."
        : "Money paid into your account that couldn't be matched to an order yet (for example a POS payment or a different sender name). The company holds it for now. Tell your admin which customer it was so it can be matched to the order."}</div>
      <div class="tbl-wrap"><table>
        <tr><th>When</th>${isAdmin ? "<th>Buyer account</th>" : ""}<th>Sender</th><th>Bank</th><th>Account</th><th>Amount</th><th></th></tr>
        ${heldDeposits.map(p => `<tr>
          <td class="s">${p.paid_at ? new Date(p.paid_at).toLocaleString() : "—"}</td>
          ${isAdmin ? `<td class="s">${escH((buyers || []).find(b => b.id === p.held_for_buyer_id)?.name || "—")}</td>` : ""}
          <td class="s n">${escH(p.sender_name || "—")}</td>
          <td class="s">${escH(p.sender_bank || "—")}</td>
          <td class="n">${escH(p.sender_account || "—")}</td>
          <td class="n">${fN(p.amount_naira)}</td>
          <td>${pendingByPayment.has(p.id)
            ? `<span class="pill watch">Match requested${isAdmin ? "" : " · waiting for admin"}</span>`
            : (isAdmin || myId) ? `<button type="button" class="btn btn-a" style="padding:3px 10px;font-size:10px;" onclick="bvShowMatchModal('${p.id}', ${Number(p.amount_naira)})">${isAdmin ? "Match to order" : "Match to my order"}</button>` : ""}</td>
        </tr>`).join("")}
      </table></div>
    </div>` : ""}

    ${isAdmin && pendingByPayment.size ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Deposit match requests (${pendingByPayment.size} pending)</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">A buyer says one of these deposits is the payment for their order. Check the sender, then approve to count it for that order (it leaves the company wallet and counts as the buyer's confirmed revenue).</div>
      ${[...pendingByPayment.values()].map(r => {
        const dep = heldDeposits.find(p => p.id === r.payment_id);
        const bn = (buyers || []).find(b => b.id === r.media_buyer_id)?.name || "—";
        return `<div style="border-bottom:1px solid var(--border);padding:8px 0;">
          <div style="font-size:12.5px;"><b>${escH(bn)}</b> says ${dep ? fN(dep.amount_naira) : ""} is for <b>${escH(r.orders?.customer_name || "an order")}</b>${r.orders?.product_name ? ` (${escH(r.orders.product_name)}, ${fN(r.orders.order_value_naira)})` : ""}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-bottom:6px;">${dep ? "Sent by " + escH(heldFrom(dep)) : ""} -- ${ago(r.requested_at)}</div>
          <button type="button" class="btn btn-a" style="padding:3px 10px;font-size:10px;" onclick="bvDecideMatch('${r.id}','approve','${r.payment_id}','${r.order_id}')">Approve</button>
          <button type="button" class="btn" style="padding:3px 10px;font-size:10px;" onclick="bvDecideMatch('${r.id}','decline')">Decline</button>
        </div>`;
      }).join("")}
    </div>` : ""}
    ${receiptsPanel}
    <div style="margin-bottom:18px;"><button type="button" class="btn btn-g" style="padding:4px 10px;font-size:10px;" onclick="document.getElementById('adBalanceCheckPanel')?.scrollIntoView({behavior:'smooth'})">Check ad account balance</button></div>

    ${isAdmin ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Buyer payment collection accounts</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Customers pay into these -- not spendable by the buyer, just where their orders' payments land before flowing into the company wallet above.</div>
      ${!buyers?.length ? `<div class="empty"><div class="empty-ico">💰</div>No media buyers yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Buyer</th><th>Account number</th><th>Bank</th></tr>
        ${buyers.map(b => `<tr>
          <td class="s n">${escH(b.name)} <span style="color:var(--muted)">[${escH(b.code)}]</span></td>
          <td class="n">${escH(b.dedicated_account_number || "—")}</td>
          <td class="s">${escH(b.dedicated_account_bank || "—")}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>` : ""}

    ${isAdmin ? (() => {
      // "approved" with no transfer is an older request from before account numbers were required: its money is set aside already.
      const pending = (fundRequests || []).filter(f => (f.status === "pending" || f.status === "approved") && !f.paystack_transfer_code);
      return `
    <div class="panel">
      <div class="ph"><div class="ph-title">Funding requests${pending.length ? ` (${pending.length} waiting)` : ""}</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">A buyer gives the amount and the Meta account number. Revora asked the bank who owns it. <b>Approve and send</b> asks for your transfer PIN, checks the Meta account name again, then sends the money. If the check fails nothing is sent and the request stays open.</div>
      ${!pending.length ? `<div class="empty"><div class="empty-ico">💸</div>No requests waiting.</div>` : pending.map(f => {
        const buyerName = (buyers || []).find(b => b.id === f.media_buyer_id)?.name || "—";
        const reserved = f.status === "approved" ? Number(f.amount_naira) : 0;
        const short = Number(f.amount_naira) > fundingWalletBalance + reserved;
        const hours = (Date.now() - new Date(f.requested_at).getTime()) / 3600000;
        const hasAcct = !!f.req_account_number;
        const summary = `<b>${fN(f.amount_naira)}</b> for <b>${escH(buyerName)}</b> to <b>${escH(f.req_account_name || "Meta")}</b> · ${escH(f.req_bank_name || "")} ${escH(f.req_account_number || "")}`;
        return `
        <div style="border-bottom:1px solid var(--border);padding:8px 0;">
          <div style="font-size:12.5px;"><b>${escH(buyerName)}</b> -- ${fN(f.amount_naira)}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-bottom:4px;">${escH(f.note || "")} -- ${ago(f.requested_at)}</div>
          ${hasAcct
            ? `<div style="font-size:11.5px;margin-bottom:4px;">To <b>${escH(f.req_account_name || "—")}</b> · ${escH(f.req_bank_name || "")} · <span style="font-family:'JetBrains Mono',monospace;">${escH(f.req_account_number)}</span> <span style="color:var(--muted);font-size:10px;">(checked ${f.req_verified_at ? ago(f.req_verified_at) : "—"})</span></div>`
            : `<div style="font-size:11px;color:var(--warn);margin-bottom:4px;">⚠️ Older request with no Meta account number. Decline it and ask the buyer to send a new one.</div>`}
          ${f.last_verify_error ? `<div style="font-size:10.5px;color:var(--danger);margin-bottom:4px;">⚠️ ${escH(f.last_verify_error)}</div>` : ""}
          ${hasAcct && hours >= 1 && !f.last_verify_error ? `<div style="font-size:10.5px;color:var(--warn);margin-bottom:4px;">⏳ Waiting ${hours < 24 ? Math.floor(hours) + " h" : Math.floor(hours / 24) + " d"}. Meta's account number may have expired: use Re-check, or just approve (it is checked again before anything is sent).</div>` : ""}
          ${short ? `<div style="font-size:10.5px;color:var(--danger);margin-bottom:4px;">⚠️ Funding wallet short by ${fN(Number(f.amount_naira) - fundingWalletBalance - reserved)}</div>` : ""}
          ${hasAcct && !short ? `<button type="button" class="btn btn-a fundSendBtn" data-id="${f.id}" data-summary="${escH(summary)}" style="padding:3px 10px;font-size:10px;">Approve and send</button>` : ""}
          ${hasAcct ? `<button type="button" class="btn fundRecheckBtn" data-id="${f.id}" style="padding:3px 10px;font-size:10px;">Re-check account</button>` : ""}
          <button type="button" class="btn fundDeclineBtn" data-id="${f.id}" style="padding:3px 10px;font-size:10px;">Decline</button>
        </div>`;
      }).join("")}
    </div>`;
    })() : ""}

    ${isAdmin && (buyers || []).filter(b => b.id !== myId).length ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Auto-approve for trusted buyers</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Switch this on for a buyer and their funding requests are sent to Meta <b>immediately</b>, with no PIN from you each time. Revora still checks that the account belongs to Meta, the funding wallet must cover it, and anything over your limits waits for your normal approval. You set the limits and your PIN is needed to change them.</div>
      ${(buyers || []).filter(b => b.id !== myId).map(b => `
      <div style="border-bottom:1px solid var(--border);padding:8px 0;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div><b>${escH(b.name)}</b> <span style="color:var(--muted);font-size:10.5px;">[${escH(b.code)}]</span>
          <div style="font-size:10.5px;color:${b.auto_send_enabled ? "var(--ok,#16a34a)" : "var(--muted)"};">${b.auto_send_enabled ? `On · up to ${fN(b.auto_send_max_naira)} each, ${fN(b.auto_send_daily_max_naira)} a day` : "Off · every request needs your approval"}</div></div>
        <div>
          <button type="button" class="btn btn-a autoSendBtn" data-id="${b.id}" data-name="${escH(b.name)}" data-max="${b.auto_send_max_naira || ""}" data-day="${b.auto_send_daily_max_naira || ""}" style="padding:3px 10px;font-size:10px;">${b.auto_send_enabled ? "Change limits" : "Turn on"}</button>
          ${b.auto_send_enabled ? `<button type="button" class="btn autoSendOffBtn" data-id="${b.id}" data-name="${escH(b.name)}" style="padding:3px 10px;font-size:10px;">Turn off</button>` : ""}
        </div>
      </div>`).join("")}
    </div>` : ""}

    ${!isAdmin && myId ? (() => {
      const myBuyerRow = (buyers || []).find(b => b.id === myId);
      return `
    <div class="panel">
      <div class="ph"><div class="ph-title">Your payment collection account</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Customers pay into this account after their order is confirmed. It's not a wallet you can spend from -- every confirmed payment here flows into the company's wallet, and you request funds from the admin below.</div>
      ${myBuyerRow?.dedicated_account_number ? `
      <div style="font-size:18px;font-weight:700;font-family:'JetBrains Mono',monospace;">${escH(myBuyerRow.dedicated_account_number)}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px;">${escH(myBuyerRow.dedicated_account_bank || "")}</div>
      ` : `<div style="font-size:11.5px;color:var(--muted);">Not set up yet -- this is created automatically the first time an order is confirmed against your name.</div>`}
    </div>`;
    })() : ""}

    <div class="panel" id="adBalanceCheckPanel">
      <div class="ph"><div class="ph-title">Ad account balance</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">Pull the live balance straight from Meta for any linked ad account.</div>
      ${!accountsList.length ? `<div class="empty"><div class="empty-ico">🔌</div>No ad accounts linked yet.</div>` : `
      <div class="fg">
        <div class="field"><label>Ad account</label>
          <select id="walletAdAcctSelect">
            ${accountsList.map(a => `<option value="${a.id}">${escH(a.nickname || a.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <button type="button" class="btn btn-a" id="walletCheckBalBtn" style="margin-top:8px;padding:4px 10px;font-size:10px;">Check balance</button>
      <div id="walletBalResult" style="margin-top:10px;"></div>
      `}
    </div>

    ${!isAdmin && myId ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Your requests</div></div>
      ${!myRequests.length ? `<div class="empty"><div class="empty-ico">💸</div>No requests yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Requested</th><th>Amount</th><th>Meta account</th><th>Status</th><th></th></tr>
        ${myRequests.map(f => {
          const open = f.status === "pending" && !f.paystack_transfer_code;
          return `<tr>
          <td>${ago(f.requested_at)}<div style="color:var(--muted);font-size:10px;">${escH(f.note || "")}</div></td>
          <td class="n">${fN(f.amount_naira)}</td>
          <td class="s">${f.destination_account_name ? `${escH(f.destination_account_name)} (${escH(f.destination_bank_name || "")})` : f.req_account_number ? `${escH(f.req_account_name || "")} · ${escH(f.req_bank_name || "")} ${escH(f.req_account_number)}` : "—"}</td>
          <td><span class="pill ${f.status === "transferred" ? "active" : f.status === "declined" ? "cancelled" : "pending"}">${f.status === "transferred" ? "sent to Meta" : f.status === "declined" ? "declined" : "waiting for admin"}</span>${f.last_verify_error && open ? `<div style="font-size:9.5px;color:var(--danger);margin-top:2px;">Admin could not verify the Meta account. Send a fresh account number.</div>` : ""}${f.transfer_error ? `<div style="font-size:9.5px;color:var(--danger);margin-top:2px;">${escH(f.transfer_error)}</div>` : ""}</td>
          <td>${open ? `<button type="button" class="btn btn-a frChangeBtn" data-id="${f.id}" style="padding:3px 10px;font-size:10px;">Fresh account number</button> <button type="button" class="btn frCancelBtn" data-id="${f.id}" style="padding:3px 10px;font-size:10px;">Cancel</button>` : ""}</td>
        </tr>`; }).join("")}
      </table></div>`}
    </div>` : ""}

    ${isAdmin ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Revenue by buyer</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Attribution only -- for ROAS and seeing who's generating what. Not a per-buyer balance; the spendable pool is the company wallet above.</div>
      ${!buyers?.length ? `<div class="empty"><div class="empty-ico">💰</div>No media buyers yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Buyer</th><th>Confirmed revenue</th><th>Approved against it</th><th>Sent to Meta</th></tr>
        ${buyers.map(b => {
          const w = walletBalances[b.id] || walletBlank();
          return `<tr>
            <td class="s n">${escH(b.name)} <span style="color:var(--muted)">[${escH(b.code)}]</span></td>
            <td class="n">${fN(w.confirmed)}</td>
            <td class="n">${fN(w.approved)}</td>
            <td class="n">${fN(w.transferred)}</td>
          </tr>`;
        }).join("")}
      </table></div>`}
    </div>` : ""}

    <div class="panel">
      <div class="ph"><div class="ph-title">Transactions</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Every confirmed customer payment (credit) and every transfer sent to an ad account (debit)${isAdmin ? ", across all buyers" : ""} -- so you can always tell which is which.</div>
      ${!ledger.length ? `<div class="empty"><div class="empty-ico">📒</div>No transactions yet.</div>` : ledger.slice(0, 50).map(t => `
      <div class="ledger-row">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <div class="ledger-ico">${t.type === "credit" ? "⬇" : "⬆"}</div>
          <div style="min-width:0;">
            <div style="font-size:12.5px;font-weight:600;">${escH(t.label)}${isAdmin && t.buyerName ? ` -- ${escH(t.buyerName)}` : ""}</div>
            <div style="font-size:10.5px;color:var(--muted);">${t.detail ? escH(t.detail) + " -- " : ""}${ago(t.date)}</div>
          </div>
        </div>
        <div class="ledger-amt ${t.type}">${t.type === "credit" ? "+" : "-"}${fN(t.amount)}</div>
      </div>`).join("")}
    </div>
  `;

  document.getElementById("walletCheckBalBtn")?.addEventListener("click", async (e) => {
    const btn = e.target;
    const result = document.getElementById("walletBalResult");
    const adAccountId = document.getElementById("walletAdAcctSelect").value;
    btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:10px;height:10px;border-width:1px;"></span>';
    try {
      const r = await sbFn("check-account-status", { ad_account_id: adAccountId });
      if (r.error) throw new Error(r.error);
      // check-account-status prefers Meta's funding_source_details (the real
      // remaining prepaid wallet balance) over the plain `balance` field
      // (accrued unbilled spend, not funds left) -- balance_source tells us
      // which one it actually got, so we can flag it when it had to fall
      // back. It also already writes balance_naira to the DB itself, so
      // there's nothing left to persist here.
      result.innerHTML = `
        <div style="font-size:20px;font-weight:700;color:var(--text);">${fN(r.balance_naira)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:4px;">${escH(r.name || "")} -- ${escH(r.status || "")} -- spent all-time: ${fN(r.amount_spent_naira)} -- spend cap: ${r.spend_cap_naira != null ? fN(r.spend_cap_naira) : "none set"}</div>
        ${r.balance_source === "accrued_spend_fallback" ? `<div style="font-size:10px;color:var(--warn);margin-top:4px;">⚠️ No wallet balance reported for this account -- showing accrued spend instead, which is not the same as funds remaining.</div>` : ""}
      `;
      await loadAccounts();
    } catch (err) {
      result.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = "Check balance";
    }
  });

  document.querySelectorAll(".fundSendBtn").forEach(btn => btn.addEventListener("click", () => bvShowSendPinModal(btn.dataset.id, btn.dataset.summary)));
  document.querySelectorAll(".fundRecheckBtn").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      const r = await sbFn("fund-request-send", { action: "recheck", fund_request_id: btn.dataset.id });
      if (r.error) throw new Error(r.error);
      bvToast(r.verified ? `Still valid: ${r.account_name}` : "Could not verify. See the note on the request.");
    } catch (err) { alert(err.message); }
    renderWallet(el);
  }));
  document.querySelectorAll(".fundDeclineBtn").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Decline this funding request?")) return;
    btn.disabled = true;
    const { error } = await supabaseClient.from("fund_requests").update({
      status: "declined",
      decided_at: new Date().toISOString(),
      decided_by: sessionData.user.id,
    }).eq("id", btn.dataset.id).in("status", ["pending", "approved"]);
    if (error) { alert("Could not update request: " + error.message); btn.disabled = false; return; }
    sbFn("send-internal-whatsapp", { type: "fund_request_decided", fund_request_id: btn.dataset.id }).catch(() => {});
    sbFn("send-internal-email", { type: "fund_request_decided", fund_request_id: btn.dataset.id }).catch(() => {});
    renderWallet(el);
  }));
  const autoModal = (id, name, enable, max, day) => {
    bvCloseModal();
    const overlay = document.createElement("div");
    overlay.id = "bvModalOverlay"; overlay.className = "bv-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
    overlay.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div class="ph-title" style="margin-bottom:6px;">${enable ? "Auto-approve for " + escH(name) : "Turn off auto-approve for " + escH(name)}</div>
      <form id="autoSendForm" novalidate>
        ${enable ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Requests up to these limits are sent to Meta at once, with no PIN from you. Anything bigger waits for your approval.</div>
        <div class="fg">
          <div class="field"><label>Most for one request (₦) *</label><input id="autoMax" type="number" min="100" step="1" value="${max || ""}" placeholder="e.g. 50000"></div>
          <div class="field"><label>Most per 24 hours (₦) *</label><input id="autoDay" type="number" min="100" step="1" value="${day || ""}" placeholder="e.g. 150000"></div>
        </div>` : ""}
        <div class="field" style="margin-top:8px;"><label>Your transfer PIN *</label><input id="autoPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 to 6 digits"></div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:12px;" id="autoBtn">${enable ? "Save" : "Turn off"}</button>
        <div id="autoMsg"></div>
      </form></div>`;
    document.body.appendChild(overlay);
    document.getElementById("autoSendForm").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = document.getElementById("autoBtn"), msg = document.getElementById("autoMsg");
      const pin = document.getElementById("autoPin").value.trim();
      if (!/^\d{4,6}$/.test(pin)) { msg.innerHTML = `<div class="msg err">❌ Enter your 4 to 6 digit transfer PIN.</div>`; return; }
      const body = { action: "set_auto", media_buyer_id: id, enabled: enable, pin };
      if (enable) { body.max_naira = Number(document.getElementById("autoMax").value); body.daily_max_naira = Number(document.getElementById("autoDay").value); }
      btn.disabled = true;
      try {
        const r = await sbFn("fund-request-send", body);
        if (r.error) throw new Error(r.error);
        bvCloseModal(); bvToast(enable ? "Auto-approve is on" : "Auto-approve is off"); renderWallet(el);
      } catch (err) { msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`; btn.disabled = false; }
    });
  };
  document.querySelectorAll(".autoSendBtn").forEach(btn => btn.addEventListener("click", () => autoModal(btn.dataset.id, btn.dataset.name, true, btn.dataset.max, btn.dataset.day)));
  document.querySelectorAll(".autoSendOffBtn").forEach(btn => btn.addEventListener("click", () => autoModal(btn.dataset.id, btn.dataset.name, false)));
  document.querySelectorAll(".frChangeBtn").forEach(btn => btn.addEventListener("click", () => bvShowRequestFundsModal(btn.dataset.id)));
  document.querySelectorAll(".frCancelBtn").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Cancel this request?")) return;
    btn.disabled = true;
    const r = await sbFn("fund-request-submit", { action: "cancel", fund_request_id: btn.dataset.id }).catch(e => ({ error: e.message }));
    if (r.error) { alert(r.error); btn.disabled = false; return; }
    renderWallet(el);
  }));
}



// Event Manager, per ad account: datasets (pixels), event counts, browser vs server, create / pick a dataset, send a test event.
let bvEventsAcct = null, bvEventsDays = 7;
async function bvEventsPanel() {
  const box = document.getElementById("eventsPanel");
  if (!box) return;
  const accts = accountsList || [];
  if (!accts.length) { box.innerHTML = `<div class="ph"><div class="ph-title">Event Manager</div></div><div class="empty"><div class="empty-ico">📡</div>Add or get an ad account first. Its datasets show here.</div>`; return; }
  if (!bvEventsAcct || !accts.some(a => a.id === bvEventsAcct)) bvEventsAcct = (activeAccountId && accts.some(a => a.id === activeAccountId)) ? activeAccountId : accts[0].id;
  box.innerHTML = `<div class="ph"><div class="ph-title">Event Manager</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Your datasets (pixels) and the events they receive, per ad account. Switch accounts to see another one.</div>
    <div class="fg"><div class="field"><label>Ad account</label><select id="evAcct">${accts.map(a => `<option value="${a.id}" ${a.id === bvEventsAcct ? "selected" : ""}>${escH(a.nickname || a.name)}${a.billing_mode === "managed" ? " · Revora" : ""}</option>`).join("")}</select></div>
    <div class="field"><label>Period</label><select id="evDays"><option value="1" ${bvEventsDays === 1 ? "selected" : ""}>Last 24 hours</option><option value="7" ${bvEventsDays === 7 ? "selected" : ""}>Last 7 days</option><option value="30" ${bvEventsDays === 30 ? "selected" : ""}>Last 30 days</option></select></div></div>
    <div id="evBody" style="margin-top:10px;"><div class="empty">Loading…</div></div>`;
  box.querySelector("#evAcct").addEventListener("change", e => { bvEventsAcct = e.target.value; bvEventsPanel(); });
  box.querySelector("#evDays").addEventListener("change", e => { bvEventsDays = Number(e.target.value); bvEventsPanel(); });
  const body = box.querySelector("#evBody");
  const r = await sbFn("events-manager", { action: "overview", ad_account_id: bvEventsAcct, days: bvEventsDays }).catch(err => ({ error: err.message }));
  if (r.error) { body.innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; return; }
  const ago2 = t => { if (!t) return "never"; const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
  const keyEv = ["PageView", "ViewContent", "InitiateCheckout", "Lead", "Purchase"];
  let html = "";
  if (r.note) html += `<div style="font-size:11px;color:var(--warn);margin-bottom:8px;">${escH(r.note)}</div>`;
  if (!r.pixels.length) html += `<div class="empty"><div class="empty-ico">📡</div>This ad account has no dataset yet.</div>${r.can_create ? `<button type="button" class="btn btn-a" id="evCreate" style="margin-top:8px;">Create a dataset</button>` : ""}`;
  for (const p of r.pixels) {
    const total = Object.values(p.events).reduce((t, n) => t + n, 0);
    const max = Math.max(1, ...p.daily.map(d => d.total));
    const srv = p.methods.server || p.methods.SERVER || 0, brw = p.methods.browser || p.methods.BROWSER || 0;
    const others = Object.keys(p.events).filter(k => !keyEv.includes(k));
    html += `<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
        <div><b>${escH(p.name || "Dataset")}</b> <span style="color:var(--muted);font-size:10.5px;font-family:'JetBrains Mono',monospace;">${escH(p.id)}</span>
          <div style="font-size:10.5px;color:var(--muted);">Last event ${ago2(p.last_fired_time)}${p.unavailable ? " · unavailable" : ""}</div></div>
        <div>${p.active ? `<span class="pill active">Used by this ad account</span>` : `<button type="button" class="btn btn-a evUse" data-id="${p.id}" style="padding:3px 10px;font-size:10px;">Use this dataset</button>`}</div></div>
      ${p.stats_error ? `<div style="font-size:10.5px;color:var(--danger);margin-top:6px;">${escH(p.stats_error)}</div>` : `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;">${keyEv.map(k => `<div style="flex:1;min-width:92px;background:var(--panel2);border-radius:8px;padding:6px 8px;"><div style="font-size:9.5px;color:var(--muted);">${k}</div><div style="font-size:15px;font-weight:700;">${(p.events[k] || 0).toLocaleString()}</div></div>`).join("")}</div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:46px;margin-bottom:4px;">${p.daily.map(d => `<div title="${escH(d.date)}: ${d.total}" style="flex:1;background:var(--accent);opacity:.75;border-radius:2px 2px 0 0;height:${Math.max(3, Math.round(d.total / max * 46))}px;"></div>`).join("") || `<span style="font-size:10.5px;color:var(--muted);">No events in this period.</span>`}</div>
      <div style="font-size:10.5px;color:var(--muted);">${total.toLocaleString()} events · from browser ${brw.toLocaleString()} · from server (Conversions API) ${srv.toLocaleString()}${others.length ? " · other: " + others.slice(0, 5).map(k => escH(k) + " " + p.events[k]).join(", ") : ""}</div>`}
      <details style="margin-top:8px;"><summary style="font-size:11px;cursor:pointer;color:var(--accent);">Send a test event</summary>
        <div style="font-size:10.5px;color:var(--muted);margin:6px 0;">In Meta's Events Manager, open this dataset's <b>Test events</b> tab and copy the test code. Paste it here to send a server event and see it arrive there.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;"><input class="evCode" data-id="${p.id}" placeholder="TEST12345" style="flex:1;min-width:120px;"><select class="evName" data-id="${p.id}">${["PageView", "ViewContent", "InitiateCheckout", "Lead", "Purchase"].map(n => `<option>${n}</option>`).join("")}</select><button type="button" class="btn btn-a evTest" data-id="${p.id}" style="padding:3px 10px;font-size:10px;">Send test</button></div>
        <div class="evTestMsg" data-id="${p.id}" style="margin-top:6px;"></div></details>
    </div>`;
  }
  html += `<div style="font-size:10.5px;color:var(--muted);">Server events (Conversions API): Revora sends a purchase event from your orders automatically for any ad account that has a dataset, so they appear above under "from server".</div>`;
  if (r.pixels.length) html += `<div id="evQuality" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;"><b>Customer details sent with events</b><div style="font-size:10.5px;color:var(--muted);">Loading…</div></div>
    <div id="evConv" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;"><b>Custom conversions</b><div style="font-size:10.5px;color:var(--muted);">Loading…</div></div>`;
  body.innerHTML = html;
  if (r.pixels.length) bvEventsExtras(body, r);
  body.querySelector("#evCreate")?.addEventListener("click", async e => {
    e.target.disabled = true; e.target.textContent = "Creating…";
    const c = await sbFn("events-manager", { action: "create_dataset", ad_account_id: bvEventsAcct }).catch(err => ({ error: err.message }));
    if (c.error) { alert(c.error); e.target.disabled = false; e.target.textContent = "Create a dataset"; return; }
    bvToast(c.existing ? "Dataset linked" : "Dataset created"); await loadAccounts(); bvEventsPanel();
  });
  body.querySelectorAll(".evUse").forEach(b2 => b2.addEventListener("click", async () => {
    b2.disabled = true;
    const c = await sbFn("events-manager", { action: "use_dataset", ad_account_id: bvEventsAcct, pixel_id: b2.dataset.id }).catch(err => ({ error: err.message }));
    if (c.error) { alert(c.error); b2.disabled = false; return; }
    bvToast("This ad account now uses that dataset"); await loadAccounts(); bvEventsPanel();
  }));
  body.querySelectorAll(".evTest").forEach(b2 => b2.addEventListener("click", async () => {
    const id = b2.dataset.id, msg = body.querySelector(`.evTestMsg[data-id="${id}"]`);
    const code = body.querySelector(`.evCode[data-id="${id}"]`).value.trim(), name = body.querySelector(`.evName[data-id="${id}"]`).value;
    b2.disabled = true; b2.textContent = "Sending…";
    const c = await sbFn("events-manager", { action: "test_event", ad_account_id: bvEventsAcct, pixel_id: id, test_code: code, event_name: name }).catch(err => ({ error: err.message }));
    msg.innerHTML = c.error ? `<div class="msg err">❌ ${escH(c.error)}</div>` : `<div class="msg ok">✅ Sent ${escH(c.event_name)}. Meta received ${c.events_received}. Check the Test events tab.</div>`;
    b2.disabled = false; b2.textContent = "Send test";
  }));
}

// Customer-detail quality and custom conversions for the chosen ad account.
async function bvEventsExtras(body, r) {
  const q = await sbFn("events-manager", { action: "quality", ad_account_id: bvEventsAcct, days: bvEventsDays }).catch(err => ({ error: err.message }));
  const qb = body.querySelector("#evQuality");
  if (qb) {
    const names = { em: "Email", ph: "Phone", fn: "First name", ln: "Last name", ct: "City", st: "State", zp: "Postcode", country: "Country", external_id: "Customer ID", fbp: "Browser ID (fbp)", fbc: "Click ID (fbc)", client_ip_address: "IP address", client_user_agent: "Device info" };
    if (q.error) qb.innerHTML = `<b>Customer details sent with events</b><div class="msg err">❌ ${escH(q.error)}</div>`;
    else {
      const rows = Object.entries(q.keys || {}).sort((a, b) => b[1] - a[1]);
      const good = ["em", "ph", "fbc", "fbp", "external_id"];
      const have = good.filter(k => (q.keys || {})[k] > 0).length;
      qb.innerHTML = `<b>Customer details sent with events</b>
        <div style="font-size:10.5px;color:var(--muted);margin:4px 0 8px;">The more details each event carries (email, phone, click ID), the better Meta can match it to a person, and the better your ads optimise. Meta's own 0 to 10 match score is only shown inside Meta, so this lists what is actually being sent.</div>
        ${q.unavailable ? `<div style="font-size:11px;color:var(--warn);">${escH(q.unavailable)}</div>` : rows.length ? rows.map(([k, n]) => { const pc = q.total ? Math.min(100, Math.round(n / q.total * 100)) : 0; return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px;"><div style="width:130px;">${escH(names[k] || k)}</div><div style="flex:1;background:var(--panel2);border-radius:4px;height:8px;"><div style="width:${pc}%;background:var(--accent);height:8px;border-radius:4px;"></div></div><div style="width:78px;text-align:right;color:var(--muted);">${n.toLocaleString()} (${pc}%)</div></div>`; }).join("") + `<div style="font-size:11px;margin-top:8px;">${have >= 4 ? "✅ Good coverage." : have >= 2 ? "⚠️ Fair. Sending email and phone with purchases will help." : "⚠️ Low. Few customer details are reaching Meta."}</div>` : `<div style="font-size:11px;color:var(--muted);">No customer details recorded in this period.</div>`}`;
    }
  }
  const cv = await sbFn("events-manager", { action: "conversions", ad_account_id: bvEventsAcct }).catch(err => ({ error: err.message }));
  const cb = body.querySelector("#evConv");
  if (!cb) return;
  const types = ["PURCHASE", "LEAD", "COMPLETE_REGISTRATION", "ADD_TO_CART", "INITIATED_CHECKOUT", "CONTENT_VIEW", "OTHER"];
  cb.innerHTML = `<b>Custom conversions</b>
    <div style="font-size:10.5px;color:var(--muted);margin:4px 0 8px;">Count a visit to a page as a result, for example any page whose address contains "thank-you".</div>
    ${cv.error ? `<div class="msg err">❌ ${escH(cv.error)}</div>` : (cv.items || []).length ? (cv.items || []).map(c => `<div style="border-bottom:1px solid var(--border);padding:5px 0;font-size:11.5px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><span><b>${escH(c.name)}</b> · ${escH(c.type || "")}</span><span style="color:var(--muted);">${escH((() => { try { return "page contains " + (JSON.parse(c.rule)?.url?.i_contains ?? JSON.parse(c.rule)?.and?.[0]?.url?.i_contains ?? ""); } catch { return ""; } })())}${c.last_fired_time ? " · last " + new Date(c.last_fired_time).toLocaleDateString() : ""}</span></div>`).join("") : `<div style="font-size:11px;color:var(--muted);">None yet.</div>`}
    <div class="fg" style="margin-top:8px;"><div class="field"><label>Name</label><input id="cvName" placeholder="Thank-you page visit"></div>
    <div class="field"><label>Page address contains</label><input id="cvContains" placeholder="thank-you"></div>
    <div class="field"><label>Counts as</label><select id="cvType">${types.map(t => `<option>${t}</option>`).join("")}</select></div>
    <div class="field"><label>Value each (₦, optional)</label><input id="cvValue" type="number" min="0"></div></div>
    <button type="button" class="btn btn-a" id="cvAdd" style="margin-top:6px;">Create custom conversion</button><div id="cvMsg" style="margin-top:6px;"></div>`;
  cb.querySelector("#cvAdd").addEventListener("click", async e => {
    const msg = cb.querySelector("#cvMsg"); e.target.disabled = true;
    const c = await sbFn("events-manager", { action: "conversion_create", ad_account_id: bvEventsAcct, name: cb.querySelector("#cvName").value, contains: cb.querySelector("#cvContains").value, type: cb.querySelector("#cvType").value, value: cb.querySelector("#cvValue").value }).catch(err => ({ error: err.message }));
    e.target.disabled = false;
    if (c.error) { msg.innerHTML = `<div class="msg err">❌ ${escH(c.error)}</div>`; return; }
    bvToast("Custom conversion created"); bvEventsPanel();
  });
}

function bvSetSec(id) { document.querySelector(`.set-nav-btn[data-sec="${id}"]`)?.click(); }
async function bvMakeDataset(btn, accountId) {
  btn.disabled = true; btn.textContent = "Creating…";
  const r = await sbFn("events-manager", { action: "create_dataset", ad_account_id: accountId }).catch(err => ({ error: err.message }));
  if (r.error) { alert(r.error); btn.disabled = false; btn.textContent = "Create dataset"; return; }
  bvToast(r.existing ? "Dataset linked" : "Dataset created"); await loadAccounts(); if (activeTab === "settings") render();
}

// "Buy a Meta ad account from Revora": the customer takes a ready ad account from Revora's pool, names it, and can create a dataset (pixel) at once.
// A platform admin also sees the pool and can add ad accounts to it.
async function bvRevoraAcctPanel() {
  const box = document.getElementById("revoraAcctPanel");
  if (!box) return;
  box.innerHTML = `<div class="ph"><div class="ph-title">Buy a Meta ad account from Revora</div></div><div class="empty">Loading…</div>`;
  const av = await sbFn("ad-account-pool", { action: "availability" }).catch(() => ({ error: "offline" }));
  const mine = (accountsList || []).filter(a => a.billing_mode === "managed");
  let html = `<div class="ph"><div class="ph-title">Buy a Meta ad account from Revora</div><div class="ph-count">${Number(av.fee || 0) ? "₦" + Number(av.fee).toLocaleString() + " each" : ""}</div></div>
    <div style="font-size:12.5px;color:var(--text2);margin-bottom:10px;">A ready Meta ad account, paid from your wallet.</div>`;
  if (mine.length) html += mine.map(a => `<div style="border-bottom:1px solid var(--border);padding:8px 0;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
      <div><b>${escH(a.nickname || a.name)}</b><div style="font-size:10.5px;color:var(--muted);">Dataset: ${escH(a.pixel_name || a.meta_pixel_id || "none yet")}</div></div>
      ${a.meta_pixel_id ? "" : `<button type="button" class="btn btn-a mkDatasetBtn" data-id="${a.id}" style="padding:3px 10px;font-size:10px;">Create dataset</button>`}</div>`).join("");
  if (av.error) html += `<div class="msg err" style="margin-top:8px;">❌ ${escH(av.error)}</div>`;
  else if (!av.available) html += `<div style="font-size:11.5px;color:var(--warn);margin-top:8px;">All Revora ad accounts are taken right now. Check back soon.</div>`;
  else html += `<form id="claimAcctForm" style="margin-top:10px;" novalidate>
      <div class="fg"><div class="field"><label>Name your ad account *</label><input id="claimName" placeholder="e.g. Quality Herb Main"></div></div>
      <label style="font-size:11.5px;display:flex;gap:6px;align-items:center;margin-top:6px;"><input type="checkbox" id="claimPixel" checked> Create a dataset (pixel) for it now</label>
      <div style="font-size:11.5px;margin-top:8px;">Price: <b>₦${Number(av.fee || 0).toLocaleString()}</b> from your wallet (balance ₦${Math.max(0, Math.round(av.wallet || 0)).toLocaleString()}).${(av.wallet || 0) < (av.fee || 0) ? ' <span style="color:var(--warn);"><a href="javascript:void(0)" onclick="bvGoToTab(&quot;wallet&quot;)" style="color:var(--accent);">Top up your wallet first</a>.</span>' : ""}</div>
      <button type="submit" class="btn btn-a btn-full" style="margin-top:10px;" id="claimBtn">Buy ad account · ₦${Number(av.fee || 0).toLocaleString()}</button><div id="claimMsg"></div></form>`;
  html += `<div id="poolAdmin"></div>`;
  box.innerHTML = html;
  box.querySelector("#claimAcctForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = box.querySelector("#claimBtn"), msg = box.querySelector("#claimMsg");
    const name = box.querySelector("#claimName").value.trim();
    if (name.length < 2) { msg.innerHTML = `<div class="msg err">❌ Give the ad account a name.</div>`; return; }
    btn.disabled = true; btn.textContent = "Setting it up…";
    const r = await sbFn("ad-account-pool", { action: "claim", name, create_pixel: box.querySelector("#claimPixel").checked }).catch(err => ({ error: err.message }));
    if (r.error) { msg.innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; btn.disabled = false; btn.textContent = "Buy ad account"; return; }
    bvToast("Ad account bought and ready"); if (r.pixel_note) alert(r.pixel_note);
    await loadAccounts(); renderSettings(document.getElementById("mainContent"));
  });
  box.querySelectorAll(".mkDatasetBtn").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Creating…";
    const r = await sbFn("ad-account-pool", { action: "create_pixel", ad_account_id: b.dataset.id }).catch(err => ({ error: err.message }));
    if (r.error) { alert(r.error); b.disabled = false; b.textContent = "Create dataset"; return; }
    bvToast("Dataset created"); await loadAccounts(); renderSettings(document.getElementById("mainContent"));
  }));
  // Platform admin only: the pool.
  const pool = await sbFn("ad-account-pool", { action: "pool_list" }).catch(() => ({ error: "x" }));
  if (pool.error) return;
  const pa = box.querySelector("#poolAdmin");
  const rows = pool.accounts || [];
  pa.innerHTML = `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;"><div class="ph-title" style="margin-bottom:6px;">Ad account pool (platform admin)</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Ad accounts in Revora's Business Manager that customers can take. Assign each one to Revora's system user in Business Manager first, then add its number here. ${rows.filter(r => r.status === "available").length} free.</div>
    <div class="tbl-wrap"><table><tr><th>Ad account</th><th>Name on Meta</th><th>Status</th><th></th></tr>
    ${rows.map(r => `<tr><td class="n">${escH(r.meta_ad_account_id)}</td><td class="s">${escH(r.meta_name || r.label || "")}</td><td>${escH(r.status)}</td><td>${r.status === "available" ? `<button type="button" class="btn btn-g poolRetire" data-id="${r.id}" style="padding:2px 8px;font-size:10px;">Retire</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="s">Empty. Add your first one below.</td></tr>`}</table></div>
    <form id="poolAddForm" style="margin-top:8px;display:flex;gap:6px;" novalidate><input id="poolAddId" placeholder="Ad account number" style="flex:1;"><button type="submit" class="btn btn-a" style="padding:4px 10px;font-size:10px;">Add to pool</button></form><div id="poolMsg"></div></div>`;
  sbFn("ad-account-pool", { action: "pool_earnings", days: 30 }).then(e => {
    if (e.error) return;
    pa.insertAdjacentHTML("afterbegin", `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;"><b>Last 30 days:</b> customers were billed ${fN(e.billed)}, Meta charged ${fN(e.raw)}, your earnings <b>${fN(e.profit)}</b>.</div>`);
  }).catch(() => {});
  pa.querySelector("#poolAddForm").addEventListener("submit", async e => {
    e.preventDefault();
    const r = await sbFn("ad-account-pool", { action: "pool_add", meta_ad_account_id: pa.querySelector("#poolAddId").value }).catch(err => ({ error: err.message }));
    if (r.error) { pa.querySelector("#poolMsg").innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; return; }
    bvToast("Added to the pool"); bvRevoraAcctPanel();
  });
  pa.querySelectorAll(".poolRetire").forEach(b => b.addEventListener("click", async () => { await sbFn("ad-account-pool", { action: "pool_retire", id: b.dataset.id }); bvRevoraAcctPanel(); }));
}