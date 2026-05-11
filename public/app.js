// Map page JavaScript - Citizens view
const API_BASE = "https://gas-station-kq3v.onrender.com";

// State
let map;
let markers = [];
let allStations = [];
let currentFilter = "all";

const SHEET_MQ = "(max-width: 768px)";

function isMobileSheetLayout() {
    return window.matchMedia(SHEET_MQ).matches;
}

function setSheetState(state) {
    const panel = document.getElementById("sidePanel");
    const handle = document.getElementById("sheetHandle");
    if (!panel || !isMobileSheetLayout()) return;

    ["collapsed", "half", "full"].forEach(s => panel.classList.remove(`sheet-state-${s}`));
    panel.classList.add(`sheet-state-${state}`);
    panel.dataset.sheetState = state;
    if (handle) {
        handle.setAttribute("aria-expanded", state === "collapsed" ? "false" : "true");
    }
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 420);
}

function cycleSheetState() {
    const panel = document.getElementById("sidePanel");
    if (!panel) return;
    const order = ["collapsed", "half", "full"];
    const cur = panel.dataset.sheetState || "collapsed";
    const next = order[(order.indexOf(cur) + 1) % order.length];
    setSheetState(next);
}

function sheetExpandOne() {
    const cur = document.getElementById("sidePanel")?.dataset.sheetState;
    if (cur === "collapsed") setSheetState("half");
    else if (cur === "half") setSheetState("full");
}

function sheetCollapseOne() {
    const cur = document.getElementById("sidePanel")?.dataset.sheetState;
    if (cur === "full") setSheetState("half");
    else if (cur === "half") setSheetState("collapsed");
}

function initMobileBottomSheet() {
    const panel = document.getElementById("sidePanel");
    const peek = document.getElementById("sheetPeek");
    const quick = document.getElementById("sheetQuickSearch");
    const searchInput = document.getElementById("searchInput");
    if (!panel || !peek) return;

    const mq = window.matchMedia(SHEET_MQ);

    const resetDesktopSheet = () => {
        if (mq.matches) return;
        ["collapsed", "half", "full"].forEach(s => panel.classList.remove(`sheet-state-${s}`));
        panel.classList.add("sheet-state-collapsed");
        panel.dataset.sheetState = "collapsed";
        const handle = document.getElementById("sheetHandle");
        if (handle) handle.setAttribute("aria-expanded", "false");
        setTimeout(() => map && map.invalidateSize(), 80);
    };

    mq.addEventListener("change", resetDesktopSheet);

    let peekPointerId = null;
    let peekStartY = 0;
    let peekLastDy = 0;
    let peekDrag = false;

    peek.addEventListener("pointerdown", e => {
        if (!mq.matches) return;
        peekPointerId = e.pointerId;
        peekStartY = e.clientY;
        peekLastDy = 0;
        peekDrag = false;
        try {
            peek.setPointerCapture(e.pointerId);
        } catch (_) { /* noop */ }
    });

    peek.addEventListener("pointermove", e => {
        if (e.pointerId !== peekPointerId || !mq.matches) return;
        peekLastDy = e.clientY - peekStartY;
        if (Math.abs(peekLastDy) > 14) peekDrag = true;
    });

    peek.addEventListener("pointerup", e => {
        if (e.pointerId !== peekPointerId || !mq.matches) return;
        try {
            peek.releasePointerCapture(e.pointerId);
        } catch (_) { /* noop */ }
        peekPointerId = null;

        if (peekDrag && Math.abs(peekLastDy) >= 48) {
            if (peekLastDy < 0) sheetExpandOne();
            else sheetCollapseOne();
        } else {
            cycleSheetState();
        }
        peekDrag = false;
    });

    peek.addEventListener("pointercancel", e => {
        if (e.pointerId !== peekPointerId) return;
        peekPointerId = null;
        peekDrag = false;
    });

    if (quick) {
        quick.addEventListener("click", () => {
            if (!mq.matches) return;
            setSheetState("half");
            requestAnimationFrame(() => searchInput && searchInput.focus());
        });
    }

    if (searchInput) {
        searchInput.addEventListener("focus", () => {
            if (!mq.matches) return;
            if (panel.dataset.sheetState === "collapsed") setSheetState("half");
        });
    }
}

// Toast notification
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Initialize Leaflet map centered on Libya
function initMap() {
    map = L.map("map", {
        center: [26.3351, 17.2283],
        zoom: 6,
        zoomControl: false
    });

    // Light tile layer
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }).addTo(map);

    // Zoom control on the left
    L.control.zoom({ position: "topleft" }).addTo(map);
}

