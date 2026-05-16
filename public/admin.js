// Admin Dashboard JavaScript (API from api-config.js)

// Session token stored in sessionStorage (clears when browser closes)
let token = sessionStorage.getItem("admin_token") || null;
let adminInfo = null;

// Toast notification
function showToast(msg, type = "success") {
    const c = document.getElementById("toastContainer");
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// API helper with Authorization header
async function apiCall(url, method = "GET", body = null) {
    const opts = {
        method,
        headers: { "Content-Type": "application/json" }
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "خطأ في الخادم");
    return data;
}

// ===== AUTH =====
function showAuth() {
    document.getElementById("authPage").style.display = "flex";
    document.getElementById("adminDashboard").style.display = "none";
}

function showDashboard() {
    document.getElementById("authPage").style.display = "none";
    document.getElementById("adminDashboard").style.display = "flex";
    document.getElementById("adminName").textContent = adminInfo?.full_name || "";
    document.getElementById("welcomeName").textContent = adminInfo?.full_name || "مدير المحطة";
    loadStations();
    setTimeout(initPickMap, 300);
}

function showAuthError(msg) {
    const el = document.getElementById("authError");
    el.textContent = msg;
    el.classList.add("show");
}

// Login
document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("authError").classList.remove("show");
    try {
        const data = await apiCall(`${API}/api/auth/login`, "POST", {
            username: document.getElementById("loginUsername").value.trim(),
            password: document.getElementById("loginPassword").value
        });

        // Save token
        token = data.token;
        sessionStorage.setItem("admin_token", token);

        // If super admin, redirect to super admin panel
        if (data.admin.role === "super_admin") {
            window.location.href = "superadmin.html";
            return;
        }

        // Station manager
        adminInfo = data.admin;
        showToast("تم تسجيل الدخول بنجاح");
        showDashboard();
    } catch (err) {
        showAuthError(err.message);
    }
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await apiCall(`${API}/api/auth/logout`, "POST"); } catch {}
    token = null;
    adminInfo = null;
    sessionStorage.removeItem("admin_token");
    showAuth();
    showToast("تم تسجيل الخروج");
});

// ===== NAVIGATION =====
document.querySelectorAll(".nav-item[data-section]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item[data-section]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
        document.getElementById(btn.dataset.section + "Section").classList.add("active");
        if (btn.dataset.section === "add-station") setTimeout(initPickMap, 300);
    });
});

document.getElementById("addStationTopBtn").addEventListener("click", () => {
    document.querySelectorAll(".nav-item[data-section]").forEach(b => b.classList.remove("active"));
    document.querySelector('[data-section="add-station"]').classList.add("active");
    document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
    document.getElementById("addStationSection").classList.add("active");
    setTimeout(initPickMap, 300);
});

// ===== STATIONS =====
let myStations = [];
let pickMap = null;
let pickMarker = null;

async function loadStations() {
    try {
        myStations = await apiCall(`${API}/api/admin/stations`);
        renderStats();
        renderStationCards("quickStationsGrid");
        renderStationCards("allStationsGrid");
    } catch (err) {
        if (err.message.includes("مصرح")) { showAuth(); return; }
        showToast(err.message, "error");
    }
}

function renderStats() {
    const total = myStations.length;
    const active = myStations.filter(s => s.is_active).length;
    document.getElementById("myTotalStations").textContent = total;
    document.getElementById("myActiveStations").textContent = active;
    document.getElementById("myInactiveStations").textContent = total - active;
}

function fuelLabel(type) {
    return { benzine: "بنزين", diesel: "ديزل", both: "بنزين + ديزل" }[type] || "بنزين";
}

function timeAgo(dateStr) {
    if (!dateStr) return "لم يتم التحديث";
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "الآن";
    if (min < 60) return `منذ ${min} دقيقة`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `منذ ${hrs} ساعة`;
    return `منذ ${Math.floor(hrs / 24)} يوم`;
}

