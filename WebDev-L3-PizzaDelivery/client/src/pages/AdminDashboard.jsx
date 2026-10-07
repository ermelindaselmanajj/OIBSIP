import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearToken } from '../services/session';
import { adminApi } from '../services/api';
import InventoryCard from '../components/inventory/InventoryCard';
import AdminEmailVerification from '../components/admin/AdminEmailVerification';
import { groupInventory, inventorySnapshot, replaceInventoryItem, validateInventoryItems } from '../components/inventory/helpers';
import '../styles/inventory.css';
import '../styles/orders.css';
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [saving, setSaving] = useState(0);
  const [refreshed, setRefreshed] = useState(null);
  // Ignore a late response after navigation or a newer inventory request.
  const generation = useRef(0);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get('/admin/inventory');
      if (!mounted.current || current !== generation.current) return;
      setItems(validateInventoryItems(response.data?.items));
      setLoaded(true);
      setRefreshed(new Date());
    } catch (failure) {
      if (mounted.current && current === generation.current) setError(failure.response?.data?.message || failure.message || 'Inventory could not be loaded. Please try again.');
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.resolve().then(() => { if (active) load(); });
    return () => { active = false; mounted.current = false; generation.current += 1; };
  }, [load]);
  function markDirty(id, dirty) {
    setDirtyIds(previous => {
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async function save(id, changes) {
    setSaving(count => count + 1);
    try {
      const response = await adminApi.patch(`/admin/inventory/${id}`, changes);
      validateInventoryItems([response.data?.item]);
      if (response.data.item.id !== id) throw new Error('The server returned a different ingredient. Please refresh and try again.');
      // Separate rows may save together; replace only the row that returned.
      if (mounted.current) setItems(previous => replaceInventoryItem(previous, response.data.item));
      return response.data.item;
    } catch (failure) {
      throw new Error(failure.response?.data?.message || 'Changes could not be saved. Your edits are still here.', { cause: failure });
    } finally {
      if (mounted.current) setSaving(count => count - 1);
    }
  }
  const snapshot = inventorySnapshot(items);
  const groups = groupInventory(items);
  // Refresh can safely replace card drafts only after all edits have been saved.
  const refreshDisabled = loading || saving > 0 || dirtyIds.size > 0;
  function logout() {
    clearToken('admin');
    navigate('/admin/login', { replace: true });
  }

  const refreshNote = dirtyIds.size
    ? 'Save your edits before refreshing.'
    : saving
      ? 'Saving your changes…'
      : refreshed
        ? `Last refreshed ${refreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Live kitchen inventory';

  return (
    <div className="inv-page">
      <header className="inv-topbar">
        <a className="inv-brand" href="#inventory-top">
          <span aria-hidden="true">PD</span> Pizza Delivery <small>ADMIN</small>
        </a>
        <div className="ot-admin-nav"><button className="inv-button" disabled={dirtyIds.size > 0 || saving > 0} title={dirtyIds.size ? "Save inventory edits before opening orders" : "Manage orders"} onClick={() => navigate("/admin/orders")}>Orders</button><button className="inv-button" onClick={logout}>Sign out</button></div>
      </header>
      <main className="inv-main" id="inventory-top">
        <div className="inv-title-row">
          <div>
            <p className="inv-eyebrow">THE KITCHEN WORKSPACE</p>
            <h1>Ingredient inventory</h1>
            <p className="inv-intro">
              A well-stocked kitchen starts here. Review quantities and keep every ingredient ready.
            </p>
          </div>
          <div className="inv-refresh">
            <button className="inv-button" disabled={refreshDisabled} onClick={load}>
              {loading ? 'Refreshing…' : '↻ Refresh inventory'}
            </button>
            <p>{refreshNote}</p>
          </div>
        </div>
        <AdminEmailVerification />
        <section className="inv-metrics" aria-label="Inventory overview">
          <div><p>Total ingredients</p><strong>{loaded ? snapshot.total : '—'}</strong><span>Across the kitchen</span></div>
          <div><p>Low stock</p><strong>{loaded ? snapshot.low : '—'}</strong><span>At or below threshold</span></div>
          <div><p>Out of stock</p><strong>{loaded ? snapshot.out : '—'}</strong><span>Ready for replenishment</span></div>
        </section>
        {error && (
          <div className="inv-state inv-error" role="alert">
            <h2>We couldn’t refresh inventory</h2>
            <p>{error}</p>
            <button className="inv-button" disabled={refreshDisabled} onClick={load}>Try again</button>
          </div>
        )}
        {loading && !loaded && (
          <div className="inv-state" role="status">
            <span className="inv-loading-mark" aria-hidden="true">◌</span>
            <h2>Opening the pantry…</h2>
            <p>Loading ingredient quantities and thresholds.</p>
          </div>
        )}
        {loaded && items.length === 0 && (
          <div className="inv-state">
            <h2>The pantry is empty</h2>
            <p>No ingredients have been added to the inventory yet.</p>
          </div>
        )}
        {loaded && items.length > 0 && (
          <>
            <nav className="inv-category-nav" aria-label="Ingredient categories">
              {groups.map(group => (
                <a key={group.key} href={`#inventory-${group.key}`}>
                  {group.label}<span>{group.items.length}</span>
                </a>
              ))}
            </nav>
            <div className="inv-section-note">
              <span aria-hidden="true">↳</span>
              Quantities are in units. Save each ingredient separately; a refresh never discards your edits.
            </div>
            {groups.map((group, index) => (
              <section
                className="inv-category"
                key={group.key}
                id={`inventory-${group.key}`}
                aria-labelledby={`heading-${group.key}`}
              >
                <div className="inv-category-heading">
                  <div>
                    <p className="inv-eyebrow">{String(index + 1).padStart(2, '0')} / PANTRY</p>
                    <h2 id={`heading-${group.key}`}>{group.label}</h2>
                    <p>{group.note}</p>
                  </div>
                  <span>{group.items.length} ingredients</span>
                </div>
                {group.items.length ? (
                  <div className="inv-grid">
                    {group.items.map(item => (
                      <InventoryCard
                        key={`${item.id}-${refreshed?.getTime()}`}
                        item={item}
                        onSave={save}
                        onDirty={markDirty}
                        refreshBusy={loading}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="inv-empty-category">No ingredients in this category yet.</p>
                )}
              </section>
            ))}
          </>
        )}
        <footer className="inv-footer">
          Pizza Delivery · Kitchen inventory <span>Small details. Better pizza.</span>
        </footer>
      </main>
    </div>
  );
}
