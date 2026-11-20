// Observe only responses requested by the native verified-followers page.
(() => {
  const route = location.pathname;
  const channel = "shane-verified-followers-page";
  function identify(input) {
    try {
      if (location.pathname !== route) return null;
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (![location.origin,"https://api.x.com"].includes(url.origin) || !/\/graphql\/[^/]+\/(BlueVerifiedFollowers|VerifiedFollowers)$/.test(url.pathname)) return null;
      const vars = JSON.parse(url.searchParams.get("variables") || "{}");
      if (!/^\d+$/.test(vars.userId ?? "")) return null;
      return {ownerId: String(vars.userId), cursor: vars.cursor ?? ""};
    } catch { return null; }
  }
  function publish(meta, data) {
    if (location.pathname === route) {
      window.postMessage({channel, route, ...meta, ...data}, location.origin);
    }
  }
  function decode(meta, body, status) {
    if (status !== 200 || body?.errors?.length) {
      return publish(meta, {error: status === 429 ? "X 暂时限制了加载" : "X 返回错误或不完整的响应"});
    }
    const subject = body?.data?.user?.result;
    if (subject?.rest_id && subject.rest_id !== meta.ownerId) return publish(meta, {error:"名单账号不一致"});
    const timeline = subject?.verified_followers_timeline ?? subject?.timeline;
    const instructions = timeline?.timeline?.instructions ?? timeline?.instructions;
    if (!Array.isArray(instructions)) return publish(meta, {error:"无法识别 X 返回的名单格式"});
    const rows = [];
    let next = null, terminated = false, hasEntries = false, unsupported = false;
    for (const ins of instructions) {
      if (ins.type === "TimelineTerminateTimeline" && ["Bottom","Both"].includes(ins.direction)) terminated = true;
      if (ins.type === "TimelineAddEntries" && Array.isArray(ins.entries)) hasEntries = true;
      for (const entry of ins.entries ?? (ins.entry ? [ins.entry] : [])) {
        const c = entry.content ?? {};
        if (c.cursorType === "Bottom" || entry.entryId?.startsWith("cursor-bottom")) {
          if (typeof c.value === "string") next = c.value;
          else unsupported = true;
          continue;
        }
        if (c.cursorType || entry.entryId?.startsWith("cursor-")) continue;
        const u = c.itemContent?.user_results?.result;
        if (!u) { unsupported = true; continue; }
        const old = u.legacy ?? u.core?.user_legacy ?? {};
        const rel = u.relationship_perspectives ?? {};
        const handle = u.core?.screen_name ?? old.screen_name;
        if (!/^\d+$/.test(u.rest_id ?? "") || !/^[\w]{1,15}$/.test(handle ?? "")) { unsupported = true; continue; }
        const following = rel.following ?? old.following ?? u.following;
        const requested = rel.follow_request_sent ?? old.follow_request_sent ?? u.follow_request_sent;
        const protectedUser = u.privacy?.protected ?? old.protected;
        let state = "unknown";
        if (following === true) state = "following";
        else if (requested === true) state = "pending";
        else if (following === false && (requested === false || protectedUser === false)) state = "open";
        const inconsistent = (rel.followed_by ?? old.followed_by) === false;
        rows.push({id:u.rest_id, handle, blue:u.is_blue_verified === true && !["business","government"].includes(String(u.verification?.verified_type ?? u.verified_type ?? old.verified_type ?? "").toLowerCase()), name:u.core?.name ?? old.name ?? handle,
          bio:u.profile_bio?.description ?? old.description ?? "", state:inconsistent ? "unknown" : state, inconsistent});
      }
    }
    if (!hasEntries && !terminated && next === null) unsupported = true;
    publish(meta, {rows, next, unsupported, end:terminated || next === "0" || (hasEntries && next === null && !unsupported)});
  }
  const nativeFetch = window.fetch;
  window.fetch = function(input, ...args) {
    const promise = nativeFetch.call(this, input, ...args);
    const meta = identify(input);
    if (meta) promise.then(response => response.clone().json().then(body => decode(meta, body, response.status)))
      .catch(() => publish(meta, {error:"名单请求未能读取"}));
    return promise;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    const meta = identify(url);
    if (meta) this.addEventListener("loadend", () => {
      try { decode(meta, this.responseType === "json" ? this.response : JSON.parse(this.responseText), this.status); }
      catch { publish(meta, {error:"名单响应未能读取"}); }
    }, {once:true});
    return open.call(this, method, url, ...args);
  };
})();
