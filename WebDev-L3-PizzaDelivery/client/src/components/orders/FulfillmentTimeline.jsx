import { fulfillmentStages, stageLabels } from "./tracking";
export default function FulfillmentTimeline({ order }) {
  const current = fulfillmentStages.indexOf(order.fulfillmentStatus);
  return (
    <section className="ot-tracking" aria-label="Delivery progress">
      <h2>Your pizza's journey</h2>
      {order.confirmedAt && <p>Order confirmed {new Date(order.confirmedAt).toLocaleString()}.</p>}
      {order.paymentStatus === "paid" && order.status !== "confirmed" && <p>Payment received. Awaiting order confirmation.</p>}
      {order.paymentStatus !== "paid" && <p>Tracking starts after payment is confirmed.</p>}
      <ol className="ot-timeline">
        {fulfillmentStages.map((status, index) => {
          const event = order.fulfillmentHistory.find((item) => item.status === status);
          return <li key={status} className={index <= current ? "ot-complete" : ""} aria-current={index === current ? "step" : undefined}>
            <span className="ot-step-mark" aria-hidden="true">{index <= current ? "✓" : index + 1}</span>
            <div><strong>{stageLabels[status]}</strong><p>{event ? new Date(event.at).toLocaleString() : "Waiting"}</p></div>
          </li>;
        })}
      </ol>
    </section>
  );
}
