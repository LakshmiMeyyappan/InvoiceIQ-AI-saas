import { useState, useRef } from "react";
import axios from "axios";

/* const API = "http://127.0.0.1:8000"; 

const API = "http://13.233.116.154:8501";*/

const API = import.meta.env.VITE_API_URL;

function ResultBadge({ status }) {
  if (status === "APPROVED") return <span className="badge badge-approved">✓ Approved</span>;
  if (status === "HOLD") return <span className="badge badge-hold">⏸ On Hold</span>;
  if (status === "error") return <span className="badge" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>✗ Error</span>;
  return <span className="badge badge-pending">⏳ {status}</span>;
}

export default function BulkUpload({ onSuccess }) {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  /* ── file handling ── */
  const addFiles = (incoming) => {
    const pdfs = Array.from(incoming).filter(f =>
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const fresh = pdfs.filter(f => !existing.has(f.name));
      return [...prev, ...fresh];
    });
    setResult(null);
    setError(null);
  };

  const removeFile = (name) => setFiles(prev => prev.filter(f => f.name !== name));

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  /* ── upload ── */
  const handleUpload = async () => {
    if (!files.length) return;
    setLoading(true);
    setProgress(0);
    setResult(null);
    setError(null);

    const formData = new FormData();
    files.forEach(f => formData.append("files", f));

    try {
      const res = await axios.post(`${API}/bulk-upload/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 80));
        },
      });
      setProgress(100);
      setResult(res.data);
      setFiles([]);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.response?.data?.detail || "Bulk upload failed. Check the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  /* ── derived ── */
  const approved = result?.results?.filter(r => r.status === "APPROVED").length ?? 0;
  const held = result?.results?.filter(r => r.status === "HOLD").length ?? 0;
  const errors = result?.errors ?? 0;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Bulk Upload</h1>
        <p className="page-subtitle">Upload multiple invoice PDFs at once — AI will auto-classify and 3-way match each one</p>
      </div>

      <div style={{ maxWidth: 760 }}>

        {/* ── drop zone ── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            style={{ minHeight: 140 }}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="upload-zone-icon">📂</span>
            <div className="upload-zone-title">Drop a folder or multiple PDF files here</div>
            <div className="upload-zone-sub">or click to browse — PDFs only · max 50 files</div>
          </div>
          {/* allow multiple file selection */}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={e => addFiles(e.target.files)}
          />

          {/* selected file chips */}
          {files.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
                {files.length} file{files.length > 1 ? "s" : ""} selected
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 160, overflowY: "auto" }}>
                {files.map(f => (
                  <div key={f.name} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
                    borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "var(--text-secondary)"
                  }}>
                    📄 {f.name}
                    <button onClick={() => removeFile(f.name)} style={{
                      background: "none", border: "none", color: "var(--danger)",
                      cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0
                    }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* progress bar */}
          {loading && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                Processing {files.length} files… {progress}%
              </div>
              <div style={{ background: "var(--bg-primary)", borderRadius: 99, height: 6, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${progress}%`,
                  background: "linear-gradient(90deg, var(--accent), var(--accent-light))",
                  transition: "width 0.4s ease", borderRadius: 99
                }} />
              </div>
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ marginTop: 16, width: "100%" }}
            onClick={handleUpload}
            disabled={loading || !files.length}
          >
            {loading
              ? <><div className="spinner" /> AI Processing Batch…</>
              : `⚡ Process ${files.length || ""} Invoice${files.length !== 1 ? "s" : ""}`}
          </button>

          {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}
        </div>

        {/* ── results ── */}
        {result && (
          <div className="card">
            {/* summary pills */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 110, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>{result.total_files}</div>
              </div>
              <div style={{ flex: 1, minWidth: 110, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Approved</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--success)" }}>{approved}</div>
              </div>
              <div style={{ flex: 1, minWidth: 110, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>On Hold</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--warning)" }}>{held}</div>
              </div>
              <div style={{ flex: 1, minWidth: 110, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Errors</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--danger)" }}>{errors}</div>
              </div>
              <div style={{ flex: 1, minWidth: 110, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Time</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>{result.elapsed_sec?.toFixed(1)}s</div>
              </div>
            </div>

            {/* per-file table */}
            {result.results?.length > 0 && (
              <div className="table-wrap" style={{ margin: 0 }}>
                <div className="table-toolbar">
                  <span className="table-title">Per-file Results</span>
                  <span className="table-count">{result.results.length} file{result.results.length !== 1 ? "s" : ""}</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Type</th>
                      <th>Invoice #</th>
                      <th>Vendor</th>
                      <th>Status</th>
                      <th>Reason / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={r.filename}>{r.filename}</td>
                        <td style={{ textTransform: "capitalize" }}>{r.doc_type || "—"}</td>
                        <td style={{ fontWeight: 600, color: "var(--accent-light)" }}>{r.invoice_number || "—"}</td>
                        <td>{r.vendor || "—"}</td>
                        <td><ResultBadge status={r.status || r.error ? "error" : "PENDING"} /></td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.reason || r.error || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
