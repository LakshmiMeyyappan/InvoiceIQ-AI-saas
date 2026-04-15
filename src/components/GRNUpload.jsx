import { useState, useRef } from "react";
import axios from "axios";

/*const API = "http://127.0.0.1:8000";

const API = "http://13.233.116.154:8501";*/

const API = import.meta.env.VITE_API_URL;

export default function GRNUpload({ onSuccess }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  const handleFile = (f) => { if (f) setFile(f); };

  const handleUpload = async () => {
    if (!file) { setStatus({ type: "error", msg: "Please select a PDF file" }); return; }
    setLoading(true); setStatus(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post(`${API}/upload-grn-pdf/`, formData);
      const d = res.data;
      setStatus({
        type: "success",
        msg: `✓ GRN saved — ${d.grn_number} | PO: ${d.po_number} | Qty Received: ${d.quantity_received}`,
      });
      setFile(null);
      if (onSuccess) onSuccess();
    } catch (err) {
      const detail = err.response?.data?.detail || "Upload failed";
      setStatus({ type: "error", msg: detail });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Upload Goods Receipt Note</h1>
        <p className="page-subtitle">Upload a GRN PDF to record received goods</p>
      </div>

      <div style={{ maxWidth: 520 }}>
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>📦 Upload GRN PDF</h3>
          <div
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          >
            <span className="upload-zone-icon">📦</span>
            <div className="upload-zone-title">Drop your GRN PDF here</div>
            <div className="upload-zone-sub">or click to browse</div>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
            onChange={e => handleFile(e.target.files[0])} />

          {file && (
            <div className="file-selected">
              📎 {file.name}
              <button onClick={() => setFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          )}

          <button className="btn btn-success" style={{ marginTop: 16, width: "100%" }}
            onClick={handleUpload} disabled={loading || !file}>
            {loading ? <><div className="spinner" /> Extracting...</> : "⬆ Upload GRN"}
          </button>

          {status && <div className={`alert alert-${status.type === "success" ? "success" : "error"}`}>{status.msg}</div>}
        </div>
      </div>
    </div>
  );
}