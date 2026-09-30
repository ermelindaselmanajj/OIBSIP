import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const { token } = useParams();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const response = await api.post(
        `/auth/reset-password/${token}`,
        { password }
      );

      setMessage(response.data.message);

      setTimeout(() => {
        navigate("/login");
      }, 1500);
    } catch (error) {
      setMessage(error.response?.data?.message || "Password reset failed");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🔑</div>

        <h1>Reset Password</h1>

        <p className="auth-subtitle">
          Enter your new password below.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button className="auth-button" type="submit">
            Reset Password
          </button>
        </form>

        {message && <div className="auth-message">{message}</div>}
      </div>
    </div>
  );
}

export default ResetPassword;