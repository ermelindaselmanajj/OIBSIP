import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { createSessionApi } from "../src/services/createSessionApi.js";
import { clearToken, getToken, setToken, subscribeSession } from "../src/services/session.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = new EventTarget();

function adapter(status = 200, beforeResponse) {
  return async (config) => {
    beforeResponse?.(config);
    const response = { status, data: {}, config, headers: {}, statusText: "test" };
    if (status >= 400) throw new axios.AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
    return response;
  };
}

test("isolated sessions, notifications and stale logout protection", () => {
  storage.clear();
  let changes = 0;
  const unsubscribe = subscribeSession(() => changes++);
  setToken("user", "user-old");
  setToken("admin", "admin-token");
  setToken("user", "user-new");
  assert.equal(clearToken("user", "user-old"), false);
  assert.equal(getToken("user"), "user-new");
  assert.equal(clearToken("user", "user-new"), true);
  assert.equal(getToken("admin"), "admin-token");
  assert.equal(changes, 4);
  unsubscribe();
});

test("each API sends only its own bearer token", async () => {
  setToken("user", "customer");
  setToken("admin", "administrator");
  for (const [role, token, endpoint] of [["user", "customer", "/auth/me"], ["admin", "administrator", "/admin/me"]]) {
    const client = createSessionApi(role, "http://example.test/api");
    const response = await client.get(endpoint, { headers: { authorization: "Bearer wrong-role" }, adapter: adapter() });
    assert.equal(response.config.headers.get("Authorization"), `Bearer ${token}`);
  }
});

test("public auth failures send no bearer token and preserve both sessions", async () => {
  for (const [role, endpoint] of [["user", "/auth/login"], ["user", "/auth/register"], ["user", "/auth/forgot-password"], ["user", "/auth/reset-password/token"], ["admin", "/admin/login"]]) {
    const client = createSessionApi(role, "http://example.test/api");
    await assert.rejects(client.post(endpoint, {}, { headers: { authorization: "Bearer wrong-role" }, adapter: adapter(401, (config) => assert.equal(config.headers.has("Authorization"), false)) }));
  }
  assert.equal(getToken("user"), "customer");
  assert.equal(getToken("admin"), "administrator");
});

test("protected 401 clears only matching session; delayed 401 cannot clear new login", async () => {
  const client = createSessionApi("user", "http://example.test/api");
  await assert.rejects(client.get("/auth/me", { adapter: adapter(401) }));
  assert.equal(getToken("user"), null);
  assert.equal(getToken("admin"), "administrator");
  setToken("user", "old");
  await assert.rejects(client.get("/auth/me", { adapter: adapter(401, () => setToken("user", "new")) }));
  assert.equal(getToken("user"), "new");
});

test("network errors and 403 do not implicitly remove sessions", async () => {
  const client = createSessionApi("user", "http://example.test/api");
  await assert.rejects(client.get("/auth/me", { adapter: async () => { throw new Error("offline"); } }));
  await assert.rejects(client.get("/auth/me", { adapter: adapter(403) }));
  assert.equal(getToken("user"), "new");
});
