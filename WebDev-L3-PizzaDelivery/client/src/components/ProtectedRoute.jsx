import { useEffect, useState, useSyncExternalStore } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api, { adminApi } from "../services/api";
import { clearToken, getToken, subscribeSession } from "../services/session";

function ProtectedRoute({ children, role = "user" }) {
  const token = useSyncExternalStore(subscribeSession, () => getToken(role));
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const requestKey = JSON.stringify([role, token, location.key, attempt]);
  const loginPath = role === "admin" ? "/admin/login" : "/login";

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let expiryTimer;
    const client = role === "admin" ? adminApi : api;
    const endpoint = role === "admin" ? "/admin/me" : "/auth/me";
    client.get(endpoint, { signal: controller.signal }).then((response) => {
      if (controller.signal.aborted || getToken(role) !== token) return;
      const identity = role === "admin" ? response.data.admin : response.data.user;
      if (identity?.role !== role) {
        clearToken(role, token);
        setResult({ requestKey, status: "invalid" });
        return;
      }
      setResult({ requestKey, status: "verified" });
      // The server verifies the token. Its exp claim only schedules the next check.
      try {
        const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const { exp } = JSON.parse(atob(payload));
        if (Number.isFinite(exp)) {
          expiryTimer = setTimeout(() => {
            if (getToken(role) === token) setAttempt((value) => value + 1);
          }, Math.min(Math.max(exp * 1000 - Date.now(), 1000), 2147483647));
        }
      } catch {
        // A non-JWT response cannot supply a timer; server validation remains authoritative.
      }
    }).catch((error) => {
      if (controller.signal.aborted || getToken(role) !== token) return;
      if (error.response?.status === 401 || error.response?.status === 403) {
        clearToken(role, token);
        setResult({ requestKey, status: "invalid" });
      } else {
        setResult({ requestKey, status: "error" });
      }
    });
    return () => {
      controller.abort();
      clearTimeout(expiryTimer);
    };
  }, [role, token, requestKey]);

  if (!token || (result?.requestKey === requestKey && result.status === "invalid")) {
    return <Navigate to={loginPath} replace state={{ message: `Please sign in with your ${role === "admin" ? "administrator" : "customer"} account to continue. Your session may have expired.` }} />;
  }
  if (result?.requestKey !== requestKey) {
    return <div className="auth-page"><p role="status">Checking your session...</p></div>;
  }
  if (result.status === "error") {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-message error-message" role="alert">
            Unable to verify your session. Please try again.
          </div>
          <button className="auth-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
          <button className="secondary-button" onClick={() => clearToken(role, token)}>Log out</button>
        </div>
      </div>
    );
  }
  return children;
}

export default ProtectedRoute;
