import { type DocxBlock, type FileType, type OfficePreview, type OfficeSheet, type SlideBox } from "@mandoc/core";
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
  signIn: "access" | "otp";
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

  useEffect(() => {
    if (!token || landing?.signIn !== "access") return;
    let cancelled = false;
    void api<GrantResponse>(`/api/public/s/${token}/grant`, { json: {} })
      .then((body) => {
        if (cancelled) return;
        setGrant(body);
        setStep("view");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.code === "password_required") setStep("password");
      });
    return () => {
      cancelled = true;
    };
  }, [landing, token]);

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
      {step === "email" && landing.signIn === "access" ? (
        <Button asChild>
          <a href={`/auth/s/${token}`}>Continue</a>
        </Button>
      ) : null}
      {step === "email" && landing.signIn !== "access" ? (
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

function OfficeView({ preview }: { preview: OfficePreview | null }) {
  if (!preview) return null;
  if (preview.kind === "xlsx") return <SheetStack sheets={preview.sheets.length > 0 ? preview.sheets : [{ name: "Sheet", rows: preview.rows }]} />;
  if (preview.kind === "pptx") return <SlideStack preview={preview} />;
  if (preview.blocks.length === 0 && preview.paragraphs.length === 0) return <p className="p-4 text-sm">No preview</p>;
  const blocks = preview.blocks.length > 0 ? preview.blocks : preview.paragraphs.map((text) => ({ kind: "paragraph" as const, text }));
  return (
    <article className="space-y-3 px-8 py-6">
      {blocks.map((block, index) => (
        <DocxBlockView key={index} block={block} />
      ))}
    </article>
  );
}

function DocxBlockView({ block }: { block: DocxBlock }) {
  if (block.kind === "heading") {
    const Tag = block.level <= 1 ? "h2" : "h3";
    return <Tag className={block.level <= 1 ? "text-xl" : "text-lg"}>{block.text}</Tag>;
  }
  if (block.kind === "table") {
    return (
      <table className="w-full border-collapse text-left text-sm">
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-[#d9d3c7] px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <p className="text-sm leading-6">{block.text}</p>;
}

function SlideStack({ preview }: { preview: Extract<OfficePreview, { kind: "pptx" }> }) {
  const frames = preview.frames.length > 0 ? preview.frames : preview.slides.map((text) => [{ text, x: 0.08, y: 0.08, w: 0.84, h: 0.16 }]).map((boxes) => ({ boxes }));
  if (frames.length === 0) return <p className="p-4 text-sm">No preview</p>;
  return (
    <div>
      {frames.map((frame, index) => (
        <div key={index} className="relative aspect-video w-full border-b border-[#d9d3c7] bg-white">
          {frame.boxes.map((box, boxIndex) => (
            <SlideText key={boxIndex} box={box} />
          ))}
        </div>
      ))}
    </div>
  );
}

function SlideText({ box }: { box: SlideBox }) {
  return (
    <p
      className="absolute overflow-hidden whitespace-pre-wrap text-sm"
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${Math.max(box.w, 0.05) * 100}%`, height: `${Math.max(box.h, 0.05) * 100}%` }}
    >
      {box.text}
    </p>
  );
}

function SheetStack({ sheets }: { sheets: OfficeSheet[] }) {
  if (sheets.every((sheet) => sheet.rows.length === 0)) return <p className="p-4 text-sm">No preview</p>;
  return (
    <div className="space-y-6 overflow-auto p-4">
      {sheets.map((sheet) => (
        <table key={sheet.name} className="w-full border-collapse text-left text-sm">
          {sheets.length > 1 || sheet.name !== "Sheet" ? <caption className="mb-2 text-left">{sheet.name}</caption> : null}
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="h-7">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-[#d9d3c7] px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function DocumentView({ grant }: { grant: GrantResponse }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [office, setOffice] = useState<OfficePreview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (grant.fileType === "pdf") {
          const file = await apiBytes(`/api/view/${encodeURIComponent(grant.grant)}`);
          if (cancelled) return;
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
          return;
        }
        const preview = await api<OfficePreview>(`/api/view/${encodeURIComponent(grant.grant)}`);
        if (!cancelled) setOffice(preview);
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
      {grant.fileType === "pdf" ? <canvas ref={canvas} className="max-w-full" /> : <OfficeView preview={office} />}
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