// Create custom marker icon
function createMarkerIcon(isActive, fuelType) {
    const color = isActive ? "#059669" : "#dc2626";
    const glow = isActive ? "0 0 12px rgba(5,150,105,0.5)" : "0 0 8px rgba(220,38,38,0.3)";

    return L.divIcon({
        className: "custom-marker",
        html: `<div style="
            width:36px;height:36px;
            background:${color};
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            display:flex;align-items:center;justify-content:center;
            box-shadow:${glow}, 0 3px 10px rgba(0,0,0,0.3);
            border:3px solid white;
        "><span style="transform:rotate(45deg);font-size:16px;">⛽</span></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36]
    });
}

// Fuel type label
function fuelLabel(type) {
    const labels = { benzine: "بنزين", diesel: "ديزل", both: "بنزين + ديزل" };
    return labels[type] || "بنزين";
}

// Time ago helper
function timeAgo(dateStr) {
    if (!dateStr) return "غير محدد";
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "الآن";
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
}

// Build popup content
function buildPopup(station) {
    const statusClass = station.is_active ? "active" : "inactive";
    const statusText = station.is_active ? "متوفر الآن" : "غير متوفر";
    return `
        <div class="popup-content">
            <h4>${station.name}</h4>
            <p>📍 ${station.city}${station.address ? " - " + station.address : ""}</p>
            <p>⛽ ${fuelLabel(station.fuel_type)}</p>
            <p>👤 ${station.manager_name}</p>
            <p>🕐 آخر تحديث: ${timeAgo(station.last_status_update)}</p>
            <span class="popup-status ${statusClass}">${statusText}</span>
        </div>
    `;
}

// Add markers to map
function renderMarkers(stations) {
    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    stations.forEach(station => {
        const icon = createMarkerIcon(station.is_active, station.fuel_type);
        const marker = L.marker([station.latitude, station.longitude], { icon })
            .addTo(map)
            .bindPopup(buildPopup(station), { maxWidth: 280 });

        marker.stationId = station.id;
        markers.push(marker);
    });
}

// Render station list in side panel
function renderStationList(stations) {
    const list = document.getElementById("stationList");
    document.getElementById("filteredCount").textContent = stations.length;
    const peekCount = document.getElementById("sheetPeekCount");
    if (peekCount) peekCount.textContent = stations.length;

    if (stations.length === 0) {
        list.innerHTML = `<div class="no-stations">لا توجد محطات مطابقة للبحث</div>`;
        return;
    }

    list.innerHTML = stations.map(s => `
        <div class="station-item" data-id="${s.id}" data-lat="${s.latitude}" data-lng="${s.longitude}">
            <span class="station-status-dot ${s.is_active ? "active" : "inactive"}"></span>
            <div class="station-item-info">
                <h4>${s.name}</h4>
                <p>${s.city} ${s.address ? "- " + s.address : ""}</p>
                <p style="font-size:10px;color:var(--text-muted);">${timeAgo(s.last_status_update)}</p>
            </div>
            <span class="fuel-badge ${s.fuel_type}">${fuelLabel(s.fuel_type)}</span>
        </div>
    `).join("");

    // Click to fly to station
    list.querySelectorAll(".station-item").forEach(item => {
        item.addEventListener("click", () => {
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            const id = parseInt(item.dataset.id);
            map.flyTo([lat, lng], 15, { duration: 1.5 });

            // Open popup
            const marker = markers.find(m => m.stationId === id);
            if (marker) setTimeout(() => marker.openPopup(), 800);
        });
    });
}

// Filter stations
function filterStations() {
    const search = document.getElementById("searchInput").value.toLowerCase().trim();

    let filtered = allStations.filter(s => {
        // Search filter
        if (search) {
            const match = s.name.toLowerCase().includes(search) ||
                          s.city.toLowerCase().includes(search) ||
                          (s.address && s.address.toLowerCase().includes(search));
            if (!match) return false;
        }

        // Category filter
        if (currentFilter === "active") return s.is_active;
        if (currentFilter === "benzine") return s.fuel_type === "benzine";
        if (currentFilter === "diesel") return s.fuel_type === "diesel";
        if (currentFilter === "both") return s.fuel_type === "both";
        return true;
    });

    renderStationList(filtered);
    renderMarkers(filtered);
}

// Fetch stations from API
async function fetchStations() {
    try {
        const res = await fetch(`${API_BASE}/api/stations`);
        if (!res.ok) throw new Error("Failed to fetch");
        allStations = await res.json();

        // Update header stats
        document.getElementById("totalCount").textContent = allStations.length;
        document.getElementById("activeCount").textContent = allStations.filter(s => s.is_active).length;

        filterStations();
    } catch (error) {
        console.error("Error fetching stations:", error);
        document.getElementById("stationList").innerHTML =
            `<div class="no-stations">خطأ في تحميل البيانات - تأكد من اتصال الخادم</div>`;
    }
}

// Event listeners
function setupEvents() {
    // Search
    document.getElementById("searchInput").addEventListener("input", filterStations);

    // Filter chips
    document.querySelectorAll(".chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentFilter = chip.dataset.filter;
            filterStations();
        });
    });

    // Locate me button
    document.getElementById("locateBtn").addEventListener("click", () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => {
                    map.flyTo([pos.coords.latitude, pos.coords.longitude], 14, { duration: 1.5 });
                    L.circle([pos.coords.latitude, pos.coords.longitude], {
                        radius: 200, color: "#00d4aa", fillOpacity: 0.15, weight: 2
                    }).addTo(map);
                    showToast("تم تحديد موقعك");
                },
                () => showToast("لم يتم السماح بتحديد الموقع", "error")
            );
        }
    });

    // Auto-refresh every 30 seconds
    setInterval(fetchStations, 30000);
}

// Init
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    setupEvents();
    initMobileBottomSheet();
    fetchStations();
});
