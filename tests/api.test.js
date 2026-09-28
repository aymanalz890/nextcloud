import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../api/server.js";
import { cleanPath, encodePath, davRows } from "../api/nextcloud.js";
import { fixture } from "./fake-nextcloud.js";
const origin = "http://localhost:8081";
async function setup(t) {
  const nc = fixture();
  await new Promise((resolve) => nc.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + nc.server.address().port;
  const api = createApp({ base, origin }).listen(0, "127.0.0.1");
  await new Promise((resolve) => api.on("listening", resolve));
  const address = "http://127.0.0.1:" + api.address().port;
  t.after(() => {
    api.closeAllConnections();
    api.close();
    nc.server.closeAllConnections();
    nc.server.close();
  });
  async function login(username = "ayman") {
    const r = await fetch(address + "/api/login", {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Requested-With": "Teamspace",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password: "test-app-password" }),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    const cookie = r.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    return {
      headers: {
        Cookie: cookie.split(";")[0],
        Origin: origin,
        "X-Requested-With": "Teamspace",
        "X-CSRF-Token": data.csrf,
        "Content-Type": "application/json",
      },
      data,
    };
  }
  return { ...nc, address, login };
}
test("path safety and literal special characters", () => {
  assert.equal(cleanPath("/Projects//brief.pdf/"), "/Projects/brief.pdf");
  for (const path of ["../x", "/a/../b", "/a/./b", "/a\\b", "/a\n"])
    assert.throws(() => cleanPath(path));
  assert.equal(
    encodePath("/Budget & cost #1.txt"),
    "/Budget%20%26%20cost%20%231.txt",
  );
  assert.equal(encodePath("/%2e%2e"), "/%252e%252e");
  assert.throws(() =>
    davRows('<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///etc/passwd">]><x/>'),
  );
});
test("canonical user identity, per-user credentials, cookies, CSRF and logout", async (t) => {
  const f = await setup(t),
    a = await f.login("Ayman@example.test");
  assert.equal(a.data.user.id, "ayman");
  assert.equal(JSON.stringify(a.data).includes("test-app-password"), false);
  let r = await fetch(f.address + "/api/files");
  assert.equal(r.status, 401);
  r = await fetch(f.address + "/api/files", { headers: a.headers });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(data.files.length > 0);
  assert.equal(data.folder.permissions, "RGDNVWCK");
  assert.match(f.log.at(-1).url, /\/files\/ayman\//);
  assert.equal(
    Buffer.from(
      f.log.at(-1).headers.authorization.slice(6),
      "base64",
    ).toString(),
    "Ayman@example.test:test-app-password",
  );
  r = await fetch(f.address + "/api/folders", {
    method: "POST",
    headers: { ...a.headers, Origin: "http://evil.test" },
    body: JSON.stringify({ path: "/No" }),
  });
  assert.equal(r.status, 403);
  r = await fetch(f.address + "/api/folders", {
    method: "POST",
    headers: { ...a.headers, "X-CSRF-Token": "wrong" },
    body: JSON.stringify({ path: "/No" }),
  });
  assert.equal(r.status, 403);
  r = await fetch(f.address + "/api/logout", {
    method: "POST",
    headers: a.headers,
    body: "{}",
  });
  assert.equal(r.status, 200);
  r = await fetch(f.address + "/api/me", { headers: a.headers });
  assert.equal(r.status, 401);
});
test("file lifecycle, streamed upload/download, revision conflict and folder paths", async (t) => {
  const f = await setup(t),
    a = await f.login();
  const request = (path, method, body) =>
    fetch(f.address + "/api" + path, {
      method,
      headers: a.headers,
      body: JSON.stringify(body),
    });
  let r = await request("/folders", "POST", { path: "/New folder" });
  assert.equal(r.status, 201);
  r = await fetch(
    f.address +
      "/api/upload?path=" +
      encodeURIComponent("/New folder/Budget & cost #1.txt"),
    {
      method: "PUT",
      headers: { ...a.headers, "Content-Type": "application/octet-stream" },
      body: "hello",
    },
  );
  assert.equal(r.status, 201);
  r = await fetch(
    f.address +
      "/api/download?path=" +
      encodeURIComponent("/New folder/Budget & cost #1.txt"),
    { headers: a.headers },
  );
  assert.equal(await r.text(), "hello");
  assert.match(r.headers.get("content-disposition"), /attachment/);
  r = await fetch(
    f.address +
      "/api/upload?path=" +
      encodeURIComponent("/New folder/Budget & cost #1.txt"),
    {
      method: "PUT",
      headers: { ...a.headers, "Content-Type": "application/octet-stream" },
      body: "replace",
    },
  );
  assert.equal(r.status, 412);
  r = await fetch(
    f.address + "/api/upload?path=" + encodeURIComponent("/Project brief.pdf"),
    {
      method: "PUT",
      headers: {
        ...a.headers,
        "Content-Type": "application/octet-stream",
        "X-File-Etag": '"stale"',
      },
      body: "replace",
    },
  );
  assert.equal(r.status, 412);
  r = await request("/files", "PATCH", {
    path: "/New folder/Budget & cost #1.txt",
    destination: "/New folder/Renamed.txt",
  });
  assert.equal(r.status, 200);
  assert.equal(f.log.at(-1).headers.overwrite, "F");
  r = await request("/files", "DELETE", { path: "/New folder/Renamed.txt" });
  assert.equal(r.status, 200);
  r = await request("/files", "DELETE", { path: "/" });
  assert.equal(r.status, 400);
});
test("read-only and nonmember authorization errors remain enforced upstream", async (t) => {
  const f = await setup(t),
    b = await f.login("meshal"),
    c = await f.login("harun");
  let r = await fetch(f.address + "/api/files", { headers: b.headers });
  const data = await r.json();
  assert.equal(data.files[0].permissions, "G");
  r = await fetch(f.address + "/api/files", {
    method: "DELETE",
    headers: b.headers,
    body: JSON.stringify({ path: "/Project brief.pdf" }),
  });
  assert.equal(r.status, 403);
  assert.ok(f.files.has("/Project brief.pdf"));
  r = await fetch(
    f.address +
      "/api/versions?path=" +
      encodeURIComponent("/Project brief.pdf"),
    { headers: c.headers },
  );
  assert.equal(r.status, 403);
});
test("user/group shares, permission changes and removal", async (t) => {
  const f = await setup(t),
    a = await f.login();
  let r = await fetch(f.address + "/api/recipients?search=bo", {
    headers: a.headers,
  });
  assert.equal((await r.json()).recipients.length, 2);
  r = await fetch(f.address + "/api/shares", {
    method: "POST",
    headers: a.headers,
    body: JSON.stringify({
      path: "/Team projects",
      shareType: 1,
      shareWith: "project-team",
      access: "edit",
    }),
  });
  assert.equal(r.status, 201);
  assert.equal(f.shares[0].permissions, 15);
  r = await fetch(f.address + "/api/shares/1", {
    method: "PATCH",
    headers: a.headers,
    body: JSON.stringify({ access: "read" }),
  });
  assert.equal(r.status, 200);
  assert.equal(f.shares[0].permissions, 1);
  r = await fetch(f.address + "/api/shares", {
    method: "POST",
    headers: a.headers,
    body: JSON.stringify({
      path: "/Project brief.pdf",
      shareType: 3,
      shareWith: "public",
      access: "read",
    }),
  });
  assert.equal(r.status, 400);
  r = await fetch(f.address + "/api/shares/1", {
    method: "DELETE",
    headers: a.headers,
  });
  assert.equal(r.status, 200);
  assert.equal(f.shares.length, 0);
});
test("version listing, download and restore bind file ID to authenticated path", async (t) => {
  const f = await setup(t),
    a = await f.login();
  let r = await fetch(
    f.address +
      "/api/versions?path=" +
      encodeURIComponent("/Project brief.pdf"),
    { headers: a.headers },
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).versions[0].revision, "1789308000");
  r = await fetch(
    f.address +
      "/api/versions/download?path=" +
      encodeURIComponent("/Project brief.pdf") +
      "&revision=1789308000",
    { headers: a.headers },
  );
  assert.equal(await r.text(), "Previous revision");
  r = await fetch(f.address + "/api/versions/restore", {
    method: "POST",
    headers: a.headers,
    body: JSON.stringify({
      path: "/Project brief.pdf",
      revision: "1789308000",
    }),
  });
  assert.equal(r.status, 200);
  assert.match(f.log.at(-1).headers.destination, /\/versions\/ayman\/restore$/);
  r = await fetch(f.address + "/api/versions/restore", {
    method: "POST",
    headers: a.headers,
    body: JSON.stringify({ path: "/Project brief.pdf", revision: "../1" }),
  });
  assert.equal(r.status, 400);
});

test("admin lifecycle: create user/group, add/remove member, disable/enable, invalidate sessions", async (t) => {
  const f = await setup(t),
    admin = await f.login("ncadmin"),
    meshal = await f.login("meshal");
  assert.equal(admin.data.user.isAdmin, true);
  assert.equal(meshal.data.user.isAdmin, false);
  const request = (path, method = "GET", body) =>
    fetch(f.address + "/api/admin" + path, {
      method,
      headers: admin.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let r = await request("/groups", "POST", { groupid: "Research & planning" });
  assert.equal(r.status, 201);
  r = await request("/users", "POST", {
    userid: "dina",
    displayName: "Dina",
    email: "dina@example.test",
    password: "Long-Initial-Password",
  });
  assert.equal(r.status, 201);
  assert.equal(
    JSON.stringify(await r.json()).includes("Long-Initial-Password"),
    false,
  );
  r = await request(
    "/groups/" + encodeURIComponent("Research & planning") + "/members",
    "POST",
    { userid: "dina" },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(f.accounts.get("dina").groups, ["Research & planning"]);
  r = await request(
    "/groups/" + encodeURIComponent("Research & planning") + "/members",
  );
  assert.deepEqual((await r.json()).members, ["dina"]);
  r = await request(
    "/groups/" + encodeURIComponent("Research & planning") + "/members",
    "DELETE",
    { userid: "dina" },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(f.accounts.get("dina").groups, []);
  r = await request("/users/meshal/status", "PATCH", { enabled: false });
  assert.equal(r.status, 200);
  assert.equal(f.accounts.get("meshal").enabled, false);
  r = await fetch(f.address + "/api/me", { headers: meshal.headers });
  assert.equal(r.status, 401);
  r = await request("/users/meshal/status", "PATCH", { enabled: true });
  assert.equal(r.status, 200);
  assert.equal(f.accounts.get("meshal").enabled, true);
  r = await request("/users");
  const data = await r.json();
  assert.equal(
    data.users.some((u) => u.id === "dina"),
    true,
  );
  assert.equal(JSON.stringify(data).includes("Long-Initial-Password"), false);
});
test("admin privilege cannot be forged or retained after role removal; CSRF still applies", async (t) => {
  const f = await setup(t),
    admin = await f.login("ncadmin"),
    ayman = await f.login("ayman");
  let r = await fetch(f.address + "/api/admin/users", {
    headers: ayman.headers,
  });
  assert.equal(r.status, 403);
  r = await fetch(f.address + "/api/admin/groups", {
    method: "POST",
    headers: ayman.headers,
    body: JSON.stringify({ groupid: "forged", isAdmin: true }),
  });
  assert.equal(r.status, 403);
  assert.equal(f.groups.has("forged"), false);
  r = await fetch(f.address + "/api/admin/groups", {
    method: "POST",
    headers: { ...admin.headers, "X-CSRF-Token": "wrong" },
    body: JSON.stringify({ groupid: "csrf" }),
  });
  assert.equal(r.status, 403);
  f.accounts.get("ncadmin").groups = [];
  r = await fetch(f.address + "/api/admin/groups", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ groupid: "after-demotion" }),
  });
  assert.equal(r.status, 403);
  assert.equal(f.groups.has("after-demotion"), false);
});
test("admin safety: protected accounts/group, path validation, pagination, creation allowlist and duplicate errors", async (t) => {
  const f = await setup(t),
    admin = await f.login("ncadmin");
  const request = (path, method = "GET", body) =>
    fetch(f.address + "/api/admin" + path, {
      method,
      headers: admin.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let r = await request("/groups/admin/members", "POST", { userid: "meshal" });
  assert.equal(r.status, 403);
  r = await request("/groups/admin/members", "DELETE", { userid: "ncadmin" });
  assert.equal(r.status, 403);
  r = await request("/users/ncadmin/status", "PATCH", { enabled: false });
  assert.equal(r.status, 400);
  f.accounts.set("another-admin", {
    id: "another-admin",
    displayname: "Other admin",
    groups: ["admin"],
    enabled: true,
    password: "test-app-password",
  });
  r = await request("/users/another-admin/status", "PATCH", { enabled: false });
  assert.equal(r.status, 403);
  r = await request("/groups", "POST", { groupid: "../wrong" });
  assert.equal(r.status, 400);
  r = await request("/users?offset=-1");
  assert.equal(r.status, 400);
  r = await request("/users", "POST", {
    userid: "safeuser",
    displayName: "Safe user",
    password: "Long-safe-password",
    groups: ["admin"],
    subadmin: ["admin"],
  });
  assert.equal(r.status, 201);
  assert.deepEqual(f.accounts.get("safeuser").groups, []);
  const payload = f.log.at(-1).body;
  assert.equal(payload.includes("subadmin"), false);
  assert.equal(payload.includes("groups"), false);
  r = await request("/users", "POST", {
    userid: "safeuser",
    displayName: "Safe user",
    password: "Long-safe-password",
  });
  assert.equal(r.status, 400);
  for (let i = 0; i < 35; i++) f.groups.add("Paging " + i);
  r = await request("/groups?search=Paging");
  let d = await r.json();
  assert.equal(d.groups.length, 30);
  assert.equal(d.hasMore, true);
  r = await request("/groups?search=Paging&offset=30");
  d = await r.json();
  assert.equal(d.groups.length, 5);
  assert.equal(d.hasMore, false);
});

test("user deletion requires admin, CSRF and exact confirmation; protects admins and revokes sessions", async (t) => {
  const f = await setup(t), admin = await f.login("ncadmin"), member = await f.login("meshal");
  const remove = (uid, headers, confirmUsername = uid) => fetch(f.address + "/api/admin/users/" + encodeURIComponent(uid), {
    method: "DELETE", headers, body: JSON.stringify({ confirmUsername }),
  });
  assert.equal((await remove("harun", member.headers)).status, 403);
  assert.equal((await remove("meshal", { ...admin.headers, "X-CSRF-Token": "wrong" })).status, 403);
  assert.equal((await remove("meshal", admin.headers, "wrong")).status, 400);
  assert.equal((await remove("ncadmin", admin.headers)).status, 403);
  f.accounts.get("harun").groups = ["admin"];
  assert.equal((await remove("harun", admin.headers)).status, 403);
  assert.equal((await remove("meshal", admin.headers)).status, 200);
  assert.equal(f.accounts.has("meshal"), false);
  assert.equal((await fetch(f.address + "/api/me", { headers: member.headers })).status, 401);
  assert.equal((await remove("meshal", admin.headers)).status, 404);
});
