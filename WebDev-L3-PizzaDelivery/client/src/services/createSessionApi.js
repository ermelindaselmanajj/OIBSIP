import axios from "axios";
import { clearToken, getToken } from "./session.js";

const publicPaths = new Set([
  "/auth/login", "/auth/register", "/auth/forgot-password", "/admin/login",
]);

export function createSessionApi(role, baseURL) {
  const instance = axios.create({ baseURL });
  instance.interceptors.request.use((config) => {
    const path = config.url?.split("?")[0];
    const isPublic = publicPaths.has(path) || path?.startsWith("/auth/reset-password/");
    config.sessionRole = role;
    config.sessionToken = isPublic ? null : getToken(role);
    config.sessionProtected = !isPublic;
    if (config.sessionToken) {
      config.headers.set("Authorization", `Bearer ${config.sessionToken}`);
    } else {
      config.headers.delete("Authorization");
    }
    return config;
  });
  instance.interceptors.response.use((response) => response, (error) => {
    const config = error.config;
    if (error.response?.status === 401 && config?.sessionProtected && config.sessionToken) {
      clearToken(role, config.sessionToken);
    }
    return Promise.reject(error);
  });
  return instance;
}
