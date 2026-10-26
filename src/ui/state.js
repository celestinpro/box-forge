// Settings live in the URL (#/quick-draw?s=...) so any box can be shared or
// bookmarked, and survive a reload.

function encode(obj) {
  const json = JSON.stringify(obj);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

export function readState(model) {
  const [path, query = ""] = location.hash.slice(1).split("?");
  if (path !== `/${model}`) return {};
  const s = new URLSearchParams(query).get("s");
  if (!s) return {};
  try {
    const v = decode(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function writeState(model, params, defaults) {
  const same = JSON.stringify(params) === JSON.stringify(defaults);
  const hash = same ? `#/${model}` : `#/${model}?s=${encode(params)}`;
  history.replaceState(null, "", hash);
}
