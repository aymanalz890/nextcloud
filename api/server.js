import express from "express";
import { mountAdmin, currentGroups } from "./admin.js";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { ApiError, Nextcloud, cleanPath, encodePath } from "./nextcloud.js";

function requirePermission(item, permission, message = "You have read-only access to this item.") {
  if (!item?.permissions?.includes(permission)) throw new ApiError(403, message);
}
function parentPath(path) {
  path = cleanPath(path);
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function createApp({
  base = process.env.NEXTCLOUD_URL || "http://app",
  origin = process.env.UI_ORIGIN || "http://localhost:8081",
  cookieSecure = process.env.COOKIE_SECURE === "true",
} = {}) {
  const app = express(),
    sessions = new Map(),
    attempts = new Map();
  const ttl = 8 * 60 * 60 * 1000,
    maxUpload = 100 * 1024 * 1024;
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("origin") !== origin ||
        req.get("x-requested-with") !== "Teamspace")
    )
      return res.status(403).json({
        error:
          "Request origin was rejected. Open the configured dashboard URL.",
      });
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  function prune() {
    const now = Date.now();
    for (const [key, s] of sessions) if (s.expires <= now) sessions.delete(key);
    for (const [key, s] of attempts) if (s.until <= now) attempts.delete(key);
  }
  setInterval(prune, 60000).unref();
  function getSession(req) {
    prune();
    const token = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("ts_session="))
      ?.slice(11);
    return { token, s: sessions.get(token) };
  }
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.post("/api/login", async (req, res) => {
    prune();
    const { username, password } = req.body || {};
    if (
      typeof username !== "string" ||
      !username.trim() ||
      username.length > 128 ||
      /[:\x00-\x1f\x7f]/.test(username) ||
      typeof password !== "string" ||
      !password ||
      password.length > 1024
    )
      throw new ApiError(
        400,
        "Enter your username and password or app password.",
      );
    const keys = ["ip:" + req.ip, "user:" + username.toLowerCase()];
    for (const key of keys)
      if ((attempts.get(key)?.count || 0) >= 20)
        throw new ApiError(
          429,
          "Too many sign-in attempts. Try again in 15 minutes.",
        );
    if (attempts.size > 10000 || sessions.size >= 1000)
      throw new ApiError(503, "Server is busy. Try again later.");
    for (const key of keys) {
      const a = attempts.get(key) || { count: 0, until: Date.now() + 900000 };
      a.count++;
      attempts.set(key, a);
    }
    const user = { username: username.trim(), password };
    const client = new Nextcloud(base, user);
    const profile = await client.ocs("GET", "cloud/user");
    if (!profile.id || typeof profile.id !== "string")
      throw new ApiError(502, "Could not resolve your Nextcloud account.");
    user.id = profile.id;
    const groups = await currentGroups(client, user.id);
    const publicUser = {
      id: user.id,
      name: profile["display-name"] || profile.displayname || user.id,
      groups,
      isAdmin: groups.includes("admin"),
      quota: profile.quota || {},
    };
    const old = getSession(req);
    if (old.token) sessions.delete(old.token);
    const token = crypto.randomBytes(32).toString("hex"),
      csrf = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { user, publicUser, csrf, expires: Date.now() + ttl });
    res.cookie("ts_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure,
      maxAge: ttl,
      path: "/api",
    });
    res.json({ user: publicUser, csrf });
  });
  app.use("/api", (req, res, next) => {
    const { s, token } = getSession(req);
    if (!s) return res.status(401).json({ error: "Sign in to continue." });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("x-csrf-token") !== s.csrf
    )
      return res
        .status(403)
        .json({ error: "Session check failed. Refresh and try again." });
    req.session = s;
    req.token = token;
    req.nc = new Nextcloud(base, s.user);
    next();
  });
  mountAdmin(app, (uid) => {
    for (const [key, value] of sessions)
      if (value.user.id === uid) sessions.delete(key);
  });
  app.get("/api/me", async (req, res) => {
    const groups = await currentGroups(req.nc, req.session.user.id);
    req.session.publicUser.groups = groups;
    req.session.publicUser.isAdmin = groups.includes("admin");
    res.json({ user: req.session.publicUser, csrf: req.session.csrf });
  });
  app.post("/api/logout", (req, res) => {
    sessions.delete(req.token);
    res.clearCookie("ts_session", {
      path: "/api",
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure,
    });
    res.json({ ok: true });
  });
  app.get("/api/files", async (req, res) =>
    res.json(await req.nc.list(req.query.path || "/")),
  );
  app.post("/api/folders", async (req, res) => {
    const path = nonRoot(req.body?.path);
    requirePermission(await req.nc.stat(parentPath(path)), "C", "This folder is read only; you cannot create items here.");
    await req.nc.raw("MKCOL", req.nc.file(path));
    res.status(201).json({ ok: true });
  });
  app.patch("/api/files", async (req, res) => {
    const source = nonRoot(req.body?.path),
      destination = nonRoot(req.body?.destination);
    if (destination === source || destination.startsWith(source + "/"))
      throw new ApiError(
        400,
        "Choose a different destination outside this folder.",
      );
    const sourceItem = await req.nc.stat(source);
    const sameParent = parentPath(source) === parentPath(destination);
    requirePermission(sourceItem, sameParent ? "N" : "V", sameParent ? "You do not have permission to rename this item." : "You do not have permission to move this item.");
    requirePermission(await req.nc.stat(parentPath(destination)), "C", "The destination folder is read only.");
    await req.nc.raw("MOVE", req.nc.file(source), {
      headers: {
        Destination: base.replace(/\/$/, "") + req.nc.file(destination),
        Overwrite: "F",
        ...(req.body.etag ? { "If-Match": safeEtag(req.body.etag) } : {}),
      },
    });
    res.json({ ok: true });
  });
  app.delete("/api/files", async (req, res) => {
    const path = nonRoot(req.body?.path);
    requirePermission(await req.nc.stat(path), "D", "You do not have permission to delete this item.");
    await req.nc.raw("DELETE", req.nc.file(path), {
      headers: req.body.etag ? { "If-Match": safeEtag(req.body.etag) } : {},
    });
    res.json({ ok: true });
  });
  app.put("/api/upload", async (req, res) => {
    const path = nonRoot(req.query.path),
      length = Number(req.get("content-length"));
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      !req.get("content-length")
    )
      throw new ApiError(411, "Upload requires a content length.");
    if (length > maxUpload)
      throw new ApiError(413, "Maximum file size is 100 MB.");
    const etag = req.get("x-file-etag");
    let existing = null;
    try {
      existing = await req.nc.stat(path);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) throw e;
    }
    if (existing) {
      if (existing.folder) throw new ApiError(409, "A folder with this name already exists.");
      requirePermission(existing, "W", "This file is read only and cannot be replaced.");
    } else {
      requirePermission(await req.nc.stat(parentPath(path)), "C", "This folder is read only; you cannot upload files here.");
    }
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, encoding, cb) {
        bytes += chunk.length;
        cb(
          bytes > maxUpload
            ? new ApiError(413, "Maximum file size is 100 MB.")
            : null,
          chunk,
        );
      },
    });
    req.pipe(limit);
    req.on("aborted", () => limit.destroy());
    try {
      await req.nc.raw("PUT", req.nc.file(path), {
        duplex: "half",
        body: Readable.toWeb(limit),
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(length),
          ...(etag ? { "If-Match": safeEtag(etag) } : { "If-None-Match": "*" }),
        },
      });
    } finally {
      req.unpipe(limit);
      limit.destroy();
    }
    res.status(201).json({ ok: true });
  });
  async function sendDownload(req, res, path, name) {
    const response = await req.nc.raw("GET", path);
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(name).replaceAll("'", "%27"),
      "Content-Security-Policy": "sandbox",
    });
    if (response.headers.has("content-length"))
      res.set("Content-Length", response.headers.get("content-length"));
    await pipeline(Readable.fromWeb(response.body), res);
  }
  app.get("/api/download", async (req, res) => {
    const path = nonRoot(req.query.path);
    await sendDownload(req, res, req.nc.file(path), path.split("/").pop());
  });
  app.get("/api/versions", async (req, res) => {
    const root = await req.nc.versionRoot(nonRoot(req.query.path));
    const rows = await req.nc.propfind(root);
    const versions = rows
      .filter((x) => !x.folder)
      .map((x) => ({
        ...x,
        revision: decodeURIComponent(new URL(x.href, base).pathname)
          .split("/")
          .filter(Boolean)
          .pop(),
      }))
      .filter((x) => /^\d+$/.test(x.revision))
      .sort((a, b) => Number(b.revision) - Number(a.revision));
    res.json({ versions });
  });
  app.get("/api/versions/download", async (req, res) => {
    const path = nonRoot(req.query.path),
      revision = revisionId(req.query.revision),
      root = await req.nc.versionRoot(path);
    await sendDownload(
      req,
      res,
      root + "/" + revision,
      path.split("/").pop() + ".v" + revision,
    );
  });
  app.post("/api/versions/restore", async (req, res) => {
    const path = nonRoot(req.body?.path),
      revision = revisionId(req.body?.revision);
    requirePermission(await req.nc.stat(path), "W", "This file is read only and cannot be restored.");
    const root = await req.nc.versionRoot(path);
    await req.nc.raw("MOVE", root + "/" + revision, {
      headers: {
        Destination:
          base.replace(/\/$/, "") +
          "/remote.php/dav/versions/" +
          encodeURIComponent(req.session.user.id) +
          "/restore",
      },
    });
    res.json({ ok: true });
  });
  const sharesRoute = "apps/files_sharing/api/v1/shares";
  app.get("/api/shares", async (req, res) =>
    res.json({
      shares: await req.nc.ocs(
        "GET",
        sharesRoute,
        req.query.path ? { path: cleanPath(req.query.path) } : {},
      ),
    }),
  );
  app.get("/api/recipients", async (req, res) => {
    const search = String(req.query.search || "").trim();
    if (search.length < 2) return res.json({ recipients: [] });
    if (search.length > 128) throw new ApiError(400, "Search is too long.");
    const data = await req.nc.ocs("GET", "apps/files_sharing/api/v1/sharees", {
      search,
      itemType: req.query.folder === "true" ? "folder" : "file",
      perPage: "20",
    });
    const recipients = [],
      seen = new Set();
    for (const kind of ["users", "groups"])
      for (const item of [
        ...(data.exact?.[kind] || []),
        ...(data[kind] || []),
      ]) {
        const type = Number(item.value?.shareType),
          id = item.value?.shareWith;
        if (![0, 1].includes(type) || !id || seen.has(type + ":" + id))
          continue;
        seen.add(type + ":" + id);
        recipients.push({ id, type, label: item.label || id });
      }
    res.json({ recipients });
  });
  app.post("/api/shares", async (req, res) => {
    const path = nonRoot(req.body?.path),
      { shareType, shareWith, access } = req.body || {};
    if (
      ![0, 1].includes(shareType) ||
      typeof shareWith !== "string" ||
      !shareWith ||
      shareWith.length > 256
    )
      throw new ApiError(400, "Select an internal user or group.");
    const item = await req.nc.stat(path);
    requirePermission(item, "R", "You do not have permission to share this item.");
    const permissions = sharePermissions(access, item.folder);
    const share = await req.nc.ocs("POST", sharesRoute, {
      path,
      shareType: String(shareType),
      shareWith,
      permissions: String(permissions),
    });
    res.status(201).json({ share });
  });
  app.patch("/api/shares/:id", async (req, res) => {
    const id = revisionId(req.params.id),
      share = await req.nc.ocs("GET", sharesRoute + "/" + id);
    const entry = Array.isArray(share) ? share[0] : share;
    if (!entry || ![0, 1].includes(Number(entry.share_type)))
      throw new ApiError(400, "Only internal shares can be changed here.");
    await req.nc.ocs("PUT", sharesRoute + "/" + id, {
      permissions: String(
        sharePermissions(req.body?.access, entry.item_type === "folder"),
      ),
    });
    res.json({ ok: true });
  });
  app.delete("/api/shares/:id", async (req, res) => {
    await req.nc.ocs("DELETE", sharesRoute + "/" + revisionId(req.params.id));
    res.json({ ok: true });
  });
  app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || (err.name === "TimeoutError" ? 504 : 502);
    res.status(status).json({
      error:
        err instanceof ApiError
          ? err.message
          : status === 413
            ? "Request is too large."
            : "The service could not complete this request. Check connectivity and try again.",
    });
  });
  return app;
}
function nonRoot(path) {
  if (typeof path !== "string")
    throw new ApiError(400, "File path is required.");
  path = cleanPath(path);
  if (path === "/") throw new ApiError(400, "Select a file or subfolder.");
  return path;
}
function revisionId(id) {
  if (typeof id !== "string" || !/^\d+$/.test(id))
    throw new ApiError(400, "Invalid identifier.");
  return id;
}
function safeEtag(value) {
  if (typeof value !== "string" || value.length > 256 || /[\r\n]/.test(value))
    throw new ApiError(400, "Invalid file version.");
  return value;
}
function sharePermissions(access, folder) {
  if (!["read", "edit"].includes(access))
    throw new ApiError(400, "Choose read or edit access.");
  return access === "read" ? 1 : folder ? 15 : 3;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  createApp().listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log("Teamspace API listening"),
  );
