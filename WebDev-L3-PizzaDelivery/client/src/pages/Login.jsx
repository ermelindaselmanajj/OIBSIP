import { useState } from "react";
import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import api from "../services/api";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const verified = searchParams.get("verified");

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const response = await api.post("/auth/login", {
        email,
        password,
      });

      localStorage.setItem("token", response.data.token);

      navigate("/dashboard");
    } catch (error) {
      setMessage(
        error.response?.data?.message || "Login failed"
      );
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🍕</div>

        <h1>Welcome Back</h1>

        <p className="auth-subtitle">
          Sign in to continue ordering your favorite pizza.
        </p>

        {verified === "true" && (
          <div className="success-popup">
            <div className="success-icon">✓</div>

            <h3>Email Verified!</h3>

            <p>
              Your email has been verified successfully.
            </p>

            <p>
              You can now log in to your account.
            </p>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button
            className="auth-button"
            type="submit"
          >
            Login
          </button>
        </form>

        {message && (
          <div className="auth-message">
            {message}
          </div>
        )}

        <div className="auth-links">
          <p>
            <Link to="/forgot-password">
              Forgot password?
            </Link>
          </p>

          <p>
            Don't have an account?{" "}
            <Link to="/register">
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;