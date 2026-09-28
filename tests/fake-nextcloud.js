// Test fixture only. This is NOT a Nextcloud replacement or a production mode.
import http from "node:http";
const xmlEscape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function fixture() {
  const log = [],
    shares = [];
  const accounts = new Map([
    [
      "ayman",
      {
        id: "ayman",
        displayname: "Ayman",
        enabled: true,
        groups: ["Project team", "Operations"],
        password: "test-app-password",
      },
    ],
    [
      "meshal",
      {
        id: "meshal",
        displayname: "Meshal",
        enabled: true,
        groups: ["Project team"],
        password: "test-app-password",
      },
    ],
    [
      "harun",
      {
        id: "harun",
        displayname: "Harun",
        enabled: true,
        groups: [],
        password: "test-app-password",
      },
    ],
    [
      "ncadmin",
      {
        id: "ncadmin",
        displayname: "Workspace administrator",
        enabled: true,
        groups: ["admin"],
        password: "test-app-password",
      },
    ],
  ]);
  const groups = new Set(["admin", "Project team", "Operations"]);
  const files = new Map([
    [
      "/Team projects",
      { folder: true, id: "10", owner: "Ayman", etag: '"folder-1"' },
    ],
    [
      "/Brand assets",
      { folder: true, id: "11", owner: "Ayman", etag: '"folder-2"' },
    ],
    [
      "/Project brief.pdf",
      {
        folder: false,
        id: "42",
        owner: "Ayman",
        etag: '"v2"',
        type: "application/pdf",
        data: "Project brief second revision",
      },
    ],
    [
      "/Roadmap.xlsx",
      {
        folder: false,
        id: "43",
        owner: "Ayman",
        etag: '"v1"',
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: "Spreadsheet",
      },
    ],
    [
      "/Meeting notes.txt",
      {
        folder: false,
        id: "44",
        owner: "Ayman",
        etag: '"v1"',
        type: "text/plain",
        data: "Meeting notes",
      },
    ],
    [
      "/Team projects/Read me.txt",
      {
        folder: false,
        id: "45",
        owner: "Ayman",
        etag: '"v1"',
        type: "text/plain",
        data: "Welcome",
      },
    ],
  ]);
  const perms = (user) => (user === "meshal" ? "G" : "RGDNVWCK");
  const xml = (entries, user, root = "/remote.php/dav/files/" + user) =>
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">' +
    entries
      .map(
        ([path, f]) =>
          `<d:response><d:href>${xmlEscape(root + path.split("/").map(encodeURIComponent).join("/"))}${f.folder ? "/" : ""}</d:href><d:propstat><d:prop><d:resourcetype>${f.folder ? "<d:collection/>" : ""}</d:resourcetype><oc:fileid>${f.id}</oc:fileid><d:getetag>${xmlEscape(f.etag || '"version"')}</d:getetag><oc:permissions>${perms(user)}</oc:permissions><d:getcontentlength>${f.data?.length || 0}</d:getcontentlength><d:getcontenttype>${f.type || ""}</d:getcontenttype><oc:owner-display-name>${f.owner || ""}</oc:owner-display-name><d:getlastmodified>Mon, 14 Sep 2026 10:20:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><oc:permissions>WRONG</oc:permissions></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`,
      )
      .join("") +
    "</d:multistatus>";
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://fixture");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const auth = Buffer.from(
      (req.headers.authorization || "").replace(/^Basic /, ""),
      "base64",
    ).toString();
    const username = auth.split(":")[0];
    const password = auth.slice(username.length + 1);
    const user = username === "Ayman@example.test" ? "ayman" : username;
    log.push({
      method: req.method,
      url: req.url,
      body,
      headers: req.headers,
      user,
    });
    function reply(status, data, type = "application/json") {
      res.writeHead(status, { "Content-Type": type });
      res.end(typeof data === "string" ? data : JSON.stringify(data));
    }
    const ocs = (data) =>
      reply(200, { ocs: { meta: { statuscode: 200, status: "ok" }, data } });
    const account = accounts.get(user);
    if (!account || !account.enabled || password !== account.password)
      return reply(401, {});
    function profile(a) {
      const { password, ...data } = a;
      return { ...data, quota: { used: 524288000, total: 5368709120 } };
    }
    if (u.pathname === "/ocs/v2.php/cloud/user") return ocs(profile(account));
    const userRoute = u.pathname.match(
      /^\/ocs\/v2.php\/cloud\/users(?:\/([^/]+))?(?:\/(groups|enable|disable))?$/,
    );
    const groupRoute = u.pathname.match(
      /^\/ocs\/v2.php\/cloud\/groups(?:\/([^/]+))?$/,
    );
    if (userRoute || groupRoute) {
      const isAdmin = account.groups.includes("admin");
      const uid = userRoute?.[1] ? decodeURIComponent(userRoute[1]) : null,
        op = userRoute?.[2];
      const target = accounts.get(uid);
      if (userRoute && uid === user && op === "groups" && req.method === "GET")
        return ocs({ groups: account.groups });
      if (!isAdmin) return reply(403, {});
      const form = Object.fromEntries(new URLSearchParams(body));
      if (userRoute) {
        if (!uid) {
          if (req.method === "GET") {
            const ids = [...accounts.keys()].filter((x) =>
              x
                .toLowerCase()
                .includes((u.searchParams.get("search") || "").toLowerCase()),
            );
            const start = Number(u.searchParams.get("offset") || 0),
              limit = Number(u.searchParams.get("limit") || 20);
            return ocs({ users: ids.slice(start, start + limit) });
          }
          if (req.method === "POST") {
            if (accounts.has(form.userid))
              return reply(200, {
                ocs: { meta: { statuscode: 102 }, data: [] },
              });
            accounts.set(form.userid, {
              id: form.userid,
              displayname: form.displayName,
              password: form.password,
              email: form.email || "",
              enabled: true,
              groups: [],
            });
            return ocs([]);
          }
        }
        if (!target) return reply(404, {});
        if (!op && req.method === "DELETE") {
          accounts.delete(uid);
          return ocs([]);
        }
        if (!op && req.method === "GET") return ocs(profile(target));
        if (op === "groups") {
          if (req.method === "GET") return ocs({ groups: target.groups });
          if (!groups.has(form.groupid)) return reply(404, {});
          if (req.method === "POST")
            target.groups = [...new Set([...target.groups, form.groupid])];
          if (req.method === "DELETE")
            target.groups = target.groups.filter((g) => g !== form.groupid);
          return ocs([]);
        }
        if (["enable", "disable"].includes(op) && req.method === "PUT") {
          target.enabled = op === "enable";
          return ocs([]);
        }
      }
      if (groupRoute) {
        const gid = groupRoute[1] ? decodeURIComponent(groupRoute[1]) : null;
        if (!gid) {
          if (req.method === "GET") {
            const ids = [...groups].filter((x) =>
              x
                .toLowerCase()
                .includes((u.searchParams.get("search") || "").toLowerCase()),
            );
            const start = Number(u.searchParams.get("offset") || 0),
              limit = Number(u.searchParams.get("limit") || 30);
            return ocs({ groups: ids.slice(start, start + limit) });
          }
          if (req.method === "POST") {
            if (groups.has(form.groupid))
              return reply(200, {
                ocs: { meta: { statuscode: 102 }, data: [] },
              });
            groups.add(form.groupid);
            return ocs([]);
          }
        }
        if (!groups.has(gid)) return reply(404, {});
        return ocs({
          users: [...accounts.values()]
            .filter((a) => a.groups.includes(gid))
            .map((a) => a.id),
        });
      }
      return reply(405, {});
    }
    if (u.pathname.endsWith("/sharees"))
      return ocs({
        exact: { users: [], groups: [] },
        users: [
          { label: "Meshal", value: { shareType: 0, shareWith: "meshal" } },
        ],
        groups: [
          {
            label: "Project team",
            value: { shareType: 1, shareWith: "project-team" },
          },
        ],
      });
    if (u.pathname.includes("/api/v1/shares")) {
      if (user !== "ayman") return reply(403, {});
      const id = u.pathname.split("/").pop();
      if (id !== "shares") {
        const entry = shares.find((s) => s.id === id);
        if (!entry) return reply(404, {});
        if (req.method === "GET") return ocs([entry]);
        if (req.method === "PUT") {
          entry.permissions = Number(
            new URLSearchParams(body).get("permissions"),
          );
          return ocs(entry);
        }
        if (req.method === "DELETE") {
          shares.splice(shares.indexOf(entry), 1);
          return ocs([]);
        }
      }
      if (req.method === "GET")
        return ocs(
          shares.filter(
            (s) =>
              !u.searchParams.get("path") ||
              s.path === u.searchParams.get("path"),
          ),
        );
      const form = Object.fromEntries(new URLSearchParams(body));
      const file = files.get(form.path);
      if (!file) return reply(404, {});
      const entry = {
        id: String(shares.length + 1),
        path: form.path,
        share_type: Number(form.shareType),
        share_with: form.shareWith,
        share_with_displayname: form.shareWith,
        permissions: Number(form.permissions),
        item_type: file.folder ? "folder" : "file",
      };
      shares.push(entry);
      return ocs(entry);
    }
    if (u.pathname.startsWith("/remote.php/dav/versions/")) {
      if (user === "harun") return reply(403, {});
      if (req.method === "MOVE") {
        if (user === "meshal") return reply(403, {});
        files.get("/Project brief.pdf").data = "Previous revision";
        return reply(201, "");
      }
      if (req.method === "GET")
        return reply(200, "Previous revision", "application/octet-stream");
      return reply(
        207,
        xml(
          [
            ["", { folder: true, id: "42" }],
            [
              "/1789308000",
              { folder: false, id: "42", data: "Previous revision" },
            ],
          ],
          user,
          u.pathname,
        ),
        "application/xml",
      );
    }
    const prefix = "/remote.php/dav/files/" + user;
    if (!decodeURIComponent(u.pathname).startsWith(prefix + "/"))
      return reply(403, {});
    const path =
      decodeURIComponent(u.pathname).slice(prefix.length).replace(/\/$/, "") ||
      "/";
    if (user === "harun" && path !== "/") return reply(403, {});
    const f = path === "/" ? { folder: true, id: "1" } : files.get(path);
    if (user === "meshal" && !["PROPFIND", "GET"].includes(req.method))
      return reply(403, {});
    if (req.method === "PROPFIND") {
      if (!f) return reply(404, {});
      const entries = [[path === "/" ? "" : path, f]];
      if (req.headers.depth === "1" && user !== "harun")
        for (const [key, val] of files) {
          const p = key.substring(0, key.lastIndexOf("/")) || "/";
          if (p === path) entries.push([key, val]);
        }
      return reply(207, xml(entries, user), "application/xml");
    }
    if (req.method === "MKCOL") {
      if (f) return reply(405, {});
      files.set(path, { folder: true, id: "60", etag: '"folder-new"' });
      return reply(201, "");
    }
    if (req.method === "PUT") {
      if (req.headers["if-none-match"] === "*" && f) return reply(412, {});
      if (req.headers["if-match"] && f?.etag !== req.headers["if-match"])
        return reply(412, {});
      files.set(path, {
        folder: false,
        id: f?.id || "70",
        data: body,
        etag: '"updated"',
        type: "text/plain",
        owner: "Ayman",
      });
      return reply(201, "");
    }
    if (!f) return reply(404, {});
    if (req.method === "GET")
      return reply(200, f.data || "", "application/octet-stream");
    if (req.method === "DELETE") {
      files.delete(path);
      return reply(204, "");
    }
    if (req.method === "MOVE") {
      const dest = decodeURIComponent(
        new URL(req.headers.destination).pathname,
      ).slice(prefix.length);
      if (files.has(dest)) return reply(412, {});
      files.delete(path);
      files.set(dest, f);
      return reply(201, "");
    }
    reply(405, {});
  });
  return { server, files, shares, log, accounts, groups };
}
