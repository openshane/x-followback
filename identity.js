// This also runs on demand in an existing X tab when the side panel opens.
function xReviewIdentity() {
  const href = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href");
  const profile = href && new URL(href, location.origin);
  const handle = profile?.origin === "https://x.com" && profile.pathname.match(/^\/(\w{1,15})\/?$/)?.[1];
  if (handle) return {handle};
  const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  for (const node of switcher?.querySelectorAll('[dir="ltr"]') ?? []) {
    const match = node.textContent.trim().match(/^@(\w{1,15})$/);
    if (match) return {handle:match[1]};
  }
  return {signedOut:location.pathname.startsWith("/i/flow/login") ||
    !!document.querySelector('a[data-testid="loginButton"], a[href="/login"]')};
}
xReviewIdentity();
