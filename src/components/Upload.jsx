import { useState, useRef } from "react";
import axios from "axios";

/*const API = "http://127.0.0.1:8000";

const API = "http://13.233.116.154:8501";*/

const API = import.meta.env.VITE_API_URL;

/* ─── Status badges ────────────────────────────────────────────── */
function ResultBadge({ status }) {
  const map = {
    APPROVED: { bg: "rgba(34,197,94,0.15)", color: "#4ade80", label: "✓ Approved" },
    MATCHED: { bg: "rgba(34,197,94,0.15)", color: "#4ade80", label: "✓ Matched" },
    HOLD: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", label: "⏸ On Hold" },
    PARTIAL: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", label: "⚡ Partial" },
    MISMATCH: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "✗ Mismatch" },
    MISSING_PO: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "✗ No PO" },
    MISSING_GRN: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "✗ No GRN" },
    DUPLICATE: { bg: "rgba(99,102,241,0.15)", color: "#818cf8", label: "⊘ Duplicate" },
    error: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "✗ Error" },
  };
  const s = map[status] || { bg: "rgba(99,102,241,0.12)", color: "#a5b4fc", label: status };
  return (
    <span style={{
      background: s.bg, color: s.color, borderRadius: 6,
      padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap"
    }}>{s.label}</span>
  );
}

