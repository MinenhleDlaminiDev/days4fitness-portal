import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  timeout: 10000
});

export async function fetchClients() {
  const response = await api.get("/clients");
  return response.data;
}

export async function fetchClientById(clientId) {
  const response = await api.get(`/clients/${clientId}`);
  return response.data;
}

export async function createClient(payload) {
  const response = await api.post("/clients", payload);
  return response.data;
}

export async function updateClientPreferences(clientId, payload) {
  const response = await api.patch(`/clients/${clientId}/preferences`, payload);
  return response.data;
}
