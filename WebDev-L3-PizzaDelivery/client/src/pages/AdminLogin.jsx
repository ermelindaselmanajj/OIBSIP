import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { adminApi } from "../services/api";
import { setToken } from "../services/session";

export default function AdminLogin() {
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(location.state?.message || "");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const { data } = await adminApi.post("/admin/login", { email, password });
      if (!data.token || data.admin?.role !== "admin") throw new Error("Invalid admin login response");
      setToken("admin", data.token);
      navigate("/admin/dashboard");
    } catch (error) {
      setMessage(error.response?.data?.message || "Admin login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🍕</div>
        <h1>Admin Login</h1>
        <p className="auth-subtitle">Sign in with your administrator account.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <input type="email" aria-label="Admin email" autoComplete="username" placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <input type="password" aria-label="Admin password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="auth-button" type="submit" disabled={loading}>{loading ? "Signing in..." : "Admin Login"}</button>
        </form>
        {message && <div className="auth-message error-message" role="alert">{message}</div>}
        <div className="auth-links"><Link to="/login">Customer login</Link></div>
      </div>
    </div>
  );
}
