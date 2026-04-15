import { useState } from "react";
import axios from "axios";

/*const API = "http://127.0.0.1:8000";*/
/*const API = "http://13.233.116.154:8501";*/
const API = import.meta.env.VITE_API_URL;

/* USD → INR conversion rate (fallback 84) */
const USD_RATE = 84;

const SUGGESTIONS = [
  "Show all approved invoices",
  "Show all invoices on hold",
  "Which vendor has the highest GST?",
  "What is the total GST amount?",
  "List invoices for TechGuruPlus",
  "What is the total invoice value in INR?",
  "Show all USD invoices",
];

/* ── Amount formatter helpers ────────────────────────── */
function fmtINR(n) {
  if (n == null || n === "") return null;
  const num = parseFloat(n);
  if (isNaN(num)) return null;
  return "₹" + num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtUSD(n) {
  if (n == null || n === "") return null;
  const num = parseFloat(n);
  if (isNaN(num)) return null;
  return "$" + num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* Amount columns that may need dual-currency rendering */
const AMOUNT_COLS = new Set([
  "original_amount", "total_amount", "original_gst", "gst",
  "shipping_charges", "handling_charges",
]);

/* Render a cell value smartly */
function SmartCell({ colKey, value, rowCurrency }) {
  if (value == null || value === "") return <span style={{ color: "var(--text-muted)" }}>—</span>;

  const isUSD = rowCurrency === "USD";

  if (AMOUNT_COLS.has(colKey)) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      /* original_amount / original_gst → in original currency */
      if (colKey === "original_amount" || colKey === "original_gst") {
        if (isUSD) {
          const inrVal = num * USD_RATE;
          return (
            <span>
              <span style={{ fontWeight: 700, color: "#60a5fa" }}>{fmtUSD(num)}</span>
              <br />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                ≈ {fmtINR(inrVal)}
              </span>
            </span>
          );
        }
        return <span style={{ fontWeight: 600 }}>{fmtINR(num)}</span>;
      }
      /* total_amount / gst → already in INR, show USD equivalent if USD invoice */
      if (colKey === "total_amount" || colKey === "gst") {
        if (isUSD) {
          const usdVal = num / USD_RATE;
          return (
            <span>
              <span style={{ fontWeight: 700, color: "#4ade80" }}>{fmtINR(num)}</span>
              <br />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                ≈ {fmtUSD(usdVal)}
              </span>
            </span>
          );
        }
        return <span style={{ fontWeight: 600, color: "#4ade80" }}>{fmtINR(num)}</span>;
      }
      /* other charges */
      return <span>{fmtINR(num)}</span>;
    }
  }

  /* status badge */
  if (colKey === "status") {
    const map = {
      APPROVED: { bg: "rgba(34,197,94,0.15)", color: "#4ade80" },
      HOLD: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },
      PENDING: { bg: "rgba(99,102,241,0.15)", color: "#a5b4fc" },
    };
    const s = map[value] || {};
    return (
      <span style={{
        background: s.bg || "rgba(99,102,241,0.1)", color: s.color || "var(--text-secondary)",
        borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700
      }}>{value}</span>
    );
  }

  /* currency badge */
  if (colKey === "currency") {
    return (
      <span style={{
        background: value === "USD" ? "rgba(96,165,250,0.15)" : "rgba(52,211,153,0.15)",
        color: value === "USD" ? "#60a5fa" : "#34d399",
        borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700
      }}>{value}</span>
    );
  }

  return <span>{String(value)}</span>;
}

/* Human-readable column headers */
const COL_LABELS = {
  vendor: "Vendor",
  invoice_number: "Invoice #",
  invoice_date: "Date",
  currency: "Currency",
  original_amount: "Amount (orig.)",
  original_gst: "GST (orig.)",
  total_amount: "Total (INR)",
  gst: "GST (INR)",
  shipping_charges: "Shipping",
  handling_charges: "Handling",
  status: "Status",
  reason: "Reason",
  po_number: "PO #",
  grn_number: "GRN #",
};

export default function AIChat() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAsk = async (q) => {
    const query = q || question;
    if (!query.trim()) return;
    setLoading(true); setAnswer(null); setError(null);
    try {
      const res = await axios.post(`${API}/ask/`, { question: query });
      setAnswer(res.data);
    } catch (err) {
      setError(err.response?.data?.answer || "Something went wrong");
    } finally { setLoading(false); }
  };

  const handleKey = (e) => { if (e.key === "Enter") handleAsk(); };

  const rows = Array.isArray(answer?.answer) ? answer.answer : [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">AI Insights</h1>
        <p className="page-subtitle">Ask natural language questions about your invoices</p>
      </div>

      {/* Full-width layout */}
      <div style={{ width: "100%", maxWidth: "100%" }}>
        <div className="card">
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12 }}>
            Try a question
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} className="btn btn-ghost"
                style={{ fontSize: 12, padding: "6px 12px" }}
                onClick={() => { setQuestion(s); handleAsk(s); }}>
                {s}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="form-input"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={handleKey}
              placeholder="e.g. Which vendor has the highest GST? Show all USD invoices..."
            />
            <button className="btn btn-primary" onClick={() => handleAsk()}
              disabled={loading || !question.trim()} style={{ whiteSpace: "nowrap" }}>
              {loading ? <div className="spinner" /> : "Ask AI"}
            </button>
          </div>

          {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}

          {answer && (
            <div style={{ marginTop: 20 }}>
              {/* SQL pill */}
              {answer.sql && (
                <div style={{
                  background: "var(--bg-primary)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", padding: "10px 14px",
                  fontFamily: "monospace", fontSize: 12, color: "var(--accent-light)",
                  marginBottom: 12, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all"
                }}>
                  🔍 SQL: {answer.sql}
                </div>
              )}

              {/* USD notice */}
              {rows.some(r => r.currency === "USD") && (
                <div style={{
                  background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)",
                  borderRadius: 8, padding: "8px 14px", marginBottom: 12,
                  fontSize: 12, color: "#60a5fa", display: "flex", alignItems: "center", gap: 8
                }}>
                  💱 USD amounts shown with INR equivalent (rate ≈ ₹{USD_RATE}/$)
                </div>
              )}

              {rows.length > 0 ? (
                <div className="table-wrap" style={{ overflowX: "auto", width: "100%" }}>
                  <div className="table-toolbar">
                    <span className="table-title">Results</span>
                    <span className="table-count">{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ minWidth: columns.length > 6 ? 900 : "auto" }}>
                      <thead>
                        <tr>
                          {columns.map(k => (
                            <th key={k}>{COL_LABELS[k] || k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i}>
                            {columns.map((k, j) => (
                              <td key={j} style={{ verticalAlign: "top" }}>
                                <SmartCell
                                  colKey={k}
                                  value={row[k]}
                                  rowCurrency={row.currency}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : Array.isArray(answer.answer) && answer.answer.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🔍</div>
                  <div className="empty-state-title">No results found</div>
                  <div className="empty-state-sub">Try a different question</div>
                </div>
              ) : (
                <div className="chat-response">{JSON.stringify(answer.answer, null, 2)}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}