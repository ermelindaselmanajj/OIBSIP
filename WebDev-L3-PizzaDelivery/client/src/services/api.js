import { createSessionApi } from "./createSessionApi.js";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
const api = createSessionApi("user", baseURL);
export const adminApi = createSessionApi("admin", baseURL);
export default api;
