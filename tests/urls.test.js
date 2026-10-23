import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBasePath, relativeRoute, prefixedPath, configuredUrls, parseAllowedOrigins } from "../src/urls.js";

test("canonicalizes base paths without accepting host, dot or encoded paths", () => {
  assert.equal(normalizeBasePath("/"), "/");
  assert.equal(normalizeBasePath("/browser"), "/browser/");
  assert.equal(normalizeBasePath("/browser/"), "/browser/");
  assert.equal(normalizeBasePath("/tools/browser"), "/tools/browser/");
  for (const value of ["browser", "//evil", "/a//b", "/a/../b", "/a/./b", "/b?c", "/b#f", "/b%2f", "/b\\c", "/browser<iframe>", "/browser\"onclick"]) {
    assert.throws(() => normalizeBasePath(value), /HAB_BASE_PATH/);
  }
});

test("prefixes routes without mixing with root routes", () => {
  assert.equal(prefixedPath("/", "api/status"), "/api/status");
  assert.equal(prefixedPath("/browser/", "cdp"), "/browser/cdp");
  assert.equal(relativeRoute("/browser/cdp", "/browser/"), "/cdp");
  assert.equal(relativeRoute("/browser/", "/browser/"), "/");
  assert.equal(relativeRoute("/browser/api/status", "/browser/"), "/api/status");
  assert.equal(relativeRoute("/browserish/api/status", "/browser/"), null);
  assert.equal(relativeRoute("/api/status", "/browser/"), null);
});

test("separates public and internal URLs without URL path surprises", () => {
  const urls = configuredUrls({
    HAB_PORT: "7931", HAB_BASE_PATH: "/browser",
    HAB_PUBLIC_URL: "https://host.example/browser/",
    HAB_URL: "http://127.0.0.1:7931",
  });
  assert.equal(urls.publicUrl.href, "https://host.example/browser/");
  assert.equal(urls.handoffUrl.href, "http://127.0.0.1:7931/browser/");
  assert.equal(new URL("api/handoff", urls.handoffUrl).href, "http://127.0.0.1:7931/browser/api/handoff");
  assert.equal(configuredUrls({}).publicUrl.href, "http://127.0.0.1:7931/");
  for (const value of ["https://host.example/other/", "http://host.example/browser/", "https://user:pass@host.example/browser/", "https://host.example/browser/?token=x"]) {
    assert.throws(() => configuredUrls({HAB_BASE_PATH:"/browser",HAB_PUBLIC_URL:value}), /HAB_PUBLIC_URL/);
  }
});

test("only explicit HTTPS origins are accepted for remote deployments", () => {
  assert.deepEqual(parseAllowedOrigins("https://one.example https://two.example"), ["https://one.example","https://two.example"]);
  assert.deepEqual(parseAllowedOrigins("https://one.example,https://two.example"), ["https://one.example","https://two.example"]);
  assert.throws(() => parseAllowedOrigins("http://outside.example"), /HTTPS/);
  assert.throws(() => parseAllowedOrigins("https://outside.example/a"), /exact/);
});
