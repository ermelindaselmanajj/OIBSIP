import { useNavigate } from "react-router-dom";

function Dashboard() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h2>🍕 Pizza Delivery</h2>

        <button className="logout-button" onClick={handleLogout}>
          Logout
        </button>
      </div>

      <div className="dashboard-content">
        <h1>Welcome to your dashboard</h1>
        <p>
          Your pizza menu and custom pizza builder will appear here.
        </p>
      </div>
    </div>
  );
}

export default Dashboard;