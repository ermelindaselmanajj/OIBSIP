import { useState } from 'react';
import { inventoryUpdate, stockStatus } from './helpers';
const labels = { available: 'Available', 'low-stock': 'Low stock', 'out-of-stock': 'Out of stock' };
export default function InventoryCard({ item, onSave, onDirty, refreshBusy }) {
  const [draft, setDraft] = useState({ stock: String(item.stock), threshold: String(item.threshold) });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const dirty = draft.stock !== String(item.stock) || draft.threshold !== String(item.threshold);
  const status = stockStatus(item.stock, item.threshold);
  function edit(field, value) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setNotice(null);
    onDirty(item.id, next.stock !== String(item.stock) || next.threshold !== String(item.threshold));
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    try {
      const changes = inventoryUpdate(item, draft);
      setBusy(true);
      setNotice(null);
      const updated = await onSave(item.id, changes);
      setDraft({ stock: String(updated.stock), threshold: String(updated.threshold) });
      onDirty(item.id, false);
      setNotice({ type: 'success', text: 'Changes saved.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Could not save. Please try again.' });
    } finally { setBusy(false); }
  }
  return (
    <form className="inv-card" onSubmit={save}>
      <div className="inv-card-heading">
        <h3>{item.name}</h3>
        <span className={`inv-status inv-status-${status}`}>{labels[status]}</span>
      </div>
      <p className="inv-stock"><strong>{item.stock}</strong> units on hand</p>
      <div className="inv-fields">
        <label htmlFor={`stock-${item.id}`}>
          Stock quantity
          <input
            id={`stock-${item.id}`}
            type="number" min="0" step="1" required
            value={draft.stock}
            onChange={event => edit('stock', event.target.value)}
            disabled={busy || refreshBusy}
          />
        </label>
        <label htmlFor={`threshold-${item.id}`}>
          Low-stock threshold
          <input
            id={`threshold-${item.id}`}
            type="number" min="0" step="1" required
            value={draft.threshold}
            onChange={event => edit('threshold', event.target.value)}
            disabled={busy || refreshBusy}
          />
        </label>
      </div>
      <p className="inv-field-note">Low stock at {item.threshold} units or fewer.</p>
      <div className="inv-card-footer">
        <span>{dirty ? 'Unsaved changes' : 'Up to date'}</span>
        <button
          className="inv-button inv-button-primary"
          type="submit"
          disabled={!dirty || busy || refreshBusy}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {notice && (
        <p
          className={`inv-notice inv-notice-${notice.type}`}
          role={notice.type === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
    </form>
  );
}
