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

export async function fetchClients(params = {}) {
  const response = await api.get("/clients", { params });
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

export async function updateClient(clientId, payload) {
  const response = await api.patch(`/clients/${clientId}`, payload);
  return responseData(response);
}

export async function archiveClient(clientId) {
  const response = await api.post(`/clients/${clientId}/archive`);
  return responseData(response);
}

export async function restoreClient(clientId) {
  const response = await api.post(`/clients/${clientId}/restore`);
  return responseData(response);
}

export async function fetchClientPackages(clientId) {
  const response = await api.get(`/clients/${clientId}/packages`);
  return responseData(response);
}

export async function createClientPackage(clientId, payload) {
  const response = await api.post(`/clients/${clientId}/packages`, payload);
  return responseData(response);
}

export async function addPackagePayment(packageId, payload) {
  const response = await api.post(`/packages/${packageId}/payments`, payload);
  return responseData(response);
}

export async function reversePackagePayment(paymentId, payload) {
  const response = await api.post(`/packages/payments/${paymentId}/reverse`, payload);
  return responseData(response);
}

export async function fetchClientSessions(clientId) {
  const response = await api.get(`/clients/${clientId}/sessions`);
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

export async function fetchDashboard() {
  const response = await api.get("/dashboard");
  return responseData(response);
}

export async function fetchTodaySessions() {
  const response = await api.get("/dashboard/today-sessions");
  return responseData(response);
}

export async function fetchScheduleWeek(weekStart) {
  const response = await api.get("/sessions", { params: { weekStart } });
  return responseData(response);
}

export async function fetchSession(sessionId) {
  const response = await api.get(`/sessions/${sessionId}`);
  return responseData(response);
}

export async function createManualSession(payload) {
  const response = await api.post("/sessions", payload);
  return responseData(response);
}

export async function rescheduleSession(sessionId, payload) {
  const response = await api.post(`/sessions/${sessionId}/reschedule`, payload);
  return responseData(response);
}

export async function cancelSession(sessionId) {
  const response = await api.post(`/sessions/${sessionId}/cancel`);
  return responseData(response);
}

export async function createReplacementSession(sessionId, payload) {
  const response = await api.post(`/sessions/${sessionId}/replacement`, payload);
  return responseData(response);
}

export async function completeSession(sessionId, clientId) {
  const response = await api.post(`/sessions/${sessionId}/complete`, {
    ...(clientId ? { clientId } : {})
  });
  return responseData(response);
}

export async function markSessionNoShow(sessionId, clientId) {
  const response = await api.post(`/sessions/${sessionId}/no-show`, {
    ...(clientId ? { clientId } : {})
  });
  return responseData(response);
}
