const keys = { user: "token", admin: "adminToken" };
const sessionEvent = "pizza-session-change";

export const getToken = (role = "user") => localStorage.getItem(keys[role]);

export function setToken(role, token) {
  localStorage.setItem(keys[role], token);
  window.dispatchEvent(new Event(sessionEvent));
}

export function clearToken(role, expectedToken = getToken(role)) {
  if (getToken(role) !== expectedToken) return false;
  localStorage.removeItem(keys[role]);
  window.dispatchEvent(new Event(sessionEvent));
  return true;
}

export function subscribeSession(callback) {
  window.addEventListener(sessionEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(sessionEvent, callback);
    window.removeEventListener("storage", callback);
  };
}
