// ===== CONFIG =====
const API = "/api"; // 🔥 dùng relative path

// ===== USER =====
function getUser() {
  try {
    return JSON.parse(sessionStorage.getItem("user"));
  } catch {
    return null;
  }
}

// ===== REQUIRE LOGIN =====
export function requireLogin() {
  const user = getUser();

  if (!user || !user.email) {
    window.location.href = "/login.html";
    return null;
  }

  return user;
}

// ===== REQUIRE ADMIN =====
export function requireAdmin() {
  const user = requireLogin();
  if (!user) return;

  if (user.role !== "admin") {
    alert("Bạn không có quyền truy cập");
    window.location.href = "/";
    return null;
  }

  return user;
}

// ===== CORE REQUEST =====
async function request(path, options = {}) {
  const url = `${API}${path}`;
  const user = getUser();
  const token = sessionStorage.getItem("token");

  try {
    console.log("👉 API CALL:", url);

    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(options.headers || {})
      },
      ...options
    });

    let data = null;

    try {
      data = await res.json();
    } catch {}

    if (!res.ok) {
      throw new Error(data?.message || data?.error || `Lỗi ${res.status}`);
    }

    return data;

  } catch (err) {
    console.error("❌ API ERROR:", err);
    throw err;
  }
}

// ===== HEALTH =====
export function getHealth() {
  return request("/health");
}

// ===== STORES =====
export function getStores() {
  return request("/stores");
}

export function createStore(data) {
  return request("/stores", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function updateStore(code, data) {
  return request(`/stores/${encodeURIComponent(code)}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export function deleteStore(code) {
  return request(`/stores/${encodeURIComponent(code)}`, {
    method: "DELETE"
  });
}

// ===== NHÂN VIÊN =====
export function getEmployees() {
  return request("/nhan-vien");
}

// ===== KHU VỰC =====
export function getRegions() {
  return request("/khu-vuc");
}

export function createRegion(data) {
  return request("/khu-vuc", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function updateRegion(code, data) {
  return request(`/khu-vuc/${code}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export function deleteRegion(code) {
  return request(`/khu-vuc/${code}`, {
    method: "DELETE"
  });
}

// ===== USERS =====
export function getUsers() {
  return request("/users");
}

export function createUser(data) {
  return request("/users", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function updateUser(email, data) {
  return request(`/users/${encodeURIComponent(email)}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export function deleteUser(email) {
  return request(`/users/${encodeURIComponent(email)}`, {
    method: "DELETE"
  });
}

// ===== CA LÀM =====
export function getShifts() {
  return request("/ca-lam");
}

export function createShift(data) {
  return request("/ca-lam", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function updateShift(code, data) {
  return request(`/ca-lam/${encodeURIComponent(code)}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export function deleteShift(code) {
  return request(`/ca-lam/${encodeURIComponent(code)}`, {
    method: "DELETE"
  });
}

// ===== CHẤM CÔNG =====
export function chamCong(data) {
  return request("/cham-cong", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function getChamCong(filters = {}) {
  const query = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.append(key, value);
    }
  });

  return request(`/cham-cong${query.toString() ? `?${query}` : ""}`);
}

// ===== LOGOUT =====
export function logout() {
  sessionStorage.removeItem("user");
  window.location.href = "/login.html";
}