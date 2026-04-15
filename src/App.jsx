import { useState, useEffect } from "react";
import axios from "axios";
import POUpload from "./components/POUpload";
import GRNUpload from "./components/GRNUpload";
import Upload from "./components/Upload";
import Dashboard from "./components/Dashboard";
import Analytics from "./components/Analytics";
import AIChat from "./components/AIChat";

/*const API = "http://127.0.0.1:8000";

const API = "http://13.233.116.154:8501";*/

const API = import.meta.env.VITE_API_URL;

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "📊", section: "OVERVIEW" },
  { id: "analytics", label: "Analytics", icon: "📈", section: "OVERVIEW" },
  { id: "po", label: "Upload PO", icon: "📄", section: "DOCUMENTS" },
  { id: "grn", label: "Upload GRN", icon: "📦", section: "DOCUMENTS" },
  { id: "upload", label: "Upload Docs", icon: "📤", section: "DOCUMENTS" },
  { id: "ai", label: "AI Insights", icon: "🤖", section: "INTELLIGENCE" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [stats, setStats] = useState(null);

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API}/stats/`);
      setStats(res.data);
    } catch (_) { }
  };

  useEffect(() => { fetchStats(); }, [refreshTrigger]);

  const onUploadSuccess = () => {
    setRefreshTrigger(t => t + 1);
    setTimeout(() => setTab("dashboard"), 800);
  };

  const sections = [...new Set(NAV.map(n => n.section))];

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>

      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">⚡</div>
          <div>
            <div className="sidebar-brand-name">InvoiceAI</div>
            <div className="sidebar-brand-sub">SaaS Platform</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {sections.map(section => (
            <div key={section} style={{ marginBottom: 16 }}>
              <div className="sidebar-section-label">{section}</div>
              {NAV.filter(n => n.section === section).map(item => (
                <button
                  key={item.id}
                  className={`nav-btn ${tab === item.id ? "active" : ""}`}
                  onClick={() => setTab(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom stats pill */}
        {stats && (
          <div style={{
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.18)",
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: 12,
          }}>
            <div style={{ color: "var(--text-muted)", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", fontSize: 10 }}>Live Summary</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--text-secondary)" }}>Total</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{stats.total_invoices}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--success)" }}>✓ Approved</span>
              <span style={{ color: "var(--success)", fontWeight: 600 }}>{stats.approved}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--danger)" }}>⏸ On Hold</span>
              <span style={{ color: "var(--danger)", fontWeight: 600 }}>{stats.held}</span>
            </div>
          </div>
        )}
      </aside>

      {/* ── MAIN ── */}
      <main className="main-content">
        {tab === "dashboard" && <Dashboard refreshTrigger={refreshTrigger} onRefresh={() => setRefreshTrigger(t => t + 1)} />}
        {tab === "analytics" && <Analytics refreshTrigger={refreshTrigger} />}
        {tab === "po" && <POUpload onSuccess={onUploadSuccess} />}
        {tab === "grn" && <GRNUpload onSuccess={onUploadSuccess} />}
        {tab === "upload" && <Upload onSuccess={onUploadSuccess} />}
        {tab === "ai" && <AIChat />}
      </main>
    </div>
  );
}