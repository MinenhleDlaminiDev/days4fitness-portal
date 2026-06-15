import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  timeout: 10000
});

function responseData(response) {
  return response.data?.data;
}

export function getApiErrorMessage(error, fallback) {
  return error?.response?.data?.error?.message || error?.message || fallback;
}

export async function fetchClients() {
  const response = await api.get("/clients");
  return responseData(response);
}

export async function fetchClientById(clientId) {
  const response = await api.get(`/clients/${clientId}`);
  return responseData(response);
}

export async function createClient(payload) {
  const response = await api.post("/clients", payload);
  return responseData(response);
}

export async function updateClientPreferences(clientId, payload) {
  const response = await api.patch(`/clients/${clientId}/preferences`, payload);
  return responseData(response);
}

export async function fetchPendingBookingRequests() {
  const response = await api.get("/booking-requests/pending");
  return responseData(response);
}

export async function approveBookingRequest(requestId) {
  const response = await api.post(`/booking-requests/${requestId}/approve`);
  return responseData(response);
}

export async function rejectBookingRequest(requestId) {
  const response = await api.post(`/booking-requests/${requestId}/reject`);
  return responseData(response);
}

export async function fetchConfiguration() {
  const response = await api.get("/configuration");
  return responseData(response);
}
