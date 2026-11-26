import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { Button } from "../components/ui/button.js";
import { Dialog } from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { api } from "../lib/api.js";

interface ShareRow {
  id: string;
  expiresAt: number;
  revokedAt: number | null;
  downloadAllowed: boolean;
  watermarkEnabled: boolean;
  recipients: string[];
  opens: number;
}

interface DocumentDetail {
  id: string;
  title: string;
  fileType: string | null;
  filename: string | null;
  shares: ShareRow[];
}

function localValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DocumentPage() {
  const { id } = useParams();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [expires, setExpires] = useState(localValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [password, setPassword] = useState("");
  const [downloadAllowed, setDownloadAllowed] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [link, setLink] = useState("");

  async function load() {
    if (!id) return;
    try {
      setDocument(await api<DocumentDetail>(`/api/documents/${id}`));
      setError("");
    } catch {
      setError("Not found");
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function createShare(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    const recipientEmails = recipients
      .split(/[\s,]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const body: {
      recipientEmails: string[];
      expiresAt: number;
      downloadAllowed: boolean;
      watermarkEnabled: boolean;
      password?: string;
    } = {
      recipientEmails,
      expiresAt: new Date(expires).getTime(),
      downloadAllowed,
      watermarkEnabled,
    };
    if (password) body.password = password;
    const created = await api<{ url: string }>(`/api/documents/${id}/shares`, { json: body });
    setLink(created.url);
    setOpen(false);
    await load();
  }

  if (error) return <main><h1 className="text-2xl">Not found</h1></main>;
  if (!document) return <main>Loading</main>;

  return (
    <main>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl">{document.title}</h1>
          <p className="text-sm text-[#5c564e]">{document.fileType?.toUpperCase()}</p>
        </div>
        <Button onClick={() => setOpen(true)}>Share</Button>
      </div>
      {link ? (
        <label className="mb-6 block text-sm">
          Link
          <Input className="mt-1" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
        </label>
      ) : null}
      {document.shares.length === 0 ? <p>No shares</p> : null}
      <ul className="space-y-3">
        {document.shares.map((share) => (
          <li key={share.id} className="rounded-md border border-[#d9d3c7] bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{share.recipients.join(", ")}</span>
              <span>{share.opens} opens</span>
            </div>
            <p className="mt-1 text-[#5c564e]">
              {new Date(share.expiresAt).toLocaleString()}
              {share.downloadAllowed ? " · Download" : ""}
              {share.watermarkEnabled ? " · Watermark" : ""}
              {share.revokedAt ? " · Revoked" : ""}
            </p>
            {share.revokedAt ? null : (
              <Button
                className="mt-2"
                variant="danger"
                onClick={() => {
                  void api(`/api/shares/${share.id}/revoke`, { method: "POST" }).then(load);
                }}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={open} onOpenChange={setOpen} title="Share">
        <form className="space-y-3" onSubmit={(event) => void createShare(event)}>
          <label className="block text-sm">
            Recipients
            <textarea
              className="mt-1 w-full rounded-md border border-[#d9d3c7] bg-white px-3 py-2"
              rows={3}
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Expiry
            <Input className="mt-1" type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} required />
          </label>
          <label className="block text-sm">
            Password
            <Input className="mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={downloadAllowed} onChange={(event) => setDownloadAllowed(event.target.checked)} />
            Download
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={watermarkEnabled} onChange={(event) => setWatermarkEnabled(event.target.checked)} />
            Watermark
          </label>
          <Button type="submit">Create</Button>
        </form>
      </Dialog>
    </main>
  );
}
