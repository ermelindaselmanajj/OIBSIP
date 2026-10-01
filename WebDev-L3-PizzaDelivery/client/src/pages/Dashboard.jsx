import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

function Dashboard() {
  const [pizzas, setPizzas] = useState([]);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    const fetchPizzas = async () => {
      try {
        const response = await api.get("/pizzas");
        setPizzas(response.data);
      } catch (error) {
        console.error("Failed to load pizzas:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPizzas();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h2>🍕 Pizza Delivery</h2>
          <span className="dashboard-tagline">Fresh pizza, your way.</span>
        </div>

        <div className="dashboard-actions">
          <button
            className="builder-button"
            onClick={() => navigate("/build-pizza")}
          >
            Build Your Pizza
          </button>

          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="dashboard-content">
        <section className="hero-section">
          <div>
            <p className="hero-small">WELCOME TO PIZZA DELIVERY</p>

            <h1>
              Delicious pizza,
              <br />
              made for you.
            </h1>

            <p>
              Choose one of our favorites or create your own pizza exactly the
              way you like it.
            </p>

            <button
              className="hero-button"
              onClick={() => navigate("/build-pizza")}
            >
              Create Your Pizza →
            </button>
          </div>

          <div className="hero-pizza">🍕</div>
        </section>

        <section className="pizza-section">
          <div className="section-heading">
            <p className="section-small">OUR MENU</p>
            <h2>Popular Pizzas</h2>
          </div>

          {loading ? (
            <p>Loading pizzas...</p>
          ) : (
            <div className="pizza-grid">
              {pizzas.map((pizza) => (
                <div className="pizza-card" key={pizza._id}>
                  <img
                    src={pizza.image}
                    alt={pizza.name}
                    className="pizza-image"
                  />

                  <div className="pizza-card-content">
                    <span className="pizza-category">{pizza.category}</span>

                    <h3>{pizza.name}</h3>

                    <p>{pizza.description}</p>

                    <div className="pizza-card-footer">
                      <strong>€{Number(pizza.price).toFixed(2)}</strong>

                      <button onClick={() => navigate("/build-pizza")}>
                        Customize
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default Dashboard;
