const configuredOrigin = (name, fallback) => {
  const value = (process.env[name] || fallback).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }
  return url.origin;
};

module.exports = {
  clientUrl: () => configuredOrigin("CLIENT_URL", "http://localhost:5173"),
  serverUrl: () => configuredOrigin("SERVER_URL", `http://localhost:${process.env.PORT || 5001}`),
};
