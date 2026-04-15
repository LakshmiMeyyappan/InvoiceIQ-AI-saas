import { useEffect, useState } from "react";
import axios from "axios";

/* const API = "http://127.0.0.1:8000";

const API = "http://13.233.116.154:8501";*/

const API = import.meta.env.VITE_API_URL;

function StatusBadge({ status }) {
  if (status === "APPROVED") return <span className="badge badge-approved">✓ Approved</span>;
  if (status === "HOLD") return <span className="badge badge-hold">⏸ On Hold</span>;
  return <span className="badge badge-pending">⏳ Pending</span>;
}

function fmt(num) {
  if (num == null) return "—";
  return "₹" + Number(num).toLocaleString("en-IN");
}

export default function Dashboard({ refreshTrigger, onRefresh }) {
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rematching, setRematching] = useState(false);
  const [rematchResult, setRematchResult] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [inv, st] = await Promise.all([
        axios.get(`${API}/invoices/`),
        axios.get(`${API}/stats/`),
      ]);
      setData(inv.data);
      setStats(st.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [refreshTrigger]);

  const handleRematch = async () => {
    setRematching(true);
    setRematchResult(null);
    try {
      const res = await axios.post(`${API}/rematch-all/`);
      setRematchResult(res.data);
      fetchAll();
      if (onRefresh) onRefresh();
    } catch (e) {
      setRematchResult({ error: "Rematch failed" });
    } finally {
      setRematching(false);
    }
  };

  const heldCount = data.filter(d => d["Status"] === "HOLD").length;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Invoice Dashboard</h1>
        <p className="page-subtitle">All uploaded invoices and their 3-way match status</p>
      </div>

      {/* STAT CARDS */}
      {stats && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon">🧾</div>
            <div className="stat-label">Total Invoices</div>
            <div className="stat-value">{stats.total_invoices}</div>
            <div className="stat-sub">All time</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-label">Approved</div>
            <div className="stat-value" style={{ color: "var(--success)" }}>{stats.approved}</div>
            <div className="stat-sub">3-way matched</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">⏸</div>
            <div className="stat-label">On Hold</div>
            <div className="stat-value" style={{ color: "var(--danger)" }}>{stats.held}</div>
            <div className="stat-sub">Needs review</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">💰</div>
            <div className="stat-label">Total Value (INR)</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmt(stats.total_value_inr)}</div>
            <div className="stat-sub">Excl. shipping &amp; handling</div>
          </div>
        </div>
      )}

      {/* REMATCH BANNER */}
      {heldCount > 0 && (
        <div className="rematch-banner">
          <span>⚠️ {heldCount} invoice{heldCount > 1 ? "s" : ""} on hold — uploaded a missing PO or GRN? Re-run matching.</span>
          <button className="btn btn-ghost" onClick={handleRematch} disabled={rematching}
            style={{ color: "var(--warning)", borderColor: "rgba(245,158,11,0.3)", fontSize: 12 }}>
            {rematching ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Running...</> : "⟳ Re-run Match"}
          </button>
        </div>
      )}

      {rematchResult && !rematchResult.error && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          ✓ Re-matched {rematchResult.rematched} invoice(s).
          {rematchResult.results?.map(r => (
            <span key={r.invoice} style={{ marginLeft: 8 }}>
              [{r.invoice}: {r.old_status} → <strong>{r.new_status}</strong>]
            </span>
          ))}
        </div>
      )}

      {/* TABLE */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="table-title">Invoices</span>
          <span className="table-count">{data.length} record{data.length !== 1 ? "s" : ""}</span>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        ) : data.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <div className="empty-state-title">No invoices yet</div>
            <div className="empty-state-sub">Upload PO, GRN, then an Invoice to get started</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th>Invoice ID</th>
                  <th>Vendor</th>
                  <th>PO</th>
                  <th>GRN</th>
                  <th>Currency</th>
                  <th>Total (USD)</th>
                  <th>Total (INR)</th>
                  <th>GST</th>
                  <th>Shipping</th>
                  <th>Handling</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, color: "var(--accent-light)", whiteSpace: "nowrap" }}>{item["Invoice Number"]}</td>
                    <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{item["Vendor Name"]}</td>
                    <td className="td-muted" style={{ whiteSpace: "nowrap" }}>{item["PO Number"] || "—"}</td>
                    <td className="td-muted" style={{ whiteSpace: "nowrap" }}>{item["GRN Number"] || "—"}</td>
                    <td className="td-muted">
                      <span style={{
                        background: item["Currency"] === "USD" ? "rgba(96,165,250,0.15)" : "rgba(52,211,153,0.15)",
                        color: item["Currency"] === "USD" ? "#60a5fa" : "#34d399",
                        borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700
                      }}>{item["Currency"]}</span>
                    </td>
                    <td>
                      {item["Total Amount (USD)"] != null
                        ? <span style={{ fontWeight: 600, color: "#60a5fa" }}>${Number(item["Total Amount (USD)"]).toLocaleString()}</span>
                        : <span className="amount-dash">—</span>}
                    </td>
                    <td><span className="amount-inr">{fmt(item["Total Amount (INR)"])}</span></td>
                    <td className="td-muted">{fmt(item["GST"])}</td>
                    <td className="td-muted">{item["Shipping"] ? fmt(item["Shipping"]) : "—"}</td>
                    <td className="td-muted">{item["Handling"] ? fmt(item["Handling"]) : "—"}</td>
                    <td><StatusBadge status={item["Status"]} /></td>
                    <td>
                      <span className="reason-text" title={item["Reason"]}>{item["Reason"] || "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}