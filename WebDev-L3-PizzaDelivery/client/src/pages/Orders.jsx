import { useState } from "react";
import { Link } from "react-router-dom";
import api, { adminApi } from "../services/api";
import useOrderPolling from "../components/orders/useOrderPolling";
import { parseOrder, formatMoney } from "../components/orders/orderHelpers";
import { parseOrderList, paymentLabel, stageLabels } from "../components/orders/tracking";
import "../styles/orders.css";

const parseList = (data) => parseOrderList(data, parseOrder);

export default function Orders({ admin = false }) {
  const [filters, setFilters] = useState({ paymentStatus: "all", fulfillmentStatus: "all", page: 1 });
  const endpoint = `${admin ? "/admin/orders" : "/orders"}?${new URLSearchParams({ ...filters, limit: 20 })}`;
  const result = useOrderPolling(admin ? adminApi : api, endpoint, parseList);
  const orders = result.data?.orders || [];
  const pagination = result.data?.pagination;
  const changeFilter = (event) => setFilters((previous) => ({ ...previous, [event.target.name]: event.target.value, page: 1 }));

  return (
    <main className="ot-page">
      <div className="ot-shell">
        <header className="ot-header">
          <Link to={admin ? "/admin/dashboard" : "/dashboard"}>← {admin ? "Inventory" : "Menu"}</Link>
          <span>Pizza Delivery {admin && <small>ADMIN</small>}</span>
        </header>
        <div className="ot-title">
          <div>
            <p className="ot-eyebrow">{admin ? "THE KITCHEN WORKSPACE" : "MADE FOR YOU"}</p>
            <h1>{admin ? "Manage orders" : "My Orders"}</h1>
            <p>{admin ? "Review payment and move each pizza through the kitchen." : "Your saved pizzas and their latest delivery progress."}</p>
          </div>
          <button className="ot-button" onClick={result.refresh}>Refresh orders</button>
        </div>
        <div className="ot-filters">
          <label>
            Payment
            <select name="paymentStatus" value={filters.paymentStatus} onChange={changeFilter}>
              <option value="all">All payments</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="review_required">Needs review</option>
            </select>
          </label>
          <label>
            Progress
            <select name="fulfillmentStatus" value={filters.fulfillmentStatus} onChange={changeFilter}>
              <option value="all">All stages</option>
              <option value="not_started">Not started</option>
              {Object.entries(stageLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <p className="ot-live">Updates every 5 seconds while this tab is visible.{result.refreshedAt && <span> Last checked {result.refreshedAt.toLocaleTimeString()}</span>}</p>
        </div>
        {result.loading && <p className="ot-state" role="status">Loading your orders…</p>}
        {result.error && (
          <div className="ot-state ot-error" role="alert">
            <p>{result.error}</p>
            <button className="ot-button" onClick={result.refresh}>Retry</button>
            {result.data && <p>Showing the last successful update.</p>}
          </div>
        )}
        {result.data && !orders.length && (
          <div className="ot-state">
            <h2>No orders found</h2>
            <p>{filters.paymentStatus !== "all" || filters.fulfillmentStatus !== "all"
              ? "Try different filters to see more orders."
              : "Orders will appear here once a pizza selection is saved."}</p>
            {!admin && <Link to="/build-pizza">Build your pizza →</Link>}
          </div>
        )}
        <div className="ot-order-list">
          {orders.map((order) => (
            <article className="ot-order-card" key={order.id}>
              <div>
                <p className="ot-eyebrow">ORDER {order.id.slice(-8)}</p>
                <h2>{order.quantity} {order.quantity === 1 ? "custom pizza" : "custom pizzas"}</h2>
                <p>{new Date(order.createdAt).toLocaleString()}</p>
                {admin && order.customer && <p>{order.customer.name} · {order.customer.email}</p>}
              </div>
              <div className="ot-order-meta">
                <strong>{formatMoney(order.totalMinor, order.currency)}</strong>
                <span className={`ot-badge ${order.paymentStatus === "paid" ? "ot-paid" : ""}`}>
                  {paymentLabel(order)}
                </span>
                <span>{stageLabels[order.fulfillmentStatus] || "Not started"}</span>
                <Link className="ot-button" to={`${admin ? "/admin/orders" : "/orders"}/${order.id}`}>
                  {admin ? "Manage order" : "View & track"} →
                </Link>
              </div>
            </article>
          ))}
        </div>
        {pagination && (
          <nav className="ot-pagination" aria-label="Order pages">
            <button
              className="ot-button"
              disabled={filters.page <= 1}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page - 1 }))}
            >Previous</button>
            <span>Page {pagination.page} of {Math.max(pagination.pages, 1)} · {pagination.total} orders</span>
            <button
              className="ot-button"
              disabled={filters.page >= pagination.pages}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}
            >Next</button>
          </nav>
        )}
      </div>
    </main>
  );
}