/* ────────────────────────────────────────────────────────────────
   SINGLE INVOICE TAB
──────────────────────────────────────────────────────────────── */
function SingleUpload({ onSuccess }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  const handleFile = (f) => { if (f) setFile(f); };

  const handleUpload = async () => {
    if (!file) { setStatus({ type: "error", msg: "Please select a PDF file" }); return; }
    setLoading(true); setStatus(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await axios.post(`${API}/upload/`, fd);
      const d = res.data;
      const ok = d.status === "APPROVED";
      setStatus({
        type: ok ? "success" : "warning",
        msg: `${ok ? "✓" : "⏸"} Invoice processed — Status: ${d.status} | ${d.reason}`,
      });
      setFile(null);
      if (onSuccess) onSuccess();
    } catch (err) {
      setStatus({ type: "error", msg: err.response?.data?.detail || "Upload failed" });
    } finally { setLoading(false); }
  };

  return (
    <div className="card">
      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        💡 Upload PO and GRN <strong>first</strong> before uploading the invoice for auto-approval.
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>🧾 Upload Invoice PDF</h3>

      <div
        className={`upload-zone ${dragging ? "dragging" : ""}`}
        onClick={() => fileRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
      >
        <span className="upload-zone-icon">🧾</span>
        <div className="upload-zone-title">Drop your Invoice PDF here</div>
        <div className="upload-zone-sub">or click to browse — PDF only</div>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
        onChange={e => handleFile(e.target.files[0])} />

      {file && (
        <div className="file-selected">
          📎 {file.name}
          <button onClick={() => setFile(null)} style={{
            marginLeft: "auto", background: "none", border: "none",
            color: "var(--danger)", cursor: "pointer", fontSize: 16
          }}>×</button>
        </div>
      )}

      <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }}
        onClick={handleUpload} disabled={loading || !file}>
        {loading ? <><div className="spinner" /> Extracting &amp; Matching…</> : "⚡ Process Invoice"}
      </button>

      {status && (
        <div className={`alert alert-${status.type === "success" ? "success" : status.type === "warning" ? "error" : "error"}`}
          style={{ marginTop: 14 }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   BULK UPLOAD TAB
──────────────────────────────────────────────────────────────── */
function BulkUploadPanel({ onSuccess }) {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const addFiles = (incoming) => {
    const pdfs = Array.from(incoming).filter(f =>
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    setFiles(prev => {
      const exists = new Set(prev.map(f => f.name));
      return [...prev, ...pdfs.filter(f => !exists.has(f.name))];
    });
    setResult(null); setError(null);
  };

  const removeFile = (name) => setFiles(prev => prev.filter(f => f.name !== name));

  const handleUpload = async () => {
    if (!files.length) return;
    setLoading(true); setProgress(0); setResult(null); setError(null);
    const fd = new FormData();
    files.forEach(f => fd.append("files", f));
    try {
      const res = await axios.post(`${API}/bulk-upload/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: e => { if (e.total) setProgress(Math.round((e.loaded / e.total) * 75)); },
      });
      setProgress(100);
      setResult(res.data);
      setFiles([]);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.response?.data?.detail || "Bulk upload failed. Make sure backend is running.");
    } finally { setLoading(false); }
  };

  /* derived counts */
  const fileStatuses = result?.file_statuses || [];
  const matchResults = result?.match_results || [];
  const savedToDB = result?.saved_to_db || {};
  const poCount = fileStatuses.filter(f => f.doc_type === "PO").length;
  const grnCount = fileStatuses.filter(f => f.doc_type === "GRN").length;
  const invCount = fileStatuses.filter(f => f.doc_type === "INVOICE").length;
  const errCount = result?.errors ?? 0;
  const approved = matchResults.filter(r => r.status === "MATCHED").length;
  const held = matchResults.filter(r => ["MISMATCH", "MISSING_PO", "MISSING_GRN"].includes(r.status)).length;

  return (
    <div className="card">
      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        📂 Drop <strong>any mix</strong> of PO, GRN, and Invoice PDFs — the AI will auto-classify each file,
        separate them, save each to the database, and run 3-way matching automatically.
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>📂 Bulk Upload — Multiple PDFs</h3>

      {/* Drop Zone */}
      <div
        className={`upload-zone ${dragging ? "dragging" : ""}`}
        style={{ minHeight: 130 }}
        onClick={() => fileRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <span className="upload-zone-icon">📂</span>
        <div className="upload-zone-title">Drop multiple PDFs or a folder here</div>
        <div className="upload-zone-sub">AI auto-detects: PO / GRN / Invoice — max 50 files</div>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf" multiple
        style={{ display: "none" }} onChange={e => addFiles(e.target.files)} />

      {/* Selected file chips */}
      {files.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
            {files.length} file{files.length !== 1 ? "s" : ""} selected
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 140, overflowY: "auto" }}>
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

      {/* Progress bar */}
      {loading && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
            AI classifying &amp; processing… {progress}%
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

      <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }}
        onClick={handleUpload} disabled={loading || !files.length}>
        {loading
          ? <><div className="spinner" /> AI Processing Batch…</>
          : `⚡ Process ${files.length || ""} File${files.length !== 1 ? "s" : ""}`}
      </button>

      {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}

      {/* ── Results ── */}
      {result && (
        <div style={{ marginTop: 24 }}>

          {/* Classification pills */}
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
            📊 AI Classification &amp; DB Save Results
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            {[
              { label: "Total Files", val: result.total_files, color: "var(--accent-light)", bg: "rgba(99,102,241,0.1)" },
              { label: "POs Found", val: poCount, color: "#60a5fa", bg: "rgba(59,130,246,0.1)" },
              { label: "GRNs Found", val: grnCount, color: "#a78bfa", bg: "rgba(139,92,246,0.1)" },
              { label: "Invoices", val: invCount, color: "#34d399", bg: "rgba(52,211,153,0.1)" },
              { label: "POs Saved", val: savedToDB.po ?? 0, color: "#60a5fa", bg: "rgba(59,130,246,0.08)" },
              { label: "GRNs Saved", val: savedToDB.grn ?? 0, color: "#a78bfa", bg: "rgba(139,92,246,0.08)" },
              { label: "Inv Saved", val: savedToDB.invoice ?? 0, color: "#4ade80", bg: "rgba(34,197,94,0.08)" },
              { label: "Matched", val: approved, color: "#4ade80", bg: "rgba(34,197,94,0.1)" },
              { label: "Issues", val: held, color: "#f87171", bg: "rgba(239,68,68,0.1)" },
              { label: "Errors", val: errCount, color: "#fb923c", bg: "rgba(249,115,22,0.1)" },
            ].map(({ label, val, color, bg }) => (
              <div key={label} style={{ minWidth: 90, background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Per-file classification table */}
          {fileStatuses.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
                🗂️ Per-file Classification
              </div>
              <div className="table-wrap" style={{ margin: "0 0 20px 0" }}>
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Detected Type</th>
                      <th>Number</th>
                      <th>Vendor</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileStatuses.map((f, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.filename}>{f.filename}</td>
                        <td>
                          <span style={{ fontWeight: 600, color: f.doc_type === "PO" ? "#60a5fa" : f.doc_type === "GRN" ? "#a78bfa" : "#34d399" }}>
                            {f.doc_type || "—"}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, color: "var(--accent-light)", fontSize: 12 }}>
                          {f.invoice_number || f.grn_number || f.po_number || "—"}
                        </td>
                        <td style={{ fontSize: 12 }}>{f.vendor || "—"}</td>
                        <td>
                          {f.status === "error"
                            ? <ResultBadge status="error" />
                            : f.status === "done"
                              ? <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>✓ Saved</span>
                              : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{f.status}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 3-way match results */}
          {matchResults.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
                🔗 3-Way Match Results
              </div>
              <div className="table-wrap" style={{ margin: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>PO #</th>
                      <th>Match Status</th>
                      <th>Reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchResults.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600, color: "var(--accent-light)" }}>{r.invoice_number || "—"}</td>
                        <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{r.po_number || "—"}</td>
                        <td><ResultBadge status={r.status} /></td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {r.reasons?.join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   MAIN EXPORT — Tabbed Upload Page
──────────────────────────────────────────────────────────────── */
export default function Upload({ onSuccess }) {
  const [tab, setTab] = useState("single");

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Upload Documents</h1>
        <p className="page-subtitle">Upload a single invoice or drop a full batch — AI handles classification &amp; matching</p>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {[
          { id: "single", label: "🧾 Single Invoice" },
          { id: "bulk", label: "📂 Bulk Upload" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "10px 20px", fontSize: 14, fontWeight: 600,
            color: tab === t.id ? "var(--accent-light)" : "var(--text-muted)",
            borderBottom: tab === t.id ? "2px solid var(--accent-light)" : "2px solid transparent",
            marginBottom: -1, transition: "all 0.2s",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 680 }}>
        {tab === "single" && <SingleUpload onSuccess={onSuccess} />}
        {tab === "bulk" && <BulkUploadPanel onSuccess={onSuccess} />}
      </div>
    </div>
  );
}