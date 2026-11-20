(() => {
  const owner = location.pathname.match(/^\/([\w]{1,15})\/verified_followers\/?$/i)?.[1].toLowerCase();
  if (!owner) return;
  const documentId = crypto.randomUUID();
  const pages = new Map(), consumed = new Set(), rows = new Map();
  let expected = "", ownerId = "", end = false, issue = "", pageCount = 0;
  function onRoute() {
    return location.pathname.toLowerCase().replace(/\/$/,"") === "/" + owner + "/verified_followers";
  }
  window.addEventListener("message", event => {
    const p = event.data;
    if (event.source !== window || event.origin !== location.origin || !onRoute() ||
        p?.channel !== "shane-verified-followers-page" || p.route !== location.pathname || end || issue) return;
    if (typeof p.cursor !== "string" || !/^\d+$/.test(p.ownerId)) return;
    if (ownerId && ownerId !== p.ownerId) { issue = "名单所属账号发生变化"; return; }
    ownerId = p.ownerId;
    if (consumed.has(p.cursor)) return;
    pages.set(p.cursor, p);
    while (pages.has(expected)) {
      const page = pages.get(expected);
      pages.delete(expected);
      consumed.add(expected);
      if (page.error) { issue = page.error; break; }
      for (const row of page.rows ?? []) rows.set(row.id, {...row, nativeState:row.state});
      pageCount++;
      if (page.unsupported) { issue = "部分名单条目无法识别"; break; }
      if (page.end) { end = true; break; }
      if (!page.next || consumed.has(page.next)) { issue = "分页标记缺失或重复"; break; }
      expected = page.next;
    }
  });
  function reconcileVisible() {
    const byHandle = new Map(Array.from(rows.values(), row => [row.handle.toLowerCase(), row]));
    for (const cell of document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]')) {
      // Match both the profile and the native action's user id. A bio link can point elsewhere.
      for (const link of cell.querySelectorAll('a[href^="/"]')) {
        const handle = link.getAttribute("href").slice(1).toLowerCase();
        const row = byHandle.get(handle);
        if (!row || row.inconsistent) continue;
        const button = cell.querySelector('[data-testid="' + row.id + '-follow"], [data-testid="' + row.id + '-unfollow"], [data-testid="' + row.id + '-cancel"]');
        if (!button) continue;
        const text = button.textContent.trim().toLowerCase();
        let visibleState = null;
        if (/^(pending|requested|已申请|已请求|已請求|等待批准|申請中)$/.test(text) || button.dataset.testid.endsWith("-cancel")) visibleState = "pending";
        else if (button.dataset.testid.endsWith("-unfollow")) visibleState = "following";
        else if (/^(follow back|follow|回关|回關|关注|关注回去|跟隨|跟随|回跟|跟隨回去)$/.test(text)) visibleState = "open";
        if (visibleState) row.state = row.nativeState === "unknown" || row.nativeState === visibleState ? visibleState : "unknown";
        break;
      }
    }
  }
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== "review-step") return;
    const account = xReviewIdentity().handle?.toLowerCase();
    if (!onRoute() || (account && account !== owner)) return reply({problem:"请打开当前登录账号自己的认证关注者页。"});
    if (!account) return reply({waiting:true, documentId});
    reconcileVisible();
    if (msg.step === documentId && !end && !issue && document.visibilityState === "visible") {
      const primary = document.querySelector('[data-testid="primaryColumn"]');
      const last = primary?.querySelectorAll('[data-testid="UserCell"]');
      if (last?.length) last[last.length-1].scrollIntoView({block:"end", behavior:"instant"});
      else window.scrollBy(0, innerHeight * 0.8);
    }
    reply({documentId, owner, ownerId, end, issue, pageCount, rows:[...rows.values()]});
  });
})();
