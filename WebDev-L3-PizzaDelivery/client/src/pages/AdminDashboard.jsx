import { useNavigate } from "react-router-dom";
import { clearToken } from "../services/session";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const logout = () => {
    clearToken("admin");
    navigate("/admin/login", { replace: true });
  };
  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div><h2>🍕 Pizza Delivery Admin</h2><span className="dashboard-tagline">Administrator workspace</span></div>
        <button className="logout-button" onClick={logout}>Logout</button>
      </header>
      <main className="dashboard-content">
        <section className="builder-card">
          <h1>Admin Dashboard</h1>
          <p>You are signed in as an administrator.</p>
          <p>Inventory management and order management will be available here in a future update.</p>
        </section>
      </main>
    </div>
  );
}
