import { useState, useRef } from "react";
import axios from "axios";

/* const API = "http://127.0.0.1:8000"; 

const API = "http://13.233.116.154:8501";*/

const API = import.meta.env.VITE_API_URL;

export default function POUpload({ onSuccess }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null); // {type, msg, detail}
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  // Manual entry state
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ po_number: "", vendor: "", item: "", quantity: "", price: "" });
  const [manualStatus, setManualStatus] = useState(null);
  const [manualLoading, setManualLoading] = useState(false);

  const handleFile = (f) => { if (f) setFile(f); };

  const handleUpload = async () => {
    if (!file) { setStatus({ type: "error", msg: "Please select a PDF file" }); return; }
    setLoading(true); setStatus(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post(`${API}/upload-po-pdf/`, formData);
      const d = res.data;
      setStatus({
        type: "success",
        msg: `✓ PO saved — ${d.po_number} | ${d.vendor} | ${d.item} | Qty: ${d.quantity} | Unit: ₹${d.unit_price} | Expected: ₹${d.expected_total?.toLocaleString()}`,
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

  const handleManualSubmit = async () => {
    const { po_number, vendor, item, quantity, price } = manual;
    if (!po_number || !vendor || !quantity || !price) {
      setManualStatus({ type: "error", msg: "Fill all required fields" }); return;
    }
    setManualLoading(true); setManualStatus(null);
    try {
      const res = await axios.post(`${API}/manual-po/`, {
        po_number, vendor, item,
        quantity: parseInt(quantity),
        price: parseFloat(price),
      });
      setManualStatus({ type: "success", msg: `✓ ${res.data.message} — Expected: ₹${res.data.expected_total?.toLocaleString()}` });
      setManual({ po_number: "", vendor: "", item: "", quantity: "", price: "" });
      if (onSuccess) onSuccess();
    } catch (err) {
      setManualStatus({ type: "error", msg: err.response?.data?.detail || "Failed" });
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Upload Purchase Order</h1>
        <p className="page-subtitle">Upload a PO PDF or enter details manually</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

        {/* PDF Upload */}
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text-primary)" }}>📄 Upload PO PDF</h3>
          <div
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          >
            <span className="upload-zone-icon">📁</span>
            <div className="upload-zone-title">Drop your PO PDF here</div>
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

          <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }}
            onClick={handleUpload} disabled={loading || !file}>
            {loading ? <><div className="spinner" /> Extracting...</> : "⬆ Upload PO"}
          </button>

          {status && <div className={`alert alert-${status.type === "success" ? "success" : "error"}`}>{status.msg}</div>}
        </div>

        {/* Manual Entry */}
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text-primary)" }}>✏️ Manual PO Entry</h3>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
            Use this if PDF parsing fails or to quickly seed a PO. Existing POs will be updated.
          </p>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">PO Number *</label>
              <input className="form-input" placeholder="e.g. PO101" value={manual.po_number}
                onChange={e => setManual({ ...manual, po_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Vendor *</label>
              <input className="form-input" placeholder="e.g. TechGuruPlus" value={manual.vendor}
                onChange={e => setManual({ ...manual, vendor: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Item</label>
              <input className="form-input" placeholder="e.g. Laptop" value={manual.item}
                onChange={e => setManual({ ...manual, item: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Quantity *</label>
              <input className="form-input" type="number" placeholder="e.g. 10" value={manual.quantity}
                onChange={e => setManual({ ...manual, quantity: e.target.value })} />
            </div>
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Unit Price (₹) *</label>
              <input className="form-input" type="number" placeholder="e.g. 5000" value={manual.price}
                onChange={e => setManual({ ...manual, price: e.target.value })} />
              {manual.quantity && manual.price && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--success)" }}>
                  Expected Total: ₹{(parseInt(manual.quantity || 0) * parseFloat(manual.price || 0)).toLocaleString("en-IN")}
                </div>
              )}
            </div>
          </div>

          <button className="btn btn-success" style={{ width: "100%" }}
            onClick={handleManualSubmit} disabled={manualLoading}>
            {manualLoading ? <><div className="spinner" /> Saving...</> : "💾 Save PO Manually"}
          </button>

          {manualStatus && <div className={`alert alert-${manualStatus.type === "success" ? "success" : "error"}`}>{manualStatus.msg}</div>}
        </div>

      </div>
    </div>
  );
}