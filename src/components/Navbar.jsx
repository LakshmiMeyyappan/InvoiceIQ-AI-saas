export default function Navbar({ setTab }) {
  return (
    <div className="bg-blue-600 text-white p-4 flex gap-6">
      <button onClick={() => setTab("dashboard")}>Dashboard</button>
      <button onClick={() => setTab("upload")}>Upload</button>
      <button onClick={() => setTab("chat")}>AI Chat</button>
      <button onClick={() => setTab("analytics")}>Analytics</button>
    </div>
  );
}