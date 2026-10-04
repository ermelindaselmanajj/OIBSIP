import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";

function Register() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => navigate("/login"), 3000);
    return () => clearTimeout(timer);
  }, [successMessage, navigate]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setLoading(true);
    setSuccessMessage("");
    setErrorMessage("");

    try {
      const response = await api.post("/auth/register", formData);

      setSuccessMessage(response.data.message || "Account created successfully.");
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Registration failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🍕</div>

        <h1>Create Account</h1>

        <p className="auth-subtitle">
          Join Pizza Delivery and build your perfect pizza.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            type="text"
            name="name"
            placeholder="Full name"
            value={formData.name}
            onChange={handleChange}
            required
          />

          <input
            type="email"
            name="email"
            placeholder="Email address"
            value={formData.email}
            onChange={handleChange}
            required
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleChange}
            required
          />

          <button
            className="auth-button"
            type="submit"
            disabled={loading || Boolean(successMessage)}
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        {errorMessage && (
          <div className="auth-message error-message" role="alert">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="success-popup" role="status">
            <div className="success-icon">✓</div>

            <h3>Registration Successful!</h3>

            <p>{successMessage}</p>

            <p>
              Please check your email and verify your account.
            </p>

            <p className="success-note">
              Redirecting you to login...
            </p>
          </div>
        )}

        <div className="auth-links">
          <p>
            Already have an account? <Link to="/login">Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;