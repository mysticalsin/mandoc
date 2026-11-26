import { previewOffice, type FileType } from "@mandoc/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ApiError, api, apiBytes } from "../lib/api.js";

interface Landing {
  title: string;
  fileType: FileType;
  expiresAt: number;
  passwordRequired: boolean;
}

interface GrantResponse {
  grant: string;
  fileType: FileType;
  filename: string;
  watermark: boolean;
  email: string;
  download: boolean;
}

export function ViewerPage() {
  const { token } = useParams();
  const [landing, setLanding] = useState<Landing | null | undefined>(undefined);
  const [step, setStep] = useState<"email" | "code" | "password" | "view">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [grant, setGrant] = useState<GrantResponse | null>(null);

  useEffect(() => {
    if (!token) return;
    void api<Landing>(`/api/public/s/${token}`)
      .then((body) => {
        setLanding(body);
        setError("");
      })
      .catch(() => {
        setLanding(null);
      });
  }, [token]);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    await api(`/api/public/s/${token}/otp/request`, { json: { email } });
    setStep("code");
    try {
      const outbox = await api<{ messages: { email: string; code: string; kind: string }[] }>("/api/dev/outbox");
      const local = outbox.messages.find((message) => message.email === email.trim().toLowerCase() && message.kind === "viewer_otp");
      if (local) setCode(local.code);
    } catch {
      /* production has no outbox */
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = await api<{ passwordRequired: boolean }>(`/api/public/s/${token}/otp/verify`, { json: { email, code } });
      setStep(body.passwordRequired ? "password" : "view");
      if (!body.passwordRequired) await openGrant();
    } catch {
      setError("Invalid or expired code");
    }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/public/s/${token}/password`, { json: { password } });
      setStep("view");
      await openGrant();
    } catch {
      setError("Invalid password");
    }
  }

  async function openGrant() {
    const body = await api<GrantResponse>(`/api/public/s/${token}/grant`, { json: {} });
    setGrant(body);
  }

  if (landing === undefined) return <main className="p-6">Loading</main>;
  if (landing === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
        <h1 className="text-2xl">Not found</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <h1 className="mb-4 text-2xl">{step === "view" && grant ? grant.filename : landing.title}</h1>
      {error ? <p className="mb-3 text-sm text-[#7a2e2e]">{error}</p> : null}
      {step === "email" ? (
        <form className="max-w-sm space-y-3" onSubmit={(event) => void requestCode(event)}>
          <label className="block text-sm">
            Email
            <Input className="mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <Button type="submit">Continue</Button>
        </form>
      ) : null}
      {step === "code" ? (
        <form className="max-w-sm space-y-3" onSubmit={(event) => void verify(event)}>
          <label className="block text-sm">
            Code
            <Input className="mt-1" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} required />
          </label>
          <Button type="submit">Sign in</Button>
        </form>
      ) : null}
      {step === "password" ? (
        <form className="max-w-sm space-y-3" onSubmit={(event) => void unlock(event)}>
          <label className="block text-sm">
            Password
            <Input className="mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <Button type="submit">Continue</Button>
        </form>
      ) : null}
      {step === "view" && grant ? <DocumentView grant={grant} /> : null}
    </main>
  );
}

function DocumentView({ grant }: { grant: GrantResponse }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const file = await apiBytes(`/api/view/${encodeURIComponent(grant.grant)}`);
        if (cancelled) return;
        if (grant.fileType === "pdf") {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
          const doc = await pdfjs.getDocument({ data: file.bytes.slice() }).promise;
          const page = await doc.getPage(1);
          const viewport = page.getViewport({ scale: 1.4 });
          const target = canvas.current;
          if (!target) return;
          target.width = viewport.width;
          target.height = viewport.height;
          const context = target.getContext("2d");
          if (!context) return;
          await page.render({ canvas: target, canvasContext: context, viewport }).promise;
        } else {
          const preview = previewOffice(file.bytes, grant.fileType);
          setText(preview?.text || "No preview");
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === "not_found") setError("Not found");
        else setError("Could not open");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grant]);

  async function download() {
    const file = await apiBytes(`/api/download/${encodeURIComponent(grant.grant)}`);
    const copy = new Uint8Array(file.bytes.byteLength);
    copy.set(file.bytes);
    const blob = new Blob([copy], { type: file.contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = grant.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="relative overflow-hidden rounded-md border border-[#d9d3c7] bg-white">
      {error ? <p className="p-4">{error}</p> : null}
      {grant.fileType === "pdf" ? <canvas ref={canvas} className="max-w-full" /> : <pre className="whitespace-pre-wrap p-4 text-sm">{text}</pre>}
      {grant.watermark ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-around overflow-hidden" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="-rotate-12 text-center text-lg text-[#7a2e2e]/35">
              {grant.email}
            </span>
          ))}
        </div>
      ) : null}
      {grant.download ? (
        <div className="border-t border-[#d9d3c7] p-3">
          <Button onClick={() => void download()}>Download</Button>
        </div>
      ) : null}
    </section>
  );
}
