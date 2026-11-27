import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { api } from "../lib/api.js";

interface UserRow {
  id: string;
  email: string;
  role: "admin" | "member";
  disabledAt: number | null;
}

interface ShareRow {
  id: string;
  title: string;
  ownerEmail: string;
  expiresAt: number;
  revokedAt: number | null;
  opens: number;
}

interface AuditRow {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string;
  targetId: string | null;
  createdAt: number;
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [days, setDays] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setUsers((await api<{ users: UserRow[] }>("/api/admin/users")).users);
      const policy = await api<{ days: number | null }>("/api/admin/retention");
      setDays(policy.days == null ? "" : String(policy.days));
    } catch {
      setError("Not found");
    }
  }

  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    const trimmed = days.trim();
    await api("/api/admin/retention", { method: "PATCH", json: { days: trimmed === "" ? null : Number(trimmed) } });
    await load();
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) return <h1 className="text-2xl">Not found</h1>;
  if (!users) return <p>Loading</p>;

  return (
    <main>
      <h1 className="mb-4 text-2xl">Users</h1>
      <form className="mb-6 flex max-w-xs items-end gap-2" onSubmit={(event) => void saveRetention(event)}>
        <label className="block flex-1 text-sm">
          Days
          <Input className="mt-1" inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
        </label>
        <Button type="submit">Save</Button>
      </form>
      <ul className="divide-y divide-[#d9d3c7] border-y border-[#d9d3c7]">
        {users.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>
              {user.email} · {user.role}
              {user.disabledAt ? " · Disabled" : ""}
            </span>
            <span className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  void api(`/api/admin/users/${user.id}`, { method: "PATCH", json: { role: user.role === "admin" ? "member" : "admin" } }).then(load);
                }}
              >
                {user.role === "admin" ? "Make member" : "Make admin"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void api(`/api/admin/users/${user.id}`, { method: "PATCH", json: { disabled: user.disabledAt == null } }).then(load);
                }}
              >
                {user.disabledAt ? "Enable" : "Disable"}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function SharesPage() {
  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setShares((await api<{ shares: ShareRow[] }>("/api/admin/shares")).shares);
    } catch {
      setError("Not found");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) return <h1 className="text-2xl">Not found</h1>;
  if (!shares) return <p>Loading</p>;

  return (
    <main>
      <h1 className="mb-4 text-2xl">Shares</h1>
      {shares.length === 0 ? <p>No shares</p> : null}
      <ul className="divide-y divide-[#d9d3c7] border-y border-[#d9d3c7]">
        {shares.map((share) => (
          <li key={share.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>
              {share.title} · {share.ownerEmail} · {share.opens} opens
              {share.revokedAt ? " · Revoked" : ""}
            </span>
            {share.revokedAt ? null : (
              <Button
                variant="danger"
                onClick={() => {
                  void api(`/api/admin/shares/${share.id}/revoke`, { method: "POST" }).then(load);
                }}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ audit: AuditRow[] }>("/api/admin/audit")
      .then((body) => setRows(body.audit))
      .catch(() => setError("Not found"));
  }, []);

  if (error) return <h1 className="text-2xl">Not found</h1>;
  if (!rows) return <p>Loading</p>;

  return (
    <main>
      <h1 className="mb-4 text-2xl">Audit</h1>
      <ul className="divide-y divide-[#d9d3c7] border-y border-[#d9d3c7] text-sm">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr_auto]">
            <span>{row.action}</span>
            <span>{row.actorEmail ?? "system"}</span>
            <time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </main>
  );
}
