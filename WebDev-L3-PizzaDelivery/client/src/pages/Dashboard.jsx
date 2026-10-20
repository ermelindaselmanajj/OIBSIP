import hero from "../assets/pizza-builder/bases/italian.jpg";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { parseMenu } from "../services/menu";
import { clearToken } from "../services/session";

function Dashboard() {
  const [pizzas, setPizzas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    const fetchPizzas = async () => {
      try {
        const response = await api.get("/pizzas", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setPizzas(parseMenu(response.data));
      } catch (error) {
        if (controller.signal.aborted) return;
        setErrorMessage(
          error.response?.data?.message ||
            "Unable to load the pizza menu. Please try again."
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchPizzas();
    return () => controller.abort();
  }, [retryCount]);

  const retryMenu = () => {
    setErrorMessage("");
    setLoading(true);
    setRetryCount((count) => count + 1);
  };

  const handleLogout = () => {
    clearToken("user");
    navigate("/login");
  };

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h2 className="brand-lockup"><span className="brand-mark" aria-hidden="true">PD</span> Pizza Delivery</h2>
          <span className="dashboard-tagline">Fresh pizza, your way.</span>
        </div>

        <nav className="dashboard-actions" aria-label="Your account">
          <button className="menu-orders-button" onClick={() => navigate("/orders")}>My Orders</button>
          <button
            className="builder-button"
            onClick={() => navigate("/build-pizza")}
          >
            Build Your Pizza
          </button>

          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <main className="dashboard-content">
        <section className="hero-section">
          <div>
            <p className="hero-small">FRESH IDEAS. FAVORITE FLAVORS.</p>

            <h1>
              Your pizza.
              <br />
              Your way.
            </h1>

            <p>
              Choose one of our favorites or create your own pizza exactly the
              way you like it.
            </p>

            <button
              className="hero-button"
              onClick={() => navigate("/build-pizza")}
            >
              Build Your Pizza →
            </button>
          </div>

          <div className="hero-visual"><div className="hero-orbit" aria-hidden="true" /><img src={hero} alt="Freshly baked pizza with colorful toppings" className="hero-pizza" /></div>
        </section>

        <section className="pizza-section">
          <div className="section-heading">
            <div><h2>Find your next favorite.</h2><p>The classics you love. A combination for every craving.</p></div><a href="#make-it-yours" className="menu-text-link">Feeling creative? →</a>
          </div>

          {loading ? (
            <p role="status">Loading pizzas...</p>
          ) : errorMessage ? (
            <div className="auth-message error-message" role="alert">
              <p>{errorMessage}</p>
              <button className="builder-button" onClick={retryMenu}>
                Retry
              </button>
            </div>
          ) : pizzas.length === 0 ? (
            <p role="status">
              No pizzas are available right now. Please check back later.
            </p>
          ) : (
            <div className="pizza-grid">
              {pizzas.map((pizza) => (
                <article className="pizza-card" key={pizza._id}>
                  <img
                    src={pizza.image}
                    alt={pizza.name}
                    className="pizza-image" loading="lazy" width="600" height="400"
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
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="menu-close" id="make-it-yours">
          <div><h2>Good taste is personal.</h2><p>Choose your base, sauce, cheese, and finishing touches.</p></div>
          <button className="hero-button" onClick={() => navigate("/build-pizza")}>Build Your Pizza →</button>
        </section>
        <footer className="menu-footer"><span>Pizza Delivery</span><span>Fresh pizza, your way.</span></footer>
      </main>
    </div>
  );
}

export default Dashboard;
