import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Layers,
  Folder,
  FolderPlus,
  Files,
  Users,
  ArrowUpRight,
  Upload,
  Download,
  Search,
  ChevronRight,
  MoreHorizontal,
  X,
  LogOut,
  ArrowLeft,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  History,
  Share2,
  Trash2,
  Pencil,
  MoveRight,
  Check,
  RefreshCw,
  ShieldCheck,
  BookOpen,
  HardDrive,
  Lock,
  LoaderCircle,
} from "lucide-react";
import "./styles.css";
import Admin from "./Admin.jsx";

let csrf = "";
async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Teamspace",
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Unexpected response. Please try again." }));
  if (!response.ok) {
    if (response.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.error || "Request failed.");
  }
  return data;
}
const send = (path, method, body) =>
  api(path, { method, body: JSON.stringify(body) });
const query = (path) => encodeURIComponent(path);
const join = (path, name) => (path === "/" ? "" : path) + "/" + name;
const parent = (path) => path.substring(0, path.lastIndexOf("/")) || "/";
const size = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return n + " B";
  const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return (
    (n / 1024 ** i).toFixed(i > 1 ? 1 : 0) + " " + ["B", "KB", "MB", "GB"][i]
  );
};
const date = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? "—"
    : d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
};
const can = (file, p) => Boolean(file?.permissions?.includes(p));
function FileIcon({ file, size: iconSize = 21 }) {
  const Icon = file.folder
    ? Folder
    : file.type?.startsWith("image/")
      ? FileImage
      : /spreadsheet|excel|csv/.test(file.type)
        ? FileSpreadsheet
        : /pdf|text|document/.test(file.type)
          ? FileText
          : File;
  return (
    <span
      className={
        "file-icon " +
        (file.folder
          ? "folder-icon"
          : file.type?.startsWith("image/")
            ? "image-icon"
            : "")
      }
    >
      <Icon size={iconSize} />
    </span>
  );
}
function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [user, setUser] = useState(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [path, setPath] = useState("/"),
    [view, setView] = useState("files"),
    [data, setData] = useState({ files: [], folder: null }),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null),
    [modal, setModal] = useState(null),
    [upload, setUpload] = useState(null);
  const [shares, setShares] = useState([]);
  const input = useRef();
  useEffect(() => {
    api("/me")
      .then((d) => {
        csrf = d.csrf;
        setUser(d.user);
      })
      .catch((e) => {
        if (e.message !== "Sign in to continue.") setError(e.message);
      })
      .finally(() => setBoot(false));
    const expire = () => {
      csrf = "";
      setUser(null);
      setData({ files: [], folder: null });
      setSelected(null);
      setShares([]);
      setModal(null);
      setError("Your session ended. Please sign in again.");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user || view !== "files") return;
    const controller = new AbortController();
    setLoading(true);
    setData({ files: [], folder: null });
    setError("");
    api("/files?path=" + query(path), { signal: controller.signal })
      .then((d) => {
        setData(d);
        setSelected((s) =>
          s ? d.files.find((f) => f.path === s.path) || null : null,
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, path, view, refresh]);
  useEffect(() => {
    if (!user || view !== "shared") return;
    let ignore = false;
    setLoading(true);
    api("/shares")
      .then((d) => {
        if (!ignore) setShares(d.shares || []);
      })
      .catch((e) => {
        if (!ignore) setError(e.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [user, view, refresh]);
  function navigate(p) {
    setPath(p);
    setSearch("");
    setSelected(null);
    setView("files");
  }
  async function action(fn, message) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setRefresh((x) => x + 1);
      setToast(message);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function signIn(e) {
    e.preventDefault();
    const values = new FormData(e.target);
    setBusy(true);
    setError("");
    try {
      const d = await send("/login", "POST", Object.fromEntries(values));
      csrf = d.csrf;
      setUser(d.user);
      setPath("/");
      setView("files");
      e.target.reset();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    const ok = await action(() => send("/logout", "POST", {}), "Signed out");
    if (ok) {
      csrf = "";
      setUser(null);
      setSelected(null);
      setData({ files: [], folder: null });
      setShares([]);
      setModal(null);
    }
  }
  async function uploadFiles(files) {
    setError("");
    for (const file of files) {
      if (file.size > 100 * 1024 * 1024) {
        setError(file.name + " exceeds the 100 MB limit.");
        break;
      }
      const existing = data.files.find((f) => f.name === file.name);
      if (existing?.folder) {
        setError("A folder named " + file.name + " already exists.");
        break;
      }
      if (
        existing &&
        !window.confirm("Upload a new version of " + file.name + "?")
      )
        continue;
      setBusy(true);
      setUpload({ name: file.name, percent: 0 });
      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", "/api/upload?path=" + query(join(path, file.name)));
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader("X-Requested-With", "Teamspace");
          xhr.setRequestHeader("X-CSRF-Token", csrf);
          if (existing) xhr.setRequestHeader("X-File-Etag", existing.etag);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setUpload({
                name: file.name,
                percent: Math.round((e.loaded / e.total) * 100),
              });
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
              if (xhr.status === 401)
                window.dispatchEvent(new Event("session-expired"));
              let msg = "Upload failed. Refresh and try again.";
              try {
                msg = JSON.parse(xhr.responseText).error || msg;
              } catch {}
              reject(new Error(msg));
            }
          };
          xhr.onerror = () =>
            reject(
              new Error(
                "Upload connection interrupted. Refresh to check the file.",
              ),
            );
          xhr.timeout = 600000;
          xhr.ontimeout = () =>
            reject(new Error("Upload timed out. Refresh to check the file."));
          xhr.send(file);
        });
        setToast("Uploaded " + file.name);
      } catch (e) {
        setError(e.message);
        break;
      } finally {
        setBusy(false);
        setUpload(null);
        setRefresh((x) => x + 1);
      }
    }
    if (input.current) input.current.value = "";
  }
  const filtered = data.files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()),
  );
  const folders = filtered.filter((f) => f.folder),
    files = filtered.filter((f) => !f.folder);
  if (boot)
    return (
      <div className="boot">
        <Layers size={32} />
        <span>Opening your workspace…</span>
      </div>
    );
  if (!user)
    return (
      <div className="login-layout">
        <section className="login-story">
          <div className="brand">
            <span className="brand-mark">
              <Layers size={24} />
            </span>
            teamspace<span className="brand-dot">.</span>
          </div>
          <div>
            <span className="eyebrow">A LITTLE MORE TOGETHER</span>
            <h1>
              Good work
              <br />
              belongs in
              <br />
              <em>one place.</em>
            </h1>
            <p>
              Your team's files, shared ideas, and latest versions.
              <br />
              Room to organize. Space to collaborate.
            </p>
            <div className="story-chips">
              <span>
                <Folder size={16} /> Organize
              </span>
              <span>
                <Users size={16} /> Collaborate
              </span>
              <span>
                <History size={16} /> Keep track
              </span>
            </div>
          </div>
          <small>INTERNAL WORKSPACE · PROJECT 09</small>
        </section>
        <section className="login-form">
          <div className="login-box">
            <span className="welcome-icon">
              <ArrowUpRight size={28} />
            </span>
            <h2>Welcome to your workspace</h2>
            <p>Sign in with your existing Nextcloud account.</p>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={signIn}>
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  required
                  maxLength={128}
                  placeholder="Your username"
                />
              </label>
              <label>
                Password or app password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                  placeholder="Enter your password"
                />
              </label>
              <button className="primary login-submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : null}Sign
                in <ArrowUpRight size={18} />
              </button>
            </form>
            <p className="login-note">
              <Lock size={15} /> Using two-factor authentication? Create an app
              password in Nextcloud → Personal settings → Security.
            </p>
          </div>
        </section>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Layers size={23} />
          </span>
          teamspace<span className="brand-dot">.</span>
        </div>
        <div className="workspace-badge">
          <span className="workspace-avatar">T</span>
          <div>
            <b>Team workspace</b>
            <small>Internal collaboration</small>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          <button
            className={view === "files" ? "active" : ""}
            onClick={() => navigate("/")}
          >
            <Files size={19} />
            All files
            <ChevronRight className="nav-chevron" size={15} />
          </button>
          <button
            className={view === "shared" ? "active" : ""}
            onClick={() => {
              setView("shared");
              setSelected(null);
              setError("");
            }}
          >
            <Users size={19} />
            Shared by me
          </button>
          <button
            className={view === "guide" ? "active" : ""}
            onClick={() => {
              setView("guide");
              setSelected(null);
              setError("");
            }}
          >
            <BookOpen size={19} />
            Workspace guide
          </button>
          {user.isAdmin && (
            <button
              className={view === "admin" ? "active" : ""}
              onClick={() => {
                setView("admin");
                setSelected(null);
                setError("");
              }}
            >
              <ShieldCheck size={19} />
              Users &amp; Groups
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="storage">
            <HardDrive size={18} />
            <b>Account storage</b>
            <p>
              {size(user.quota?.used)} used
              {Number(user.quota?.total) > 0
                ? " of " + size(user.quota.total)
                : ""}
            </p>
            {Number(user.quota?.total) > 0 && (
              <progress
                max="100"
                value={Math.min(
                  100,
                  (Number(user.quota.used) / Number(user.quota.total)) * 100,
                )}
              />
            )}
            <small>Reported at sign-in</small>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <b>{user.name}</b>
              <small>{user.id}</small>
            </div>
            <button
              className="icon-btn"
              title="Sign out"
              aria-label="Sign out"
              disabled={busy}
              onClick={signOut}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} />{" "}
            <b>
              {view === "files"
                ? "Files"
                : view === "shared"
                  ? "Sharing"
                  : view === "admin"
                    ? "Users & Groups"
                    : "Guide"}
            </b>
          </span>
          <span className="private-label">
            <ShieldCheck size={16} /> Internal access
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR TEAM. IN SYNC.</span>
              <h1>
                {view === "files"
                  ? "A place for everything."
                  : view === "shared"
                    ? "Better when shared."
                    : view === "admin"
                      ? "Bring your team together."
                      : "Make yourself at home."}
              </h1>
              <p>
                {view === "files"
                  ? "Keep your work organized and your team on the same page."
                  : view === "shared"
                    ? "Manage the files and folders you have shared with others."
                    : view === "admin"
                      ? "The right people, in the right groups, with the right access."
                      : "A few simple ways to get the most out of your workspace."}
              </p>
            </div>
            {view === "files" && (
              <button
                className="primary"
                disabled={busy || loading || !can(data.folder, "C")}
                onClick={() => input.current.click()}
              >
                <Upload size={17} /> Upload files
              </button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => uploadFiles(Array.from(e.target.files))}
          />
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                aria-label="Dismiss error"
                className="icon-btn"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {upload && (
            <div className="upload-progress" role="status">
              <Upload size={17} />
              <span>
                Uploading {upload.name} ·{" "}
                {upload.percent === 100 ? "Saving…" : upload.percent + "%"}
              </span>
              <progress max="100" value={upload.percent} />
            </div>
          )}
          {view === "files" && (
            <>
              <div className="summary-grid">
                <div className="summary-card">
                  <span className="summary-icon lavender">
                    <Files size={21} />
                  </span>
                  <div>
                    <small>Files in this folder</small>
                    <strong>
                      {loading
                        ? "—"
                        : data.files.filter((f) => !f.folder).length}
                    </strong>
                  </div>
                  <span className="summary-accent">
                    Ready for your next idea
                  </span>
                </div>
                <div className="summary-card">
                  <span className="summary-icon peach">
                    <Folder size={21} />
                  </span>
                  <div>
                    <small>Folders in this location</small>
                    <strong>
                      {loading
                        ? "—"
                        : data.files.filter((f) => f.folder).length}
                    </strong>
                  </div>
                  <span className="summary-accent">
                    Everything in its place
                  </span>
                </div>
                <div className="summary-card">
                  <span className="summary-icon mint">
                    <Users size={21} />
                  </span>
                  <div>
                    <small>Your groups</small>
                    <strong>{user.groups.length}</strong>
                  </div>
                  <span className="summary-accent">
                    {user.groups.slice(0, 2).join(", ") ||
                      "Your personal workspace"}
                  </span>
                </div>
              </div>
              <section className="browser-card">
                <div className="browser-tools">
                  <div className="breadcrumbs">
                    <button onClick={() => navigate("/")}>
                      <Folder size={16} />
                      All files
                    </button>
                    {path
                      .split("/")
                      .filter(Boolean)
                      .map((part, i, all) => (
                        <React.Fragment key={i}>
                          <ChevronRight size={14} />
                          <button
                            onClick={() =>
                              navigate("/" + all.slice(0, i + 1).join("/"))
                            }
                          >
                            {part}
                          </button>
                        </React.Fragment>
                      ))}
                  </div>
                  <div className="browser-actions">
                    <button
                      className="icon-btn"
                      title="Refresh files"
                      aria-label="Refresh files"
                      disabled={loading || busy}
                      onClick={() => setRefresh((x) => x + 1)}
                    >
                      <RefreshCw size={17} className={loading ? "spin" : ""} />
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || loading || !can(data.folder, "K")}
                      onClick={() => setModal({ type: "folder" })}
                    >
                      <FolderPlus size={17} />
                      New folder
                    </button>
                  </div>
                </div>
                <div className="list-heading">
                  <h2>
                    {path === "/" ? "Your files" : path.split("/").pop()}{" "}
                    <span>{filtered.length}</span>
                  </h2>
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search this folder"
                      placeholder="Search this folder…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                {loading ? (
                  <div className="empty">
                    <LoaderCircle className="spin" size={28} />
                    <h3>Loading your files…</h3>
                  </div>
                ) : (
                  <>
                    {folders.length > 0 && (
                      <div className="folder-grid">
                        {folders.map((f) => (
                          <div
                            key={f.path}
                            className={
                              "folder-card " +
                              (selected?.path === f.path ? "selected" : "")
                            }
                          >
                            <button
                              className="folder-open"
                              onClick={() => navigate(f.path)}
                            >
                              <Folder size={30} />
                              <b>{f.name}</b>
                              <small>
                                {can(f, "C") ? "Can edit" : "Read only"}
                                {f.owner ? " · " + f.owner : ""}
                              </small>
                            </button>
                            <button
                              className="icon-btn folder-menu"
                              aria-label={"Details for " + f.name}
                              onClick={() => setSelected(f)}
                            >
                              <MoreHorizontal size={19} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {files.length > 0 && (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Last modified</th>
                              <th>Size</th>
                              <th>Access</th>
                              <th>
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {files.map((f) => (
                              <tr
                                key={f.path}
                                className={
                                  selected?.path === f.path ? "selected" : ""
                                }
                              >
                                <td>
                                  <button
                                    className="file-name"
                                    onClick={() => setSelected(f)}
                                  >
                                    <FileIcon file={f} />
                                    <span>
                                      {f.name}
                                      <small>
                                        {f.owner || "Workspace file"}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>{date(f.modified)}</td>
                                <td>{size(f.size)}</td>
                                <td>
                                  <span
                                    className={
                                      "access " + (can(f, "W") ? "edit" : "")
                                    }
                                  >
                                    {can(f, "W") ? "Can edit" : "Read only"}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="icon-btn"
                                    aria-label={"Details for " + f.name}
                                    onClick={() => setSelected(f)}
                                  >
                                    <MoreHorizontal size={19} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {!filtered.length && (
                      <div className="empty">
                        <Folder size={36} />
                        <h3>
                          {search
                            ? "No matching files"
                            : "A fresh space for your work"}
                        </h3>
                        <p>
                          {search
                            ? "Try another name in this folder."
                            : "Upload your first file or create a folder to get started."}
                        </p>
                      </div>
                    )}
                  </>
                )}
                <div className="browser-footer">
                  <span>
                    {filtered.length} items{" "}
                    {search ? "matching your search" : "in this folder"}
                  </span>
                  <span>
                    <Lock size={12} /> Permissions managed by your organization
                  </span>
                </div>
              </section>
            </>
          )}
          {view === "shared" && (
            <section className="browser-card">
              <div className="list-heading">
                <h2>Shared by you</h2>
                <button
                  className="icon-btn"
                  aria-label="Refresh shares"
                  onClick={() => setRefresh((x) => x + 1)}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              {loading ? (
                <div className="empty">Loading shares…</div>
              ) : !shares.length ? (
                <div className="empty">
                  <Share2 size={34} />
                  <h3>Make room for teamwork</h3>
                  <p>
                    Select a file or folder, then open Sharing to invite a
                    teammate or group.
                  </p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>File or folder</th>
                        <th>Shared with</th>
                        <th>Access</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shares.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <button
                              className="text-btn"
                              onClick={() => navigate(parent(s.path))}
                            >
                              {s.path}
                            </button>
                          </td>
                          <td>
                            {s.share_with_displayname || s.share_with}{" "}
                            <small>
                              {Number(s.share_type) === 1
                                ? "(group)"
                                : "(user)"}
                            </small>
                          </td>
                          <td>
                            {Number(s.permissions) === 1
                              ? "Read only"
                              : "Can edit"}
                          </td>
                          <td>
                            <button
                              className="text-btn danger-text"
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm("Remove this share?"))
                                  action(
                                    () =>
                                      api("/shares/" + s.id, {
                                        method: "DELETE",
                                      }),
                                    "Share removed",
                                  );
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="browser-footer">
                Files shared with you appear in All files after they are
                accepted in Nextcloud.
              </div>
            </section>
          )}
          {view === "admin" && user.isAdmin && (
            <Admin api={api} send={send} user={user} onNotice={setToast} />
          )}
          {view === "guide" && (
            <div className="guide-grid">
              {[
                [
                  Upload,
                  "Bring your files",
                  "Upload files up to 100 MB each. Upload a file with the same name to create a revision; you will be asked before replacing it.",
                ],
                [
                  Folder,
                  "Find a little order",
                  "Create project folders. Select an item to rename it or move it using a destination path, such as /Projects/brief.pdf.",
                ],
                [
                  Users,
                  "Work together",
                  "Select Sharing on a file or folder. Search for a user or group and choose read-only or edit access. Received shares appear in All files.",
                ],
                [
                  History,
                  "Look back, move forward",
                  "Select a file and open Versions to download or restore a saved revision. Version availability follows your organization’s retention settings.",
                ],
                [
                  ShieldCheck,
                  "The right access",
                  "Nextcloud checks your permissions for every action. Administrators create accounts, manage group membership, and disable accounts in Users & Groups.",
                ],
                [
                  FileText,
                  "Review and revise",
                  "Download a document, edit it locally, and upload a revised copy. Simultaneous Office editing needs a separate editor integration.",
                ],
              ].map(([Icon, title, body]) => (
                <article key={title}>
                  <span className="summary-icon lavender">
                    <Icon size={23} />
                  </span>
                  <h2>{title}</h2>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          )}
          <footer className="page-footer">
            <span>SPACE FOR YOUR BEST WORK.</span>
            <span>Teamspace · SDA & WCD Cloud Computing 2026</span>
          </footer>
        </main>
      </div>
      {selected && view === "files" && (
        <Details
          key={selected.path}
          file={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          action={action}
          refresh={refresh}
          setModal={setModal}
          setError={setError}
        />
      )}
      {modal && (
        <Modal
          title={
            modal.type === "folder"
              ? "Create a folder"
              : modal.type === "rename"
                ? "Rename " + modal.file.name
                : "Move " + modal.file.name
          }
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const value = new FormData(e.target).get("value").trim();
              if (
                !value ||
                ((modal.type === "folder" || modal.type === "rename") &&
                  /[\\/]/.test(value))
              ) {
                setError("Enter a name without slashes.");
                return;
              }
              const destination =
                modal.type === "folder"
                  ? join(path, value)
                  : modal.type === "rename"
                    ? join(parent(modal.file.path), value)
                    : value;
              const ok = await action(
                () =>
                  modal.type === "folder"
                    ? send("/folders", "POST", { path: destination })
                    : send("/files", "PATCH", {
                        path: modal.file.path,
                        destination,
                        etag: modal.file.etag,
                      }),
                modal.type === "folder"
                  ? "Folder created"
                  : "File organization updated",
              );
              if (ok) {
                setModal(null);
                setSelected(null);
              }
            }}
          >
            <label>
              {modal.type === "move"
                ? "Full destination path, including the item name"
                : "Name"}
              <input
                autoFocus
                name="value"
                required
                defaultValue={
                  modal.type === "folder"
                    ? ""
                    : modal.type === "move"
                      ? modal.file.path
                      : modal.file.name
                }
                placeholder={
                  modal.type === "move"
                    ? "/Projects/document.pdf"
                    : "Project name"
                }
              />
            </label>
            {modal.type === "move" && (
              <p className="hint">
                The destination folder must already exist. Existing files will
                not be overwritten.
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Details({ file, busy, onClose, action, refresh, setModal, setError }) {
  const [tab, setTab] = useState("details"),
    [versions, setVersions] = useState([]),
    [shares, setShares] = useState([]),
    [loading, setLoading] = useState(false),
    [issue, setIssue] = useState(""),
    [search, setSearch] = useState(""),
    [recipients, setRecipients] = useState([]),
    [recipient, setRecipient] = useState(null),
    [access, setAccess] = useState("read");
  useEffect(() => {
    if (tab === "details") return;
    let ignore = false;
    setLoading(true);
    setIssue("");
    api(
      (tab === "versions" ? "/versions" : "/shares") +
        "?path=" +
        query(file.path),
    )
      .then((d) => {
        if (!ignore) {
          setVersions(d.versions || []);
          setShares(d.shares || []);
        }
      })
      .catch((e) => {
        if (!ignore) setIssue(e.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [tab, file.path, refresh]);
  useEffect(() => {
    let ignore = false;
    setRecipients([]);
    if (search.trim().length < 2 || recipient) return;
    const timer = setTimeout(
      () =>
        api("/recipients?search=" + query(search) + "&folder=" + file.folder)
          .then((d) => {
            if (!ignore) setRecipients(d.recipients);
          })
          .catch((e) => {
            if (!ignore) setIssue(e.message);
          }),
      300,
    );
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [search, recipient, file.folder]);
  return (
    <aside className="details-panel" aria-label={"Details for " + file.name}>
      <div className="panel-top">
        <span>ITEM DETAILS</span>
        <button
          className="icon-btn"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="detail-hero">
        <FileIcon file={file} size={36} />
        <h2>{file.name}</h2>
        <p>
          {file.folder ? "Folder" : size(file.size)} ·{" "}
          {can(file, file.folder ? "C" : "W") ? "Can edit" : "Read only"}
        </p>
      </div>
      <div className="tabs">
        {["details", "sharing", ...(!file.folder ? ["versions"] : [])].map(
          (t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={tab === t ? "active" : ""}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ),
        )}
      </div>
      <div className="panel-content">
        {issue && (
          <div className="error" role="alert">
            {issue}
          </div>
        )}
        {tab === "details" ? (
          <>
            <dl>
              <dt>Location</dt>
              <dd>{parent(file.path)}</dd>
              <dt>Owner</dt>
              <dd>{file.owner || "—"}</dd>
              <dt>Last modified</dt>
              <dd>{date(file.modified)}</dd>
              <dt>File ID</dt>
              <dd>{file.id || "—"}</dd>
            </dl>
            <div className="detail-actions">
              {!file.folder && (
                <a
                  className="secondary"
                  href={"/api/download?path=" + query(file.path)}
                >
                  <Download size={16} />
                  Download
                </a>
              )}
              <button
                className="secondary"
                disabled={busy || !can(file, "N")}
                onClick={() => setModal({ type: "rename", file })}
              >
                <Pencil size={16} />
                Rename
              </button>
              <button
                className="secondary"
                disabled={busy || !can(file, "V")}
                onClick={() => setModal({ type: "move", file })}
              >
                <MoveRight size={16} />
                Move
              </button>
              <button
                className="secondary danger-text"
                disabled={busy || !can(file, "D")}
                onClick={async () => {
                  if (
                    window.confirm(
                      "Delete " +
                        file.name +
                        (file.folder ? " and everything inside it" : "") +
                        "?",
                    )
                  ) {
                    const ok = await action(
                      () =>
                        send("/files", "DELETE", {
                          path: file.path,
                          etag: file.etag,
                        }),
                      "Item deleted",
                    );
                    if (ok) onClose();
                  }
                }}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
            <div className="panel-note">
              <ShieldCheck size={19} />
              <p>
                Your account permissions apply to every action in this
                workspace.
              </p>
            </div>
          </>
        ) : loading ? (
          <p className="hint">Loading…</p>
        ) : tab === "versions" ? (
          <>
            <p className="hint">
              Saved revisions, newest first. Restoring replaces the current
              contents.
            </p>
            {!versions.length && !issue && (
              <div className="empty compact">
                <History size={29} />
                <h3>No saved versions yet</h3>
                <p>
                  Upload a revised file to begin. Nextcloud controls version
                  retention.
                </p>
              </div>
            )}
            {versions.map((v) => (
              <div className="version" key={v.revision}>
                <span className="version-dot" />
                <b>{date(Number(v.revision) * 1000)}</b>
                <small>
                  {new Date(Number(v.revision) * 1000).toLocaleTimeString()} ·{" "}
                  {size(v.size)}
                </small>
                {v.versionLabel && <small>{v.versionLabel}</small>}
                <div>
                  <a
                    className="text-btn"
                    href={
                      "/api/versions/download?path=" +
                      query(file.path) +
                      "&revision=" +
                      v.revision
                    }
                  >
                    Download
                  </a>
                  <button
                    className="text-btn"
                    disabled={busy || !can(file, "W")}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Restore this version of " + file.name + "?",
                        )
                      )
                        action(
                          () =>
                            send("/versions/restore", "POST", {
                              path: file.path,
                              revision: v.revision,
                            }),
                          "Version restored",
                        );
                    }}
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <h3>Invite your team</h3>
            <p className="hint">Share with an internal user or group.</p>
            {can(file, "R") ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!recipient) return;
                  const ok = await action(
                    () =>
                      send("/shares", "POST", {
                        path: file.path,
                        shareType: recipient.type,
                        shareWith: recipient.id,
                        access,
                      }),
                    "Shared with " + recipient.label,
                  );
                  if (ok) {
                    setRecipient(null);
                    setSearch("");
                  }
                }}
              >
                <label>
                  User or group
                  <input
                    value={search}
                    placeholder="Search by name…"
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setRecipient(null);
                    }}
                  />
                </label>
                {recipient ? (
                  <div className="recipient-picked">
                    <Check size={15} />
                    {recipient.label} ·{" "}
                    {recipient.type === 1 ? "Group" : "User"}
                  </div>
                ) : recipients.length > 0 ? (
                  <div className="recipient-list">
                    {recipients.map((r) => (
                      <button
                        type="button"
                        key={r.type + ":" + r.id}
                        onClick={() => {
                          setRecipient(r);
                          setSearch(r.label);
                          setRecipients([]);
                        }}
                      >
                        <Users size={15} />
                        <span>
                          {r.label}
                          <small>
                            {r.type === 1 ? "Group" : "User"} · {r.id}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : search.length >= 2 ? (
                  <p className="hint">
                    Select a matching recipient when results appear.
                  </p>
                ) : null}
                <label>
                  Permission
                  <select
                    value={access}
                    onChange={(e) => setAccess(e.target.value)}
                  >
                    <option value="read">Read only</option>
                    <option value="edit">Can edit</option>
                  </select>
                </label>
                <button className="primary full" disabled={busy || !recipient}>
                  <Share2 size={16} />
                  Share
                </button>
                <p className="hint">
                  Edit access allows updates
                  {file.folder ? ", creating items, and deletion" : ""}.
                  Resharing is not granted.
                </p>
              </form>
            ) : (
              <p className="hint">
                Your permissions do not allow resharing this item.
              </p>
            )}
            <h3 className="sharing-heading">Shares created by you</h3>
            {!shares.length && !issue && (
              <p className="hint">No shares created by you for this item.</p>
            )}
            {shares.map((s) => (
              <div className="share-person" key={s.id}>
                <span className="avatar small">
                  <Users size={16} />
                </span>
                <div>
                  <b>
                    {s.share_with_displayname || s.share_with || "Recipient"}
                  </b>
                  <small>{Number(s.share_type) === 1 ? "Group" : "User"}</small>
                  {[0, 1].includes(Number(s.share_type)) && (
                    <select
                      aria-label={
                        "Permission for " +
                        (s.share_with_displayname || s.share_with)
                      }
                      value={Number(s.permissions) === 1 ? "read" : "edit"}
                      disabled={busy}
                      onChange={(e) =>
                        action(
                          () =>
                            send("/shares/" + s.id, "PATCH", {
                              access: e.target.value,
                            }),
                          "Permission updated",
                        )
                      }
                    >
                      <option value="read">Read only</option>
                      <option value="edit">Can edit</option>
                    </select>
                  )}
                </div>
                <button
                  className="icon-btn danger-text"
                  disabled={busy}
                  aria-label={"Remove share with " + s.share_with}
                  onClick={() => {
                    if (window.confirm("Remove access for this recipient?"))
                      action(
                        () => api("/shares/" + s.id, { method: "DELETE" }),
                        "Share removed",
                      );
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
createRoot(document.getElementById("root")).render(<App />);
