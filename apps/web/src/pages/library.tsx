import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "../components/ui/button.js";
import { api } from "../lib/api.js";

interface DocumentRow {
  id: string;
  title: string;
  fileType: string;
  byteSize: number;
  createdAt: number;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function LibraryPage() {
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const body = await api<{ documents: DocumentRow[] }>("/api/documents");
      setDocuments(body.documents);
      setError("");
    } catch {
      setError("Could not load");
      setDocuments([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function upload(file: File) {
    setError("");
    setProgress("Starting");
    try {
      const created = await api<{ uploadId: string; partSize: number; partCount: number }>("/api/uploads", {
        json: { filename: file.name, contentType: file.type || "application/octet-stream", byteSize: file.size },
      });
      for (let index = 0; index < created.partCount; index += 1) {
        setProgress(`Part ${index + 1} of ${created.partCount}`);
        const chunk = file.slice(index * created.partSize, (index + 1) * created.partSize);
        await api(`/api/uploads/${created.uploadId}/parts/${index + 1}`, {
          method: "PUT",
          body: new Uint8Array(await chunk.arrayBuffer()),
        });
      }
      await api(`/api/uploads/${created.uploadId}/complete`, { json: {} });
      setProgress("");
      await load();
    } catch {
      setProgress("");
      setError("Upload failed");
    }
  }

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl">Library</h1>
        <div>
          <input
            ref={input}
            className="hidden"
            type="file"
            accept=".pdf,.docx,.pptx,.xlsx,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
          <Button onClick={() => input.current?.click()}>Upload</Button>
        </div>
      </div>
      {progress ? <p className="mb-3 text-sm">{progress}</p> : null}
      {error ? <p className="mb-3 text-sm text-[#7a2e2e]">{error}</p> : null}
      {documents === null ? <p>Loading</p> : null}
      {documents?.length === 0 ? <p>No documents</p> : null}
      <ul className="divide-y divide-[#d9d3c7] border-y border-[#d9d3c7]">
        {documents?.map((document) => (
          <li key={document.id}>
            <Link className="flex items-baseline justify-between gap-4 py-3" to={`/documents/${document.id}`}>
              <span>{document.title}</span>
              <span className="text-sm text-[#5c564e]">
                {document.fileType.toUpperCase()} · {formatBytes(document.byteSize)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