function renderStationCards(containerId) {
    const grid = document.getElementById(containerId);
    if (myStations.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">⛽</div><h4>لا توجد محطات مسجلة</h4><p>قم بإضافة محطة الوقود الخاصة بك</p></div>`;
        return;
    }
    grid.innerHTML = myStations.map(s => `
        <div class="admin-station-card">
            <div class="admin-station-card-header">
                <h4>${escapeHtml(s.name)}</h4>
                <span class="status-badge ${s.is_active ? "active" : "inactive"}">${s.is_active ? "نشطة" : "متوقفة"}</span>
            </div>
            <div class="station-details">
                <div class="station-detail"><span class="icon">📍</span> ${escapeHtml(s.city)}${s.address ? " - " + escapeHtml(s.address) : ""}</div>
                <div class="station-detail"><span class="icon">🕐</span> ${timeAgo(s.last_status_update)}</div>
            </div>
            <div class="form-group" style="margin:12px 0 16px;">
                <label style="font-size:12px;margin-bottom:4px;">⛽ نوع الوقود المتوفر</label>
                <select onchange="changeFuelType(${s.id}, this.value)" style="padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:'Cairo',sans-serif;font-size:13px;font-weight:600;width:100%;cursor:pointer;">
                    <option value="benzine" ${s.fuel_type === "benzine" ? "selected" : ""}>بنزين فقط</option>
                    <option value="diesel" ${s.fuel_type === "diesel" ? "selected" : ""}>ديزل فقط</option>
                    <option value="both" ${s.fuel_type === "both" ? "selected" : ""}>بنزين + ديزل</option>
                </select>
            </div>
            <div class="station-actions">
                <button class="toggle-btn ${s.is_active ? "deactivate" : "activate"}" onclick="toggleStation(${s.id})">
                    ${s.is_active ? "إيقاف - الوقود نفذ" : "تفعيل - الوقود متوفر"}
                </button>
                <button class="btn-icon" onclick="deleteStation(${s.id})" title="حذف" style="color:var(--danger);flex-shrink:0;">🗑️</button>
            </div>
        </div>
    `).join("");
}

async function changeFuelType(id, fuelType) {
    try {
        const data = await apiCall(`${API}/api/admin/stations/${id}/fuel`, "PATCH", { fuel_type: fuelType });
        showToast(data.message);
    } catch (err) { showToast(err.message, "error"); loadStations(); }
}

async function toggleStation(id) {
    try {
        const data = await apiCall(`${API}/api/admin/stations/${id}/toggle`, "PATCH");
        showToast(data.message);
        loadStations();
    } catch (err) { showToast(err.message, "error"); }
}

async function deleteStation(id) {
    if (!confirm("هل أنت متأكد من حذف هذه المحطة؟")) return;
    try {
        const data = await apiCall(`${API}/api/admin/stations/${id}`, "DELETE");
        showToast(data.message);
        loadStations();
    } catch (err) { showToast(err.message, "error"); }
}

// ===== ADD STATION =====
function initPickMap() {
    const el = document.getElementById("pickMap");
    if (!el || el.offsetHeight === 0) return;
    if (pickMap) { pickMap.invalidateSize(); return; }

    if (typeof L !== "undefined" && L.Icon && L.Icon.Default) {
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: "vendor/images/marker-icon-2x.png",
            iconUrl: "vendor/images/marker-icon.png",
            shadowUrl: "vendor/images/marker-shadow.png"
        });
    }

    pickMap = L.map("pickMap").setView([32.9, 13.18], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap", maxZoom: 19
    }).addTo(pickMap);

    pickMap.on("click", (e) => {
        const { lat, lng } = e.latlng;
        document.getElementById("stationLat").value = lat.toFixed(6);
        document.getElementById("stationLng").value = lng.toFixed(6);
        if (pickMarker) pickMap.removeLayer(pickMarker);
        pickMarker = L.marker([lat, lng]).addTo(pickMap);
    });
}

document.getElementById("addStationForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
        const data = await apiCall(`${API}/api/admin/stations`, "POST", {
            name: document.getElementById("stationName").value.trim(),
            city: document.getElementById("stationCity").value.trim(),
            address: document.getElementById("stationAddress").value.trim(),
            latitude: document.getElementById("stationLat").value,
            longitude: document.getElementById("stationLng").value,
            fuel_type: document.getElementById("stationFuelType").value
        });
        showToast(data.message);
        e.target.reset();
        if (pickMarker) { pickMap.removeLayer(pickMarker); pickMarker = null; }
        document.querySelectorAll(".nav-item[data-section]").forEach(b => b.classList.remove("active"));
        document.querySelector('[data-section="stations"]').classList.add("active");
        document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
        document.getElementById("stationsSection").classList.add("active");
        loadStations();
    } catch (err) { showToast(err.message, "error"); }
});

// ===== INIT: verify session on page load =====
document.addEventListener("DOMContentLoaded", async () => {
    if (!token) { showAuth(); return; }
    try {
        const data = await apiCall(`${API}/api/auth/me`);
        adminInfo = data.admin;
        if (adminInfo.role === "super_admin") {
            window.location.href = "superadmin.html";
            return;
        }
        showDashboard();
    } catch {
        token = null;
        sessionStorage.removeItem("admin_token");
        showAuth();
    }
});
