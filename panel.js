const el = id => document.getElementById(id);
const filters = {all:"全部",blue:"仅蓝 V",following:"互关",open:"我未回关",blueOpen:"蓝 V 且我未回关",new:"新发现",pending:"已申请",unknown:"待确认"};
let result = [], fresh = null, shown = 60, filter = "all", resultOwner = "", ownerId = "";
let scanning = false, paused = false, cancelled = false, refreshing = false, connection = null;
let clearTimer = 0, clearing = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const cacheKey = handle => "verifiedReview:" + handle.toLowerCase();
function matches(r, kind) {
  switch (kind) {
    case "all": return true;
    case "blue": return r.blue === true;
    case "blueOpen": return r.blue === true && r.state === "open";
    case "new": return !!fresh?.has(r.id);
    default: return r.state === kind;
  }
}
function visibleRows() {
  const q = el("query").value.trim().replace(/^@/,"").toLowerCase();
  return result.filter(r => matches(r,filter) && (!q || [r.handle,r.name].some(s=>s?.toLowerCase().includes(q))));
}
function controls() {
  el("start").disabled = scanning || clearing || !connection?.handle;
  el("pause").disabled = !scanning || paused || cancelled;
  el("resume").disabled = !scanning || !paused || cancelled;
  el("stop").disabled = !scanning || cancelled;
  el("clear").disabled = scanning || clearing || (!ownerId && !result.length);
  el("connect").disabled = scanning || clearing;
}
function renderList() {
  const rows = visibleRows(), list = el("list");
  list.replaceChildren();
  for (const r of rows.slice(0,shown)) {
    const li = document.createElement("li"); li.className = "row";
    const a = document.createElement("a");
    a.href = "https://x.com/" + encodeURIComponent(r.handle); a.target = "_blank"; a.rel = "noopener noreferrer";
    const add = (cls, value) => {
      const span = document.createElement("span"); span.className = cls; span.textContent = value; a.append(span);
    };
    add("name",r.name || r.handle);
    if (r.blue) add("tag blue","蓝 V");
    add("tag " + r.state,filters[r.state]);
    if (fresh?.has(r.id)) add("tag","新发现");
    add("handle","@" + r.handle);
    if (r.bio) add("bio",r.bio);
    li.append(a); list.append(li);
  }
  if (!rows.length) {
    const li = document.createElement("li"); li.className = "empty";
    li.textContent = result.length ? "没有匹配的账号" : scanning ? "等待读取名单…" : "暂无扫描结果";
    list.append(li);
  }
  el("more").hidden = rows.length <= shown; el("csv").disabled = !rows.length;
}
function render() {
  for (const button of el("filters").children) {
    const k = button.dataset.filter;
    const n = k === "new" && !fresh ? "—" : result.filter(r=>matches(r,k)).length;
    button.lastChild.textContent = n;
    button.setAttribute("aria-pressed", String(k === filter));
    button.disabled = k === "new" && !fresh;
    const stat = {all:"nAll",blue:"nBlue",following:"nMutual",open:"nOpen"}[k];
    if (stat) el(stat).textContent = n;
  }
  controls(); renderList();
}
for (const [k,label] of Object.entries(filters)) {
  const button = document.createElement("button"); button.dataset.filter = k;
  button.append(label,document.createElement("b")); el("filters").append(button);
  button.onclick = () => { filter = k; shown = 60; render(); };
}
el("query").oninput = () => { shown = 60; renderList(); };
el("more").onclick = () => { shown += 60; renderList(); };
el("stop").onclick = () => { cancelled = true; controls(); };
el("pause").onclick = () => { paused = true; controls(); status("已暂停 · 已扫描 " + result.length + " 人"); };
el("resume").onclick = () => { paused = false; controls(); status("正在继续扫描…"); };
function status(s) { el("status").textContent = s; }
function incomplete(s) { status("本次未完整 · " + s + "。已读 " + result.length + " 人，上次完整记录保留。"); }
function resetView() {
  result = []; fresh = null; shown = 60; filter = "all"; ownerId = ""; el("query").value = "";
  clearTimeout(clearTimer); el("clear").textContent = "清空数据";
}
el("csv").onclick = () => {
  const escape = value => {
    let s = String(value ?? "");
    if (/^[\s\uFEFF]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g,'""') + '"';
  };
  const rows = visibleRows().map(r => [r.name,r.handle,r.blue ? "是" : "未确认",filters[r.state],
    fresh ? (fresh.has(r.id) ? "是" : "否") : "", "https://x.com/" + r.handle]);
  const csv = [["显示名","用户名","明确蓝 V","回关状态","新发现的待回关","主页"],...rows].map(r=>r.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));
  const a = document.createElement("a"); a.href = url; a.download = resultOwner + "-认证关注者.csv";
  a.click(); setTimeout(()=>URL.revokeObjectURL(url),5000);
};
el("clear").onclick = async () => {
  if (el("clear").textContent !== "确认清空？") {
    el("clear").textContent = "确认清空？";
    clearTimer = setTimeout(()=>{ el("clear").textContent = "清空数据"; },4000); return;
  }
  clearing = true; controls();
  try {
    await navigator.locks.request("verified-review-scan",{ifAvailable:true},async lock=>{
      if (!lock) { status("其他窗口正在处理名单，请稍后清空。"); return; }
      const key = cacheKey(resultOwner), saved = (await chrome.storage.local.get(key))[key];
      const ids = new Set([ownerId,saved?.ownerId].filter(Boolean));
      await chrome.storage.local.remove([key,...Array.from(ids,id=>"verifiedBaseline:"+id)]);
      resetView(); status("已清空此账号的本地名单和对比记录。");
    });
  } catch (e) { status("清空失败：" + e.message); }
  finally { clearing = false; render(); }
};
async function findConnection() {
  const tabs = await chrome.tabs.query({currentWindow:true, url:"https://x.com/*"});
  tabs.sort((a,b) => Number(b.active)-Number(a.active) || (b.lastAccessed||0)-(a.lastAccessed||0));
  let first = null;
  for (const tab of tabs) {
    let identity;
    if (!tab.discarded) {
      try {
        const [frame] = await chrome.scripting.executeScript({target:{tabId:tab.id}, files:["identity.js"], injectImmediately:true});
        identity = frame?.result;
      } catch { /* A tab may close or navigate during discovery. */ }
    }
    const candidate = {tab, ...identity};
    first ??= candidate;
    if (candidate.handle || tab.active) return candidate;
  }
  return first;
}
async function showConnection(c) {
  connection = c;
  const handle = c?.handle, owner = handle?.toLowerCase() || "";
  el("connection").textContent = handle ? "已连接" : c?.signedOut ? "等待登录" : "未连接";
  el("connection").dataset.connected = String(!!handle);
  el("guideText").textContent = handle ? "@" + handle + " 的认证关注者" : c?.signedOut ? "登录 X 后将自动连接。" : "请打开 X 并登录你的账号。";
  el("connect").textContent = handle ? "打开我的认证关注者页" : c?.signedOut ? "前往 X 登录" : "打开 X";
  if (owner !== resultOwner) {
    resetView(); resultOwner = owner; status("尚未开始扫描"); render();
    if (owner) {
      const key = cacheKey(owner), saved = (await chrome.storage.local.get(key))[key];
      if (saved && !scanning && !clearing && resultOwner === owner) {
        ownerId = saved.ownerId; result = saved.rows; fresh = saved.fresh ? new Set(saved.fresh) : null;
        status("上次完整扫描 · " + new Date(saved.at).toLocaleString("zh-CN")); render();
      }
    }
  }
  controls();
}
async function refreshConnection() {
  if (scanning || refreshing || clearing) return;
  refreshing = true;
  try {
    const c = await findConnection();
    if (!scanning && !clearing) await showConnection(c);
  } catch { if (!scanning && !clearing) await showConnection(null); }
  finally { refreshing = false; }
}
el("connect").onclick = async () => {
  const c = await findConnection();
  if (c?.handle) {
    const url = "https://x.com/" + c.handle + "/verified_followers";
    const tabs = await chrome.tabs.query({currentWindow:true,url:"https://x.com/*"});
    const existing = [c.tab,...tabs].find(t => t.url?.split(/[?#]/)[0].replace(/\/$/,"").toLowerCase() === url.toLowerCase());
    if (existing) await chrome.tabs.update(existing.id,{active:true});
    else await chrome.tabs.create({url});
    return;
  }
  if (c?.tab) {
    const needsLoginPage = c.signedOut && !c.tab.url?.startsWith("https://x.com/i/flow/");
    await chrome.tabs.update(c.tab.id, {active:true, ...(needsLoginPage ? {url:"https://x.com/i/flow/login"} : {})});
  } else {
    await chrome.tabs.create({url:"https://x.com/home"});
  }
  await refreshConnection();
};
render();
void refreshConnection();
setInterval(refreshConnection, 2000);
chrome.tabs.onActivated.addListener(refreshConnection);
chrome.tabs.onRemoved.addListener(refreshConnection);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || scanning || clearing || !resultOwner) return;
  const change = changes[cacheKey(resultOwner)];
  if (!change) return;
  resetView();
  if (change.newValue) {
    const saved = change.newValue;
    ownerId = saved.ownerId; result = saved.rows; fresh = saved.fresh ? new Set(saved.fresh) : null;
    status("上次完整扫描 · " + new Date(saved.at).toLocaleString("zh-CN"));
  } else status("此账号的本地名单已清空。");
  render();
});
async function message(id, step) {
  try { return await chrome.tabs.sendMessage(id, {type:"review-step",step}); }
  catch { return null; } // Normal during page reload.
}
async function scan() {
  const c = await findConnection();
  if (!c?.handle || c.handle.toLowerCase() !== connection?.handle?.toLowerCase()) {
    await showConnection(c); status("连接状态已更新，请确认账号后开始扫描。"); return;
  }
  const target = "https://x.com/" + c.handle + "/verified_followers";
  const isTarget = url => url?.split(/[?#]/)[0].replace(/\/$/,"").toLowerCase() === target.toLowerCase();
  const tabs = await chrome.tabs.query({currentWindow:true,url:"https://x.com/*"});
  let tab = [c.tab,...tabs].find(t => isTarget(t.url)), before;
  result = []; fresh = null; shown = 60; resultOwner = c.handle.toLowerCase();
  filter = "all"; el("query").value = ""; render();
  status("正在从名单第一页读取…");
  if (tab) {
    before = await message(tab.id, false);
    await chrome.tabs.update(tab.id, {active:true});
    await chrome.tabs.reload(tab.id);
  } else {
    tab = await chrome.tabs.create({url:target,active:true});
  }
  let currentDocument = null, progress = "", lastChange = Date.now(), lastRows = "";
  while (!cancelled) {
    await wait(650);
    if (cancelled) break;
    if (paused) { lastChange = Date.now(); continue; }
    const active = await chrome.tabs.get(tab.id).catch(() => null);
    if (!active || !active.active || !isTarget(active.pendingUrl || active.url)) {
      incomplete("已切换标签页或离开名单"); return;
    }
    const data = await message(tab.id, currentDocument);
    if (paused || cancelled) { lastChange = Date.now(); continue; }
    if (data?.problem) { incomplete(data.problem.replace(/。$/,"")); return; }
    if (data?.documentId && data.documentId !== before?.documentId) {
      if (currentDocument && data.documentId !== currentDocument) { incomplete("页面重新加载"); return; }
      currentDocument = data.documentId;
      if (!data.waiting) {
        if (data.ownerId) ownerId = data.ownerId;
        const nextRows = JSON.stringify(data.rows);
        if (nextRows !== lastRows) { lastRows = nextRows; result = data.rows; render(); }
        if (data.issue) { incomplete(data.issue); return; }
        if (data.end && data.ownerId) {
          const key = "verifiedBaseline:" + data.ownerId;
          const old = (await chrome.storage.local.get(key))[key];
          if (old) {
            const previous = new Set(old.ids);
            fresh = new Set(result.filter(r => r.state === "open" && !previous.has(r.id)).map(r => r.id));
            filter = "new";
          }
          const at = Date.now();
          const saved = {ownerId, at, fresh:fresh ? [...fresh] : null,
            rows:result.map(({id,handle,name,bio,state,blue})=>({id,handle,name,bio,state,blue:blue === true}))};
          await chrome.storage.local.set({[key]:{ids:result.map(r=>r.id), at}, [cacheKey(resultOwner)]:saved});
          status("@" + data.owner + " · 已读到名单末页。" + (old ? "已与 " + new Date(old.at).toLocaleString("zh-CN") + " 的完整记录比较。" : "首次完整扫描已建立基线，下次可查看新发现的账号。"));
          render(); return;
        }
        const stamp = data.pageCount + "/" + result.length;
        if (stamp !== progress) { lastChange = Date.now(); progress = stamp; }
        status("@" + data.owner + " · 已读取 " + data.pageCount + " 页，正在等待下一页…");
      }
    }
    if (Date.now() - lastChange > 18000) {
      incomplete("未收到后续分页或可信的末页标记"); return;
    }
  }
  incomplete("已手动停止");
}
el("start").onclick = async () => {
  scanning = true; paused = false; cancelled = false; controls();
  try {
    await navigator.locks.request("verified-review-scan",{ifAvailable:true}, async lock => {
      if (!lock) { status("另一个侧栏正在扫描，请先完成该次扫描。"); return; }
      await scan();
    });
  } catch (e) { incomplete("读取或保存失败：" + e.message); }
  finally { scanning = false; paused = false; controls(); await refreshConnection(); }
};
