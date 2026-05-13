// Super Admin Dashboard JavaScript
const API = "https://gas-station-kq3v.onrender.com";

let token = sessionStorage.getItem("admin_token") || null;
let superInfo = null;
let managers = [];
let allStations = [];

function showToast(msg, type = "success") {
    const c = document.getElementById("toastContainer");
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

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

function showAuth() {
    document.getElementById("authPage").style.display = "flex";
    document.getElementById("superDashboard").style.display = "none";
}

function showDashboard() {
    document.getElementById("authPage").style.display = "none";
    document.getElementById("superDashboard").style.display = "flex";
    document.getElementById("welcomeName").textContent = superInfo?.full_name || "مدير الموقع";
    loadData();
}

// Login
document.getElementById("superLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("authError").classList.remove("show");
    try {
        const data = await apiCall(`${API}/api/auth/login`, "POST", {
            username: document.getElementById("loginUsername").value.trim(),
            password: document.getElementById("loginPassword").value
        });
        token = data.token;
        sessionStorage.setItem("admin_token", token);

        if (data.admin.role !== "super_admin") {
            window.location.href = "admin.html";
            return;
        }
        superInfo = data.admin;
        showToast("تم تسجيل الدخول بنجاح");
        showDashboard();
    } catch (err) {
        const el = document.getElementById("authError");
        el.textContent = err.message;
        el.classList.add("show");
    }
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await apiCall(`${API}/api/auth/logout`, "POST"); } catch {}
    token = null;
    superInfo = null;
    sessionStorage.removeItem("admin_token");
    showAuth();
    showToast("تم تسجيل الخروج");
});

// Navigation
document.querySelectorAll(".nav-item[data-section]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item[data-section]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
        const map = { "overview": "overviewSection", "managers": "managersSection", "create-manager": "createManagerSection", "all-stations": "allStationsSection" };
        const el = document.getElementById(map[btn.dataset.section]);
        if (el) el.classList.add("active");
    });
});

async function loadData() {
    try {
        managers = await apiCall(`${API}/api/super/managers`);
        allStations = await apiCall(`${API}/api/super/stations`);
        updateStats();
        renderManagers("recentManagers", 5);
        renderManagers("allManagersList");
        renderAllStations();
    } catch (err) {
        if (err.message.includes("مصرح") || err.message.includes("كافية")) { showAuth(); return; }
        showToast(err.message, "error");
    }
}

function updateStats() {
    document.getElementById("totalManagers").textContent = managers.length;
    document.getElementById("totalStations").textContent = allStations.length;
    document.getElementById("activeStations").textContent = allStations.filter(s => s.is_active).length;
}

function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "الآن";
    if (min < 60) return `منذ ${min} دقيقة`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `منذ ${hrs} ساعة`;
    return `منذ ${Math.floor(hrs / 24)} يوم`;
}

function fuelLabel(type) {
    return { benzine: "بنزين", diesel: "ديزل", both: "بنزين + ديزل" }[type] || "بنزين";
}

function renderManagers(containerId, limit) {
    const container = document.getElementById(containerId);
    const list = limit ? managers.slice(0, limit) : managers;
    if (list.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><h4>لا يوجد مديري محطات</h4><p>قم بإنشاء حساب لمدير محطة جديد</p></div>`;
        return;
    }
    container.innerHTML = list.map(m => `
        <div class="admin-station-card" style="margin-bottom:12px;">
            <div class="admin-station-card-header">
                <h4>👤 ${escapeHtml(m.full_name)}</h4>
                <span class="status-badge ${m.active_count > 0 ? 'active' : 'inactive'}">${m.station_count} محطة</span>
            </div>
            <div class="station-details">
                <div class="station-detail"><span class="icon">🔑</span> اسم المستخدم: <strong>${escapeHtml(m.username)}</strong></div>
                <div class="station-detail"><span class="icon">📱</span> ${escapeHtml(m.phone || "بدون رقم هاتف")}</div>
                <div class="station-detail"><span class="icon">⛽</span> ${m.station_count} محطة (${m.active_count || 0} نشطة)</div>
                <div class="station-detail"><span class="icon">📅</span> انضم ${timeAgo(m.created_at)}</div>
            </div>
            <div class="station-actions">
                <button type="button" class="toggle-btn deactivate" data-delete-manager="${m.id}" style="flex:0;">🗑️ حذف</button>
            </div>
        </div>
    `).join("");
}

function renderAllStations() {
    const grid = document.getElementById("allStationsGrid");
    if (allStations.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">⛽</div><h4>لا توجد محطات</h4></div>`;
        return;
    }
    grid.innerHTML = allStations.map(s => `
        <div class="admin-station-card">
            <div class="admin-station-card-header">
                <h4>${escapeHtml(s.name)}</h4>
                <span class="status-badge ${s.is_active ? 'active' : 'inactive'}">${s.is_active ? "نشطة" : "متوقفة"}</span>
            </div>
            <div class="station-details">
                <div class="station-detail"><span class="icon">📍</span> ${escapeHtml(s.city)}${s.address ? " - " + escapeHtml(s.address) : ""}</div>
                <div class="station-detail"><span class="icon">⛽</span> ${fuelLabel(s.fuel_type)}</div>
                <div class="station-detail"><span class="icon">👤</span> المدير: ${escapeHtml(s.manager_name)} (${escapeHtml(s.manager_username)})</div>
                <div class="station-detail"><span class="icon">🕐</span> ${timeAgo(s.last_status_update)}</div>
            </div>
        </div>
    `).join("");
}

document.getElementById("createManagerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("mgrUsername").value.trim();
    const password = document.getElementById("mgrPassword").value;
    try {
        await apiCall(`${API}/api/auth/register`, "POST", {
            full_name: document.getElementById("mgrFullName").value.trim(),
            username, phone: document.getElementById("mgrPhone").value.trim(), password
        });
        showToast("تم إنشاء حساب المدير بنجاح");
        document.getElementById("createdUsername").textContent = username;
        document.getElementById("createdPassword").textContent = password;
        document.getElementById("newAccountCard").style.display = "block";
        e.target.reset();
        loadData();
    } catch (err) { showToast(err.message, "error"); }
});

async function deleteManager(id) {
    const mgr = managers.find(m => m.id === id);
    if (!mgr) return;
    if (!confirm(`هل أنت متأكد من حذف المدير "${mgr.full_name}"؟`)) return;
    try {
        const data = await apiCall(`${API}/api/super/managers/${id}`, "DELETE");
        showToast(data.message);
        loadData();
    } catch (err) { showToast(err.message, "error"); }
}

document.body.addEventListener("click", e => {
    const btn = e.target.closest("[data-delete-manager]");
    if (!btn) return;
    const id = parseInt(btn.getAttribute("data-delete-manager"), 10);
    if (Number.isNaN(id)) return;
    e.preventDefault();
    void deleteManager(id);
});

// INIT
document.addEventListener("DOMContentLoaded", async () => {
    if (!token) { showAuth(); return; }
    try {
        const data = await apiCall(`${API}/api/auth/me`);
        superInfo = data.admin;
        if (superInfo.role !== "super_admin") { window.location.href = "admin.html"; return; }
        showDashboard();
    } catch {
        token = null;
        sessionStorage.removeItem("admin_token");
        showAuth();
    }
});
