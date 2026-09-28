import { XMLParser, XMLValidator } from "fast-xml-parser";
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function cleanPath(value = "/") {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !value.startsWith("/") ||
    /[\\\x00-\x1f\x7f]/.test(value)
  )
    throw new ApiError(400, "Invalid file path.");
  const parts = value.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === ".."))
    throw new ApiError(400, "Relative path segments are not allowed.");
  return "/" + parts.join("/");
}
const enc = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16),
  );
export const encodePath = (path) =>
  cleanPath(path).split("/").map(enc).join("/");
const array = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});
export function davRows(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new ApiError(502, "Invalid response from file server.");
  const doc = parser.parse(xml);
  if (!doc.multistatus)
    throw new ApiError(502, "Unexpected response from file server.");
  return array(doc.multistatus.response).map((row) => {
    const p = Object.assign(
      {},
      ...array(row.propstat)
        .filter((s) => /\s200\s/.test(s.status))
        .map((s) => s.prop),
    );
    const folder =
      typeof p.resourcetype === "object" &&
      p.resourcetype !== null &&
      "collection" in p.resourcetype;
    return {
      href: row.href,
      folder,
      id: String(p.fileid ?? ""),
      etag: p.getetag || "",
      permissions: p.permissions || "",
      sharePermissions: Number(p["share-permissions"] || 0),
      mountType: p["mount-type"] || "",
      isMountRoot: String(p["is-mount-root"] || "").toLowerCase() === "true",
      size: Number(p.getcontentlength || p.size || 0),
      modified: p.getlastmodified || "",
      type: p.getcontenttype || "",
      owner: p["owner-display-name"] || "",
      versionLabel: p["version-label"] || "",
    };
  });
}
const props =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns" xmlns:ocs="http://open-collaboration-services.org/ns"><d:prop><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:getetag/><oc:fileid/><oc:size/><oc:permissions/><oc:owner-display-name/><nc:mount-type/><nc:is-mount-root/><ocs:share-permissions/><nc:version-label/></d:prop></d:propfind>';
function applySharePermissions(row) {
  // A received share mount can advertise D/N/V for operations on the local
  // mount point even when the share itself is read-only. Teamspace treats
  // the share's numeric permissions as authoritative for content actions.
  if (row.mountType !== "shared" || !row.isMountRoot || !row.sharePermissions)
    return row;
  const p = row.sharePermissions;
  let permissions = row.permissions || "";
  if (!(p & 2)) permissions = permissions.replace(/W/g, "");
  if (!(p & 4)) permissions = permissions.replace(/[CK]/g, "");
  if (!(p & 8)) permissions = permissions.replace(/[DNV]/g, "");
  if (!(p & 16)) permissions = permissions.replace(/R/g, "");
  return { ...row, permissions, receivedShare: true };
}
export class Nextcloud {
  constructor(base, user) {
    this.base = base.replace(/\/$/, "");
    this.user = user;
    this.root = "/remote.php/dav/files/" + enc(user.id || user.username);
    this.auth =
      "Basic " +
      Buffer.from(user.username + ":" + user.password).toString("base64");
  }
  file(path) {
    return this.root + encodePath(path);
  }
  async raw(method, path, options = {}) {
    const response = await fetch(this.base + path, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(600000),
      ...options,
      headers: {
        Authorization: this.auth,
        "OCS-APIRequest": "true",
        ...options.headers,
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      const messages = {
        401: "Your login has expired or the credentials were rejected. Sign in again.",
        403: "You do not have permission for this action.",
        404: "The item could not be found.",
        405: "This operation is unavailable or the folder already exists.",
        409: "The destination folder is missing or there is a conflict.",
        412: "This file changed or already exists. Refresh before trying again.",
        423: "This file is locked. Try again shortly.",
        507: "There is not enough storage space.",
      };
      throw new ApiError(
        response.status >= 400 && response.status < 600 ? response.status : 502,
        messages[response.status] ||
          "Nextcloud could not complete the request.",
      );
    }
    return response;
  }
  async ocs(method, route, params = {}) {
    const q = new URLSearchParams({
      format: "json",
      ...(method === "GET" ? params : {}),
    });
    const r = await this.raw(
      method,
      "/ocs/v2.php/" + route + "?" + q,
      method === "GET"
        ? {}
        : {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(params).toString(),
          },
    );
    const data = await r.json();
    const code = Number(data.ocs?.meta?.statuscode);
    if (![100, 200].includes(code))
      throw new ApiError(
        [400, 401, 403, 404].includes(code) ? code : 502,
        "Nextcloud rejected the operation. Check the recipient, permissions, and server settings.",
      );
    return data.ocs.data;
  }
  async propfind(path, depth = "1") {
    const r = await this.raw("PROPFIND", path, {
      headers: { Depth: depth, "Content-Type": "application/xml" },
      body: props,
    });
    return davRows(await r.text());
  }
  async list(path) {
    path = cleanPath(path);
    const rows = await this.propfind(this.file(path));
    const items = rows.map((row) => {
      const pathname = decodeURIComponent(
        new URL(row.href, this.base).pathname,
      ).replace(/\/$/, "");
      const prefix = decodeURIComponent(this.root);
      if (!pathname.startsWith(prefix + "/") && pathname !== prefix)
        throw new ApiError(502, "Unexpected file path from Nextcloud.");
      const itemPath = cleanPath(pathname.slice(prefix.length) || "/");
      return applySharePermissions({
        ...row,
        path: itemPath,
        name: itemPath.split("/").pop() || "All files",
      });
    });
    const current = items.find((x) => x.path === path);
    if (!current?.folder) throw new ApiError(400, "Choose a folder.");
    return {
      folder: current,
      files: items
        .filter((x) => x.path !== path)
        .sort(
          (a, b) =>
            Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name),
        ),
    };
  }
  async stat(path) {
    const rows = await this.propfind(this.file(path), "0");
    if (!rows[0]) throw new ApiError(404, "File not found.");
    return applySharePermissions(rows[0]);
  }
  async versionRoot(path) {
    const item = await this.stat(path);
    if (item.folder || !/^\d+$/.test(item.id))
      throw new ApiError(400, "Select a file with a valid file ID.");
    return (
      "/remote.php/dav/versions/" + enc(this.user.id) + "/versions/" + item.id
    );
  }
}
