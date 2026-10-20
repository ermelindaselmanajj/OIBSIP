import AuthLayout from "../components/AuthLayout";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const pending = useRef(false);

  const { token } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => navigate("/login"), 1500);
    return () => clearTimeout(timer);
  }, [success, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pending.current || success) return;
    pending.current = true;
    setLoading(true);
    setMessage("");

    try {
      const response = await api.post(
        `/auth/reset-password/${token}`,
        { password }
      );

      setMessage(response.data.message);
      setSuccess(true);
    } catch (error) {
      setMessage(error.response?.data?.message || "Password reset failed");
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card">
        <div className="auth-logo">🔑</div>

        <h1>Reset Password</h1>

        <p className="auth-subtitle">
          Enter your new password below.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            type="password"
            aria-label="New password" autoComplete="new-password" placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button className="auth-button" type="submit" disabled={loading || success}>
            {loading ? "Resetting password..." : "Reset Password"}
          </button>
        </form>

        {message && <div className={`auth-message${success ? "" : " error-message"}`} role={success ? "status" : "alert"}>{message}</div>}
      </div>
    </AuthLayout>
  );
}

export default ResetPassword;
