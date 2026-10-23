/** Canonical URL configuration shared by the viewer, browser launcher and actions. */
export function normalizeBasePath(input = "/") {
  if (typeof input !== "string" || input === "") throw new Error("HAB_BASE_PATH must be an absolute path.");
  const allowed = "/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  if (!input.startsWith("/") || input.includes("//") ||
      [...input].some((character) => !allowed.includes(character))) {
    throw new Error("HAB_BASE_PATH must be a plain absolute path containing only letters, digits, /, _ and -.");
  }
  return input === "/" ? "/" : input.replace(/\/$/, "") + "/";
}

export function prefixedPath(basePath, route = "") {
  if (typeof route !== "string" || route.startsWith("//") || route.includes("..")) throw new Error("Invalid route.");
  return basePath + route.replace(/^\//, "");
}

export function relativeRoute(pathname, basePath) {
  if (pathname === basePath) return "/";
  if (basePath !== "/" && pathname === basePath.slice(0, -1)) return null;
  if (!pathname.startsWith(basePath)) return null;
  return "/" + pathname.slice(basePath.length);
}

export function assertPublicUrl(value, basePath) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      !["http:", "https:"].includes(url.protocol)) {
    throw new Error("HAB_PUBLIC_URL must be a clean HTTP(S) URL.");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("HAB_PUBLIC_URL requires HTTPS except for loopback development.");
  }
  if (url.pathname !== basePath) {
    throw new Error(`HAB_PUBLIC_URL pathname must match HAB_BASE_PATH (${basePath}).`);
  }
  return url;
}

export function configuredUrls(env = process.env) {
  const basePath = normalizeBasePath(env.HAB_BASE_PATH || "/");
  const port = Number(env.HAB_PORT || "7931");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid HAB_PORT.");
  const defaultLocal = `http://127.0.0.1:${port}${basePath}`;
  const publicUrl = assertPublicUrl(env.HAB_PUBLIC_URL || defaultLocal, basePath);
  const handoffUrl = new URL(env.HAB_URL || defaultLocal);
  if (!["http:", "https:"].includes(handoffUrl.protocol) ||
      handoffUrl.username || handoffUrl.password || handoffUrl.search || handoffUrl.hash) {
    throw new Error("HAB_URL must be a clean HTTP(S) URL.");
  }
  // Legacy HAB_URL values contained only the host: append HAB_BASE_PATH.
  if (handoffUrl.pathname === "/" && basePath !== "/") handoffUrl.pathname = basePath;
  if (handoffUrl.pathname !== basePath) throw new Error("HAB_URL pathname must match HAB_BASE_PATH.");
  return { basePath, publicUrl, handoffUrl, port };
}

export function parseAllowedOrigins(value = "") {
  return value.split(/[\s,]+/).filter(Boolean).map((input) => {
    const url = new URL(input);
    if (url.origin !== input || url.username || url.password ||
        !["http:", "https:"].includes(url.protocol)) {
      throw new Error("HAB_ALLOWED_ORIGINS entries must be exact HTTP(S) origins.");
    }
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("HAB_ALLOWED_ORIGINS requires HTTPS for non-loopback origins.");
    }
    return url.origin;
  });
}
