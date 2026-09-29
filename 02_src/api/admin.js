import { ApiError } from "./nextcloud.js";

function id(value, label = "ID") {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 128 ||
    /[\\/\x00-\x1f\x7f]/.test(value) ||
    [".", ".."].includes(value)
  )
    throw new ApiError(
      400,
      `Enter a valid ${label} (up to 128 characters, without slashes).`,
    );
  return value;
}
const segment = (value) =>
  encodeURIComponent(id(value)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16),
  );
function page(query) {
  const offset = Number(query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
    throw new ApiError(400, "Invalid page.");
  const search = String(query.search || "").trim();
  if (search.length > 128) throw new ApiError(400, "Search is too long.");
  return { offset, search };
}
function brief(profile) {
  return {
    id: profile.id,
    name: profile["display-name"] || profile.displayname || profile.id,
    email: profile.email || "",
    groups: profile.groups || [],
    enabled: ![false, "false", 0, "0"].includes(profile.enabled),
    isAdmin: (profile.groups || []).includes("admin"),
  };
}
export async function currentGroups(nc, userid) {
  const data = await nc.ocs(
    "GET",
    "cloud/users/" + segment(userid) + "/groups",
  );
  if (!Array.isArray(data.groups))
    throw new ApiError(502, "Could not verify account groups.");
  return data.groups;
}
async function provision(req, method, route, fields) {
  try {
    return await req.nc.ocs(method, route, fields);
  } catch (e) {
    if (e instanceof ApiError && ![401, 403, 404].includes(e.status))
      throw new ApiError(
        e.status === 502 ? 400 : e.status,
        "Nextcloud rejected the change. Check for an existing name, password-policy requirements, or a read-only account/group directory.",
      );
    throw e;
  }
}
export function mountAdmin(app, invalidateSessions) {
  app.use("/api/admin", async (req, res, next) => {
    const groups = await currentGroups(req.nc, req.session.user.id);
    req.session.publicUser.groups = groups;
    req.session.publicUser.isAdmin = groups.includes("admin");
    if (!req.session.publicUser.isAdmin)
      throw new ApiError(403, "Administrator access is required.");
    next();
  });
  app.get("/api/admin/users", async (req, res) => {
    const { offset, search } = page(req.query),
      limit = 20;
    const result = await req.nc.ocs("GET", "cloud/users", {
      search,
      offset: String(offset),
      limit: String(limit + 1),
    });
    if (!Array.isArray(result.users))
      throw new ApiError(502, "Unexpected user list.");
    const users = [];
    const ids = result.users.slice(0, limit);
    for (let i = 0; i < ids.length; i += 4)
      users.push(
        ...(await Promise.all(
          ids
            .slice(i, i + 4)
            .map(async (uid) =>
              brief(await req.nc.ocs("GET", "cloud/users/" + segment(uid))),
            ),
        )),
      );
    res.json({ users, offset, hasMore: result.users.length > limit });
  });
  app.post("/api/admin/users", async (req, res) => {
    const body = req.body || {},
      userid = id(body.userid, "username");
    if (!/^[A-Za-z0-9_.@-]+$/.test(userid))
      throw new ApiError(
        400,
        "Use letters, numbers, dots, @, underscores or hyphens for the username.",
      );
    if (
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 1024
    )
      throw new ApiError(
        400,
        "Use an initial password between 12 and 1024 characters.",
      );
    if (
      typeof body.displayName !== "string" ||
      !body.displayName.trim() ||
      body.displayName.length > 128
    )
      throw new ApiError(400, "Enter a display name of up to 128 characters.");
    const email = body.email || "";
    if (
      typeof email !== "string" ||
      email.length > 254 ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      throw new ApiError(400, "Enter a valid email address or leave it blank.");
    await provision(req, "POST", "cloud/users", {
      userid,
      password: body.password,
      displayName: body.displayName.trim(),
      ...(email ? { email } : {}),
    });
    res.status(201).json({ ok: true, id: userid });
  });
  app.delete("/api/admin/users/:id", async (req, res) => {
    const uid = id(req.params.id);
    if (uid === req.session.user.id)
      throw new ApiError(403, "You cannot delete your own account.");
    if ((await currentGroups(req.nc, uid)).includes("admin"))
      throw new ApiError(403, "Administrator accounts cannot be deleted here.");
    if (req.body?.confirmUsername !== uid)
      throw new ApiError(400, "Type the exact username to confirm deletion.");
    await provision(req, "DELETE", "cloud/users/" + segment(uid), {});
    invalidateSessions(uid);
    res.json({ ok: true });
  });
  app.patch("/api/admin/users/:id/status", async (req, res) => {
    const uid = id(req.params.id),
      enabled = req.body?.enabled;
    if (typeof enabled !== "boolean")
      throw new ApiError(400, "An enabled boolean is required.");
    if (uid === req.session.user.id)
      throw new ApiError(400, "You cannot disable your own account.");
    const groups = await currentGroups(req.nc, uid);
    if (groups.includes("admin"))
      throw new ApiError(
        403,
        "Administrator accounts are protected from enable/disable changes here.",
      );
    await provision(
      req,
      "PUT",
      "cloud/users/" + segment(uid) + (enabled ? "/enable" : "/disable"),
      {},
    );
    if (!enabled) invalidateSessions(uid);
    res.json({ ok: true });
  });
  app.get("/api/admin/groups", async (req, res) => {
    const { offset, search } = page(req.query),
      limit = 30;
    const data = await req.nc.ocs("GET", "cloud/groups", {
      search,
      offset: String(offset),
      limit: String(limit + 1),
    });
    if (!Array.isArray(data.groups))
      throw new ApiError(502, "Unexpected group list.");
    res.json({
      groups: data.groups
        .slice(0, limit)
        .map((gid) => ({ id: gid, protected: gid === "admin" })),
      offset,
      hasMore: data.groups.length > limit,
    });
  });
  app.post("/api/admin/groups", async (req, res) => {
    const gid = id(req.body?.groupid, "group name");
    if (gid.toLowerCase() === "admin")
      throw new ApiError(400, "The administrator group is reserved.");
    await provision(req, "POST", "cloud/groups", { groupid: gid });
    res.status(201).json({ ok: true, id: gid });
  });
  app.delete("/api/admin/groups/:id", async (req, res) => {
    const gid = id(req.params.id, "group name");
    if (gid === "admin")
      throw new ApiError(403, "The administrator group cannot be deleted.");
    await provision(req, "DELETE", "cloud/groups/" + segment(gid), {});
    res.json({ ok: true });
  });
  app.get("/api/admin/groups/:id/members", async (req, res) => {
    const gid = id(req.params.id),
      data = await req.nc.ocs("GET", "cloud/groups/" + segment(gid));
    if (!Array.isArray(data.users))
      throw new ApiError(502, "Unexpected member list.");
    res.json({ members: data.users, protected: gid === "admin" });
  });
  for (const method of ["post", "delete"])
    app[method]("/api/admin/groups/:id/members", async (req, res) => {
      const gid = id(req.params.id),
        uid = id(req.body?.userid, "username");
      if (gid === "admin")
        throw new ApiError(
          403,
          "Administrator-group membership is read-only here.",
        );
      await provision(
        req,
        method.toUpperCase(),
        "cloud/users/" + segment(uid) + "/groups",
        { groupid: gid },
      );
      res.json({ ok: true });
    });
}
