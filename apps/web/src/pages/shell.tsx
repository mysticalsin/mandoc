import { useEffect, useState, type FormEvent } from "react";
import { Link, Outlet } from "react-router";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ApiError, api } from "../lib/api.js";

interface Me {
  id: string;
  email: string;
  role: "admin" | "member";
}

export function StaffShell() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  async function load() {
    try {
      setMe(await api<Me>("/api/auth/me"));
    } catch {
      setMe(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (me === undefined) return <main className="p-6">Loading</main>;
  if (!me) return <SignIn onDone={load} />;

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3 border-b border-[#d9d3c7] pb-3">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link to="/library">Library</Link>
          {me.role === "admin" ? (
            <>
              <Link to="/admin/users">Users</Link>
              <Link to="/admin/shares">Shares</Link>
              <Link to="/admin/audit">Audit</Link>
            </>
          ) : null}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span>{me.email}</span>
          <Button
            variant="ghost"
            onClick={() => {
              void api("/api/auth/sign-out", { method: "POST" }).then(() => setMe(null));
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <Outlet context={me} />
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/auth/otp/request", { json: { email } });
    } catch {
      setError("Could not send a code");
      return;
    }
    setSent(true);
    try {
      const outbox = await api<{ messages: { email: string; code: string; kind: string }[] }>("/api/dev/outbox");
      const local = outbox.messages.find((message) => message.email === email.trim().toLowerCase() && message.kind === "staff_otp");
      if (local) setCode(local.code);
    } catch (caught) {
      if (!(caught instanceof ApiError)) setError("Could not send a code");
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/auth/otp/verify", { json: { email, code } });
      await onDone();
    } catch {
      setError("Invalid or expired code");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl">Sign in</h1>
      {error ? <p className="mb-3 text-sm text-[#7a2e2e]">{error}</p> : null}
      {sent ? (
        <form className="space-y-3" onSubmit={(event) => void verify(event)}>
          <label className="block text-sm">
            Code
            <Input className="mt-1" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required />
          </label>
          <Button type="submit">Sign in</Button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={(event) => void requestCode(event)}>
          <label className="block text-sm">
            Email
            <Input className="mt-1" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <Button type="submit">Continue</Button>
        </form>
      )}
    </main>
  );
}
