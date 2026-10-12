import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const pending = useRef(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setSuccess(false);
    setMessage("");

    try {
      const response = await api.post("/auth/forgot-password", {
        email,
      });

      setMessage(response.data.message);
      setSuccess(true);
    } catch (error) {
      setMessage(error.response?.data?.message || "Something went wrong");
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🔐</div>

        <h1>Forgot Password?</h1>

        <p className="auth-subtitle">
          Enter your email and we'll send you a reset link.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <button className="auth-button" type="submit" disabled={loading}>
            {loading ? "Sending reset link..." : "Send Reset Link"}
          </button>
        </form>

        {message && <div className={`auth-message${success ? "" : " error-message"}`} role={success ? "status" : "alert"}>{message}</div>}

        <div className="auth-links">
          <p>
            <Link to="/login">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
