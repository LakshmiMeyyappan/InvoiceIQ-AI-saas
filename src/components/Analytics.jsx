import { useEffect, useState } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";

/*const API = "http://127.0.0.1:8000";

const API = "http://13.233.116.154:8501";*/

const API = import.meta.env.VITE_API_URL;

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

const ChartCard = ({ title, children }) => (
  <div className="card" style={{ height: "100%" }}>
    <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>{title}</h3>
    {children}
  </div>
);

const CustomTooltipStyle = {
  contentStyle: {
    background: "#1e2130",
    border: "1px solid #2a2d3e",
    borderRadius: 8,
    color: "#e8eaf0",
    fontSize: 12,
  },
  labelStyle: { color: "#8b90a7" },
};

export default function Analytics({ refreshTrigger }) {
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    Promise.all([axios.get(`${API}/invoices/`), axios.get(`${API}/stats/`)]).then(([inv, st]) => {
      setData(inv.data);
      setStats(st.data);
    });
  }, [refreshTrigger]);

  const statusData = stats
    ? [
      { name: "Approved", value: stats.approved, color: "#10b981" },
      { name: "On Hold", value: stats.held, color: "#ef4444" },
      { name: "Pending", value: stats.pending, color: "#f59e0b" },
    ].filter(d => d.value > 0)
    : [];

  const vendorData = data.reduce((acc, inv) => {
    const v = inv["Vendor Name"] || "Unknown";
    const existing = acc.find(a => a.vendor === v);
    const amount = inv["Total Amount (INR)"] || 0;
    if (existing) { existing.amount += amount; existing.count += 1; }
    else acc.push({ vendor: v, amount, count: 1 });
    return acc;
  }, []);

  const chargesData = data.map(inv => ({
    name: inv["Invoice Number"],
    GST: inv["GST"] || 0,
    Shipping: inv["Shipping"] || 0,
    Handling: inv["Handling"] || 0,
  }));

  const timelineData = [...data]
    .sort((a, b) => (a["Invoice Number"] > b["Invoice Number"] ? 1 : -1))
    .map((inv, i) => ({
      label: inv["Invoice Number"],
      amount: inv["Total Amount (INR)"] || 0,
      index: i + 1,
    }));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">Visual breakdown of your invoice data</p>
      </div>

      {data.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📈</div>
            <div className="empty-state-title">No data to display</div>
            <div className="empty-state-sub">Upload invoices to see analytics</div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, width: "100%" }}>

          {/* Status Breakdown Pie */}
          <ChartCard title="📊 Invoice Status Breakdown">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip {...CustomTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#8b90a7" }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Vendor vs Amount Bar */}
          <ChartCard title="🏢 Vendor-wise Invoice Amount (₹)">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={vendorData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
                <XAxis dataKey="vendor" tick={{ fill: "#8b90a7", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8b90a7", fontSize: 11 }} />
                <Tooltip {...CustomTooltipStyle} formatter={v => `₹${Number(v).toLocaleString("en-IN")}`} />
                <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} name="Amount (₹)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* GST / Shipping / Handling */}
          <ChartCard title="💸 Charges Breakdown per Invoice">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chargesData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
                <XAxis dataKey="name" tick={{ fill: "#8b90a7", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8b90a7", fontSize: 11 }} />
                <Tooltip {...CustomTooltipStyle} formatter={v => `₹${Number(v).toLocaleString("en-IN")}`} />
                <Bar dataKey="GST" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Shipping" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Handling" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#8b90a7" }} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Amount trend line */}
          <ChartCard title="📉 Invoice Amount Trend">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timelineData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
                <XAxis dataKey="label" tick={{ fill: "#8b90a7", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8b90a7", fontSize: 11 }} />
                <Tooltip {...CustomTooltipStyle} formatter={v => `₹${Number(v).toLocaleString("en-IN")}`} />
                <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} dot={{ r: 4, fill: "#10b981" }} name="Amount (₹)" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

        </div>
      )}
    </div>
  );
}