import React, { useState, useEffect, useRef } from "react";
import {
  Users,
  UserPlus,
  FolderPlus,
  Search,
  ChevronRight,
  RefreshCw,
  X,
  ShieldCheck,
  Check,
  UserMinus,
  UserCheck,
} from "lucide-react";

function Dialog({ title, children, onClose, busy }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="admin-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id="admin-dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function Admin({ api, send, user, onNotice }) {
  const [tab, setTab] = useState("groups"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [result, setResult] = useState({ users: [], groups: [], hasMore: false }),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState(null),
    [dialogError, setDialogError] = useState("");
  const [group, setGroup] = useState(""),
    [members, setMembers] = useState([]),
    [membersLoading, setMembersLoading] = useState(false),
    [memberError, setMemberError] = useState(""),
    [memberSearch, setMemberSearch] = useState(""),
    [memberResults, setMemberResults] = useState([]),
    [memberSearching, setMemberSearching] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api(
      "/admin/" +
        tab +
        "?search=" +
        encodeURIComponent(query) +
        "&offset=" +
        offset,
    )
      .then((d) => {
        if (!cancelled) {
          setResult(d);
          if (tab === "groups")
            setGroup((previous) => previous || d.groups[0]?.id || "");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setResult({ users: [], groups: [], hasMore: false });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, query, offset, refresh]);
  useEffect(() => {
    let cancelled = false;
    setMembers([]);
    setMemberError("");
    setMemberSearch("");
    setMemberResults([]);
    if (tab !== "groups" || !group) return;
    setMembersLoading(true);
    api("/admin/groups/" + encodeURIComponent(group) + "/members")
      .then((d) => {
        if (!cancelled) setMembers(d.members);
      })
      .catch((e) => {
        if (!cancelled) setMemberError(e.message);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group, tab, refresh]);
  async function mutate(fn, message, { modal = false } = {}) {
    setBusy(true);
    if (modal) setDialogError("");
    else setError("");
    try {
      await fn();
      setRefresh((v) => v + 1);
      onNotice(message);
      return true;
    } catch (e) {
      (modal ? setDialogError : setError)(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function switchTab(next) {
    setTab(next);
    setSearch("");
    setQuery("");
    setOffset(0);
    setResult({ users: [], groups: [], hasMore: false });
    setError("");
  }
  function openDialog(type) {
    setDialogError("");
    setDialog(type);
  }
  async function create(e) {
    e.preventDefault();
    const form = e.currentTarget,
      fields = Object.fromEntries(new FormData(form));
    const creatingGroup = dialog === "group";
    const ok = await mutate(
      () =>
        send("/admin/" + (creatingGroup ? "groups" : "users"), "POST", fields),
      creatingGroup
        ? "Group created. Add members below."
        : "User created. Add them to a group to share team files.",
      { modal: true },
    );
    if (ok) {
      form.reset();
      setDialog(null);
      setQuery("");
      setSearch("");
      setOffset(0);
      if (creatingGroup) setGroup(fields.groupid);
    }
  }
  async function searchMembers(e) {
    e.preventDefault();
    setMemberSearching(true);
    setMemberError("");
    setMemberResults([]);
    try {
      const data = await api(
        "/admin/users?search=" + encodeURIComponent(memberSearch),
      );
      setMemberResults(data.users);
    } catch (e) {
      setMemberError(e.message);
    } finally {
      setMemberSearching(false);
    }
  }
  return (
    <section
      className="admin-area"
      aria-label="Users and groups administration"
    >
      <div className="admin-intro">
        <ShieldCheck size={20} />
        <div>
          <b>Administrator workspace</b>
          <p>
            Create accounts, organize teams, and manage access in one place.
          </p>
        </div>
      </div>
      <div className="admin-toolbar">
        <div className="tabs admin-tabs">
          <button
            className={tab === "groups" ? "active" : ""}
            disabled={busy}
            onClick={() => switchTab("groups")}
          >
            Groups
          </button>
          <button
            className={tab === "users" ? "active" : ""}
            disabled={busy}
            onClick={() => switchTab("users")}
          >
            Users
          </button>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => openDialog(tab === "groups" ? "group" : "user")}
        >
          {tab === "groups" ? <FolderPlus size={17} /> : <UserPlus size={17} />}
          Create {tab === "groups" ? "group" : "user"}
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <section className="browser-card">
        <div className="list-heading">
          <h2>{tab === "groups" ? "Team groups" : "User accounts"}</h2>
          <form
            className="admin-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search.trim());
              setOffset(0);
            }}
          >
            <input
              aria-label={"Search " + tab}
              placeholder={"Search " + tab + "…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={128}
            />
            <button
              className="secondary"
              disabled={busy}
              aria-label={"Search " + tab}
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Refresh administration"
              disabled={busy || loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={17} />
            </button>
          </form>
        </div>
        {loading ? (
          <div className="empty">Loading {tab}…</div>
        ) : tab === "users" ? (
          <>
            {result.users?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Groups</th>
                      <th>Status</th>
                      <th>Account access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong>
                          <small className="admin-user-id">
                            {u.id}
                            {u.id === user.id ? " · You" : ""}
                          </small>
                        </td>
                        <td>
                          <div className="group-tags">
                            {u.groups.length ? (
                              u.groups.map((g) => <span key={g}>{g}</span>)
                            ) : (
                              <span>No groups</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            className={"access " + (u.enabled ? "edit" : "")}
                          >
                            {u.enabled ? "Active" : "Disabled"}
                          </span>
                        </td>
                        <td>
                          {u.isAdmin || u.id === user.id ? (
                            <span className="hint">
                              Protected administrator
                            </span>
                          ) : (
                            <button
                              className={
                                "secondary " + (u.enabled ? "danger-text" : "")
                              }
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    (u.enabled ? "Disable" : "Enable") +
                                      " account " +
                                      u.id +
                                      "?" +
                                      (u.enabled
                                        ? " They will lose sign-in access; their files will be retained."
                                        : ""),
                                  )
                                )
                                  mutate(
                                    () =>
                                      send(
                                        "/admin/users/" +
                                          encodeURIComponent(u.id) +
                                          "/status",
                                        "PATCH",
                                        { enabled: !u.enabled },
                                      ),
                                    u.enabled
                                      ? "Account disabled"
                                      : "Account enabled",
                                  );
                              }}
                            >
                              {u.enabled ? (
                                <UserMinus size={15} />
                              ) : (
                                <UserCheck size={15} />
                              )}{" "}
                              {u.enabled ? "Disable" : "Enable"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <Users size={30} />
                <h3>No matching users</h3>
                <p>Create an account or try a different search.</p>
              </div>
            )}
          </>
        ) : (
          <div className="admin-groups-layout">
            <div className="admin-group-list">
              {result.groups?.length ? (
                result.groups.map((g) => (
                  <button
                    key={g.id}
                    disabled={busy}
                    className={group === g.id ? "selected" : ""}
                    onClick={() => setGroup(g.id)}
                  >
                    <span className="summary-icon lavender">
                      <Users size={18} />
                    </span>
                    <span>
                      <b>{g.id}</b>
                      <small>
                        {g.protected
                          ? "System group · read only"
                          : "Team group"}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))
              ) : (
                <div className="empty compact">
                  <Users size={27} />
                  <h3>No matching groups</h3>
                </div>
              )}
            </div>
            <div className="admin-members">
              {group ? (
                <>
                  <div className="admin-members-title">
                    <div>
                      <span className="eyebrow">GROUP MEMBERS</span>
                      <h2>{group}</h2>
                    </div>
                    <span className="access">
                      {membersLoading ? "…" : members.length} members
                    </span>
                  </div>
                  {memberError && (
                    <div className="error" role="alert">
                      {memberError}
                    </div>
                  )}
                  {group === "admin" ? (
                    <p className="hint">
                      System administrator membership is protected. Use ordinary
                      groups for file sharing.
                    </p>
                  ) : (
                    <>
                      <form
                        className="admin-search member-search"
                        onSubmit={searchMembers}
                      >
                        <input
                          aria-label="Find a user to add"
                          placeholder="Find a user to add…"
                          required
                          minLength={1}
                          maxLength={128}
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                        />
                        <button
                          className="secondary"
                          disabled={busy || memberSearching}
                        >
                          {memberSearching ? "Searching…" : "Find user"}
                        </button>
                      </form>
                      {memberResults.length > 0 && (
                        <div className="member-results">
                          {memberResults.map((u) => (
                            <div key={u.id}>
                              <span>
                                <b>{u.name}</b>
                                <small>
                                  {u.id}
                                  {!u.enabled ? " · Disabled account" : ""}
                                </small>
                              </span>
                              <button
                                className="secondary"
                                disabled={
                                  busy ||
                                  membersLoading ||
                                  members.includes(u.id)
                                }
                                aria-label={"Add " + u.id + " to " + group}
                                onClick={() =>
                                  mutate(
                                    () =>
                                      send(
                                        "/admin/groups/" +
                                          encodeURIComponent(group) +
                                          "/members",
                                        "POST",
                                        { userid: u.id },
                                      ),
                                    "Member added to " + group,
                                  )
                                }
                              >
                                {members.includes(u.id) ? (
                                  <>
                                    <Check size={14} />
                                    Member
                                  </>
                                ) : (
                                  <>
                                    <UserPlus size={14} />
                                    Add
                                  </>
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {membersLoading ? (
                    <p className="hint">Loading members…</p>
                  ) : members.length ? (
                    <ul className="member-list">
                      {members.map((uid) => (
                        <li key={uid}>
                          <span className="avatar small">
                            {uid.slice(0, 2).toUpperCase()}
                          </span>
                          <b>{uid}</b>
                          {group !== "admin" && (
                            <button
                              className="icon-btn danger-text"
                              disabled={busy}
                              aria-label={"Remove " + uid + " from " + group}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Remove " +
                                      uid +
                                      " from " +
                                      group +
                                      "? They may lose access to files shared with this group.",
                                  )
                                )
                                  mutate(
                                    () =>
                                      send(
                                        "/admin/groups/" +
                                          encodeURIComponent(group) +
                                          "/members",
                                        "DELETE",
                                        { userid: uid },
                                      ),
                                    "Member removed",
                                  );
                              }}
                            >
                              <X size={17} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    !memberError && (
                      <div className="empty compact">
                        <Users size={26} />
                        <h3>No members yet</h3>
                        <p>
                          Find an existing user above and add them to this team.
                        </p>
                      </div>
                    )
                  )}
                  <p className="hint admin-share-tip">
                    To share files with this group, select a file or folder in
                    All files → Sharing, then search for “{group}”.
                  </p>
                </>
              ) : (
                <div className="empty">
                  <Users size={28} />
                  <h3>Select or create a group</h3>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="browser-footer">
          <span>
            Page {Math.floor(offset / (tab === "users" ? 20 : 30)) + 1}
          </span>
          <div className="admin-pagination">
            <button
              className="secondary"
              disabled={busy || loading || offset === 0}
              onClick={() =>
                setOffset(Math.max(0, offset - (tab === "users" ? 20 : 30)))
              }
            >
              Previous
            </button>
            <button
              className="secondary"
              disabled={busy || loading || !result.hasMore}
              onClick={() => setOffset(offset + (tab === "users" ? 20 : 30))}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {dialog && (
        <Dialog
          title={
            dialog === "group" ? "Create a team group" : "Create a user account"
          }
          onClose={() => setDialog(null)}
          busy={busy}
        >
          <form onSubmit={create}>
            {dialogError && (
              <div className="error" role="alert">
                {dialogError}
              </div>
            )}
            {dialog === "group" ? (
              <>
                <label>
                  Group name
                  <input
                    name="groupid"
                    autoFocus
                    required
                    maxLength={128}
                    placeholder="Project-Team"
                  />
                </label>
                <p className="hint">
                  Create the group first, then add existing users as members.
                </p>
              </>
            ) : (
              <>
                <label>
                  Username
                  <input
                    name="userid"
                    autoFocus
                    required
                    maxLength={128}
                    pattern="[A-Za-z0-9_.@\-]+"
                    autoComplete="off"
                    placeholder="ayman"
                  />
                </label>
                <label>
                  Display name
                  <input
                    name="displayName"
                    required
                    maxLength={128}
                    autoComplete="off"
                    placeholder="Ayman"
                  />
                </label>
                <label>
                  Email (optional)
                  <input
                    type="email"
                    name="email"
                    maxLength={254}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Initial password
                  <input
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={1024}
                  />
                </label>
                <p className="hint">
                  Use at least 12 characters and follow your organization’s
                  password policy. Share the password securely. This form does
                  not send invitations or force a password change.
                </p>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy
                  ? "Creating…"
                  : dialog === "group"
                    ? "Create group"
                    : "Create user"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
