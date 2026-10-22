import test from "node:test";import assert from "node:assert/strict";import{config}from "../src/cdp.js";
test("reject non-loopback",()=>assert.throws(()=>config({HAB_CDP_HOST:"evil.com"}),/loopback/));
test("reject invalid port",()=>assert.throws(()=>config({HAB_CDP_PORT:"bad"}),/port/));
test("allow local",()=>assert.deepEqual(config({}),{host:"127.0.0.1",port:9222}));
