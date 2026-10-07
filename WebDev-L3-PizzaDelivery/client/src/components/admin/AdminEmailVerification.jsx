import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '../../services/api';
import { verificationProfile, verificationNotice } from './verification';

export default function AdminEmailVerification() {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const active = useRef(false);
  const profileRequest = useRef(null);
  const sendRequest = useRef(null);

  const load = useCallback(async () => {
    if (profileRequest.current || sendRequest.current) return;
    const controller = new AbortController();
    profileRequest.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get('/admin/me', { signal: controller.signal });
      if (active.current && !controller.signal.aborted) {
        const profile = verificationProfile(response.data);
        setAdmin(profile);
        if (profile.isVerified) setNotice(null);
      }
    } catch (failure) {
      if (active.current && !controller.signal.aborted) setError(failure.response?.data?.message || failure.message || 'Could not check your email status. Please try again.');
    } finally {
      if (profileRequest.current === controller) profileRequest.current = null;
      if (active.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) load(); });
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      active.current = false;
      profileRequest.current?.abort();
      sendRequest.current?.abort();
      profileRequest.current = null;
      sendRequest.current = null;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  async function send() {
    if (sendRequest.current || loading || error || !admin || admin.isVerified) return;
    const controller = new AbortController();
    sendRequest.current = controller;
    setSending(true);
    setNotice(null);
    try {
      const response = await adminApi.post('/admin/request-email-verification', undefined, { signal: controller.signal });
      if (!active.current || controller.signal.aborted) return;
      const result = verificationNotice(response.data);
      setNotice({ ...result, success: true });
      if (result.isVerified) setAdmin(previous => ({ ...previous, isVerified: true }));
    } catch (failure) {
      if (active.current && !controller.signal.aborted) setNotice({ success: false, text: failure.response?.data?.message || failure.message || 'Verification email could not be sent. Please try again.' });
    } finally {
      if (sendRequest.current === controller) sendRequest.current = null;
      if (active.current && !controller.signal.aborted) setSending(false);
    }
  }

  return (
    <section className="inv-email-panel" aria-labelledby="admin-email-heading">
      <div>
        <p className="inv-eyebrow">EMAIL ALERTS</p>
        <h2 id="admin-email-heading">Keep your kitchen informed</h2>
        {loading && !admin ? <p role="status">Checking your email status…</p> : admin && (
          <>
            <p className="inv-email-address">{admin.email} <span className={`inv-status inv-status-${admin.isVerified ? 'available' : 'low-stock'}`}>{admin.isVerified ? 'Verified' : 'Verification needed'}</span></p>
            <p>{admin.isVerified ? 'This address can receive automatic low-stock alerts.' : 'Verify this address to receive low-stock alerts. The email link expires in 30 minutes.'}</p>
          </>
        )}
        {error && <p className="inv-notice inv-notice-error" role="alert">{error}</p>}
        {notice && <p className={`inv-notice inv-notice-${notice.success ? 'success' : 'error'}`} role={notice.success ? 'status' : 'alert'}>{notice.text}</p>}
      </div>
      <div className="inv-email-actions">
        {admin && !admin.isVerified && <button className="inv-button inv-button-primary" disabled={loading || sending || Boolean(error)} onClick={send}>{sending ? 'Sending…' : 'Send verification email'}</button>}
        <button className="inv-button" disabled={loading || sending} onClick={load}>{loading ? 'Checking…' : error ? 'Retry email status' : 'Refresh email status'}</button>
      </div>
    </section>
  );
}
