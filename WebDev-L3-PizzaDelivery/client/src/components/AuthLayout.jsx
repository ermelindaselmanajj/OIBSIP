import hero from "../assets/pizza-builder/bases/italian.jpg";

export default function AuthLayout({ children }) {
  return (
    <main className="auth-page">
      <aside className="auth-story" aria-label="Pizza Delivery">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">PD</span> Pizza Delivery</div>
        <div className="auth-story-copy">
          <p className="hero-small">GOOD FOOD. YOUR WAY.</p>
          <h2>A little slice<br /> of happiness.</h2>
          <p>Your favorite flavors, brought together.<br />Let’s make something delicious.</p>
        </div>
        <img className="auth-story-image" src={hero} alt="Freshly baked pizza with colorful toppings" />
        <p className="auth-story-footer">Pick your favorites. Make it yours.</p>
      </aside>
      <div className="auth-form-panel">{children}</div>
    </main>
  );
}
