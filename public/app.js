// Map page JavaScript - Citizens view (API_BASE from api-config.js)

// State
let map;
let markers = [];
let allStations = [];
let currentFilter = "all";

// Route navigation
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";
let routeOutlineLayer = null;
let routeLayer = null;
let userLocationMarker = null;
let userAccuracyCircle = null;
let geoWatchId = null;
let navigationState = null;
let navFollowEnabled = true;
let navNearNotified = false;

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

function isPwaStandalone() {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: window-controls-overlay)").matches ||
        (typeof navigator.standalone === "boolean" && navigator.standalone)
    );
}

function isSecureForPwa() {
    return (
        window.isSecureContext === true ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1"
    );
}

function isIOSDevice() {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return /MacIntel/.test(navigator.platform || "") && navigator.maxTouchPoints > 1;
}

let deferredInstallPrompt = null;

function syncInstallPwaButton() {
    const btn = document.getElementById("installPwaBtn");
    if (!btn) return;
    if (isPwaStandalone()) {
        btn.hidden = true;
        return;
    }
    if (!isSecureForPwa()) {
        btn.hidden = true;
        return;
    }
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    const show = deferredInstallPrompt !== null || isIOSDevice() || mobile;
    btn.hidden = !show;
}

function closePwaInstallModal() {
    const modal = document.getElementById("pwaInstallModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
}

function openPwaInstallModal(kind) {
    const body = document.getElementById("pwaInstallModalBody");
    const modal = document.getElementById("pwaInstallModal");
    if (!body || !modal) return;
    if (kind === "ios") {
        body.innerHTML =
            "<ol class=\"pwa-steps\"><li>اضغط زر <strong>المشاركة</strong> في شريط أدوات Safari (المربع مع السهم لأعلى).</li><li>مرّر للأسفل واختر <strong>إضافة إلى الشاشة الرئيسية</strong>.</li><li>اضغط <strong>إضافة</strong> في الزاوية.</li></ol>" +
            "<p class=\"pwa-note\">في iPhone وiPad لا يظهر مربع تثبيت تلقائي؛ التثبيت يدوي من Safari. إن كنت تستخدم Chrome جرّب فتح الرابط في Safari ثم كرر الخطوات.</p>";
    } else {
        body.innerHTML =
            "<ol class=\"pwa-steps\"><li>افتح قائمة المتصفح (⋮ أو ⋯ أو القائمة في الأسفل).</li><li>ابحث عن <strong>تثبيت التطبيق</strong> أو <strong>Install app</strong> أو <strong>Add to Home screen</strong>.</li><li>أكّد التثبيت إن ظهر لك مربع حوار.</li></ol>" +
            "<p class=\"pwa-note\">إن ظهر لك مباشرةً طلب تثبيت من المتصفح، استخدمه قبل هذه الخطوات.</p>";
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
}

function initPwaInstall() {
    const btn = document.getElementById("installPwaBtn");
    const modal = document.getElementById("pwaInstallModal");
    if (!btn || !modal) return;

    if (isPwaStandalone()) {
        btn.hidden = true;
        return;
    }

    window.addEventListener("beforeinstallprompt", e => {
        e.preventDefault();
        deferredInstallPrompt = e;
        syncInstallPwaButton();
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        btn.hidden = true;
        showToast("تم تثبيت التطبيق");
    });

    btn.addEventListener("click", async () => {
        if (deferredInstallPrompt) {
            try {
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                deferredInstallPrompt = null;
                if (outcome === "accepted") {
                    showToast("تم بدء التثبيت");
                    btn.hidden = true;
                } else {
                    syncInstallPwaButton();
                }
            } catch {
                deferredInstallPrompt = null;
                syncInstallPwaButton();
            }
            return;
        }
        openPwaInstallModal(isIOSDevice() ? "ios" : "generic");
    });

    document.getElementById("pwaInstallModalClose")?.addEventListener("click", closePwaInstallModal);
    document.getElementById("pwaInstallModalBackdrop")?.addEventListener("click", closePwaInstallModal);
    document.getElementById("pwaInstallModalOk")?.addEventListener("click", closePwaInstallModal);

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !modal.hidden) closePwaInstallModal();
    });

    window.matchMedia("(max-width: 768px)").addEventListener("change", syncInstallPwaButton);

    syncInstallPwaButton();
    setTimeout(syncInstallPwaButton, 2500);
}

// Initialize Leaflet map centered on Libya
function initMap() {
    if (typeof L !== "undefined" && L.Icon && L.Icon.Default) {
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: "vendor/images/marker-icon-2x.png",
            iconUrl: "vendor/images/marker-icon.png",
            shadowUrl: "vendor/images/marker-shadow.png"
        });
    }
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

// ===== ROUTE NAVIGATION =====

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatNavDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} م`;
    return `${(meters / 1000).toFixed(1)} كم`;
}

function formatNavDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return "أقل من دقيقة";
    const mins = Math.round(s / 60);
    if (mins < 60) return `${mins} دقيقة`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} س ${m} د` : `${h} ساعة`;
}

function getStationById(id) {
    const num = Number(id);
    return allStations.find(s => Number(s.id) === num);
}

function createUserLocationIcon() {
    return L.divIcon({
        className: "user-location-marker",
        html: '<div class="user-location-dot"><span class="user-location-pulse"></span></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function setNavBarLoading(loading) {
    const bar = document.getElementById("navBar");
    const inner = bar?.querySelector(".nav-bar-inner");
    const loadEl = document.getElementById("navBarLoading");
    if (!bar) return;
    if (loading) {
        bar.hidden = false;
        bar.classList.add("nav-bar--loading");
        if (inner) inner.hidden = true;
        if (loadEl) loadEl.hidden = false;
    } else {
        bar.classList.remove("nav-bar--loading");
        if (inner) inner.hidden = false;
        if (loadEl) loadEl.hidden = true;
    }
}

function showNavBar(station) {
    const bar = document.getElementById("navBar");
    if (!bar) return;
    document.getElementById("navDestName").textContent = station.name;
    bar.hidden = false;
    document.body.classList.add("nav-active");
}

function hideNavBar() {
    const bar = document.getElementById("navBar");
    if (bar) bar.hidden = true;
    document.body.classList.remove("nav-active");
    collapseNavDetails();
}

function collapseNavDetails() {
    const details = document.getElementById("navBarDetails");
    const btn = document.getElementById("navExpandBtn");
    const bar = document.getElementById("navBar");
    if (details) details.hidden = true;
    if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "⋯";
    }
    bar?.classList.remove("nav-bar--expanded");
}

function toggleNavDetails() {
    const details = document.getElementById("navBarDetails");
    const btn = document.getElementById("navExpandBtn");
    const bar = document.getElementById("navBar");
    if (!details || !btn) return;
    const opening = details.hidden;
    details.hidden = !opening;
    btn.setAttribute("aria-expanded", opening ? "true" : "false");
    btn.textContent = opening ? "▾" : "⋯";
    bar?.classList.toggle("nav-bar--expanded", opening);
}

function clearRouteLayers() {
    if (routeOutlineLayer) {
        map.removeLayer(routeOutlineLayer);
        routeOutlineLayer = null;
    }
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
}

function clearUserLocationLayers() {
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
        userLocationMarker = null;
    }
    if (userAccuracyCircle) {
        map.removeLayer(userAccuracyCircle);
        userAccuracyCircle = null;
    }
}

function drawRoute(coordsLatLng) {
    clearRouteLayers();
    routeOutlineLayer = L.polyline(coordsLatLng, {
        color: "#0f766e",
        weight: 9,
        opacity: 0.35,
        lineCap: "round",
        lineJoin: "round"
    }).addTo(map);
    routeLayer = L.polyline(coordsLatLng, {
        color: "#00d4aa",
        weight: 5,
        opacity: 0.92,
        lineCap: "round",
        lineJoin: "round"
    }).addTo(map);
}
///sdsdas
function buildFallbackRoute(fromLat, fromLng, toLat, toLng) {
    const distanceM = haversineMeters(fromLat, fromLng, toLat, toLng);
    return {
        coords: [[fromLat, fromLng], [toLat, toLng]],
        distanceM,
        durationS: distanceM / 13.89,
        isFallback: true
    };
}

async function fetchDrivingRoute(fromLat, fromLng, toLat, toLng) {
    const params = new URLSearchParams({
        from: `${fromLat},${fromLng}`,
        to: `${toLat},${toLng}`
    });

    let data = null;

    try {
        const res = await fetch(`${API_BASE}/api/route?${params}`);
        if (res.ok) data = await res.json();
    } catch (e) {
        console.warn("Route via API_BASE failed:", e);
    }

    if (!data) {
        const url = `${OSRM_ROUTE_URL}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("تعذر حساب المسار");
        data = await res.json();
    }

    if (data.code === "Ok" && data.routes?.[0]) {
        const route = data.routes[0];
        return {
            coords: route.geometry.coordinates.map(c => [c[1], c[0]]),
            distanceM: route.distance,
            durationS: route.duration,
            isFallback: false
        };
    }

    return buildFallbackRoute(fromLat, fromLng, toLat, toLng);
}

function updateUserLocation(lat, lng, accuracy) {
    const latlng = [lat, lng];
    if (!userLocationMarker) {
        userLocationMarker = L.marker(latlng, {
            icon: createUserLocationIcon(),
            zIndexOffset: 1000
        }).addTo(map);
    } else {
        userLocationMarker.setLatLng(latlng);
    }

    if (accuracy && accuracy > 0) {
        if (!userAccuracyCircle) {
            userAccuracyCircle = L.circle(latlng, {
                radius: accuracy,
                color: "#3b82f6",
                fillColor: "#3b82f6",
                fillOpacity: 0.12,
                weight: 1
            }).addTo(map);
        } else {
            userAccuracyCircle.setLatLng(latlng);
            userAccuracyCircle.setRadius(accuracy);
        }
    }
}

function fitRouteOnMap(coords, userLat, userLng) {
    const bounds = L.latLngBounds(coords);
    bounds.extend([userLat, userLng]);
    const dest = navigationState?.station;
    if (dest) bounds.extend([dest.latitude, dest.longitude]);
    map.fitBounds(bounds, { padding: [72, 72], maxZoom: 16 });
}

function updateNavigationProgress(lat, lng) {
    if (!navigationState) return;
    const dest = navigationState.station;
    const destLat = parseFloat(dest.latitude);
    const destLng = parseFloat(dest.longitude);
    const remainingM = haversineMeters(lat, lng, destLat, destLng);
    const ratio = navigationState.totalDistanceM > 0
        ? Math.min(1, remainingM / navigationState.totalDistanceM)
        : 1;
    const etaSec = navigationState.totalDurationS * ratio;

    const distEl = document.getElementById("navDistance");
    const etaEl = document.getElementById("navEta");
    const progressEl = document.getElementById("navProgressFill");
    if (distEl) distEl.textContent = formatNavDistance(remainingM);
    if (etaEl) etaEl.textContent = formatNavDuration(etaSec);
    if (progressEl) {
        const pct = Math.max(0, Math.min(100, (1 - ratio) * 100));
        progressEl.style.width = `${pct}%`;
    }

    if (remainingM < 80 && !navNearNotified) {
        navNearNotified = true;
        showToast("أنت قريب من المحطة", "success");
    }

    if (navFollowEnabled) {
        map.panTo([lat, lng], { animate: true, duration: 0.45 });
    }
}

function stopGeoWatch() {
    if (geoWatchId != null) {
        navigator.geolocation.clearWatch(geoWatchId);
        geoWatchId = null;
    }
}

function stopNavigation() {
    stopGeoWatch();
    clearRouteLayers();
    clearUserLocationLayers();
    navigationState = null;
    navFollowEnabled = true;
    navNearNotified = false;
    hideNavBar();
}

function openStationInMaps(station) {
    const lat = parseFloat(station.latitude);
    const lng = parseFloat(station.longitude);
    const coords = `${lat},${lng}`;
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) {
        window.open(`maps://?daddr=${coords}&dirflg=d`, "_blank");
    } else {
        window.open(
            `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=driving`,
            "_blank",
            "noopener"
        );
    }
}

function getCurrentPositionOnce() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("المتصفح لا يدعم تحديد الموقع"));
            return;
        }

        const tryOnce = opts =>
            new Promise((res, rej) => {
                navigator.geolocation.getCurrentPosition(res, rej, opts);
            });

        (async () => {
            try {
                resolve(
                    await tryOnce({
                        enableHighAccuracy: true,
                        timeout: 14000,
                        maximumAge: 0
                    })
                );
            } catch {
                resolve(
                    await tryOnce({
                        enableHighAccuracy: false,
                        timeout: 20000,
                        maximumAge: 120000
                    })
                );
            }
        })().catch(reject);
    });
}

function startGeoWatch() {
    stopGeoWatch();
    geoWatchId = navigator.geolocation.watchPosition(
        pos => {
            const { latitude, longitude, accuracy } = pos.coords;
            updateUserLocation(latitude, longitude, accuracy);
            updateNavigationProgress(latitude, longitude);
        },
        err => {
            const msg =
                err.code === 1
                    ? "تم إيقاف تتبع الموقع — اسمح بالوصول للموقع"
                    : "فقدنا إشارة موقعك";
            showToast(msg, "error");
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
    );
}

async function startStationNavigation(stationId) {
    const station = typeof stationId === "object" ? stationId : getStationById(stationId);
    if (!station) {
        showToast("المحطة غير متوفرة", "error");
        return;
    }

    if (Number(navigationState?.stationId) === Number(station.id)) {
        navFollowEnabled = true;
        const m = userLocationMarker;
        if (m) map.flyTo(m.getLatLng(), 16, { duration: 0.8 });
        return;
    }

    if (navigationState) stopNavigation();

    if (!navigator.geolocation) {
        showToast("تحديد الموقع غير مدعوم في متصفحك", "error");
        return;
    }

    if (isMobileSheetLayout()) setSheetState("collapsed");

    showNavBar(station);
    collapseNavDetails();
    setNavBarLoading(true);
    navNearNotified = false;
    navFollowEnabled = true;

    try {
        const pos = await getCurrentPositionOnce();
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        updateUserLocation(userLat, userLng, pos.coords.accuracy);

        const route = await fetchDrivingRoute(
            userLat,
            userLng,
            parseFloat(station.latitude),
            parseFloat(station.longitude)
        );

        drawRoute(route.coords);
        navigationState = {
            stationId: station.id,
            station,
            routeCoords: route.coords,
            totalDistanceM: route.distanceM,
            totalDurationS: route.durationS
        };

        document.getElementById("navDistance").textContent = formatNavDistance(route.distanceM);
        document.getElementById("navEta").textContent = formatNavDuration(route.durationS);
        document.getElementById("navProgressFill").style.width = "0%";

        fitRouteOnMap(route.coords, userLat, userLng);
        startGeoWatch();
        setNavBarLoading(false);

        const marker = markers.find(m => m.stationId === station.id);
        if (marker) {
            marker.setPopupContent(buildPopup(station));
            marker.openPopup();
            bindPopupActions();
        }

        showToast(
            route.isFallback
                ? "مسار تقريبي (خط مستقيم) — قد يختلف عن الطريق الفعلي"
                : "تم بدء تتبع المسار"
        );
    } catch (err) {
        console.error("Navigation error:", err);
        stopNavigation();
        const msg =
            err && err.code === 1
                ? "يجب السماح بالوصول إلى موقعك لتتبع المسار"
                : (err?.message || "تعذر بدء التتبع");
        showToast(msg, "error");
    }
}

function bindPopupActions() {
    const popupEl = document.querySelector(".leaflet-popup");
    if (popupEl && typeof L !== "undefined") {
        L.DomEvent.disableClickPropagation(popupEl);
        L.DomEvent.disableScrollPropagation(popupEl);
    }
}

function markerRefreshPopup(station) {
    const marker = markers.find(m => m.stationId === station.id);
    if (marker) {
        marker.setPopupContent(buildPopup(station));
        bindPopupActions();
    }
}

function initNavigation() {
    document.body.addEventListener(
        "click",
        e => {
            const navBtn = e.target.closest(".popup-nav-btn");
            if (!navBtn || !navBtn.closest(".leaflet-popup")) return;
            e.preventDefault();
            e.stopPropagation();
            const station = getStationById(navBtn.dataset.stationId);
            if (!station) return;
            if (Number(navigationState?.stationId) === Number(station.id)) {
                stopNavigation();
                showToast("تم إيقاف التتبع");
                markerRefreshPopup(station);
            } else {
                startStationNavigation(station.id);
            }
        },
        true
    );

    document.body.addEventListener(
        "click",
        e => {
            const extBtn = e.target.closest(".popup-external-btn");
            if (!extBtn || !extBtn.closest(".leaflet-popup")) return;
            e.preventDefault();
            e.stopPropagation();
            const station = getStationById(extBtn.dataset.stationId);
            if (station) openStationInMaps(station);
        },
        true
    );

    document.getElementById("navStopBtn")?.addEventListener("click", () => {
        stopNavigation();
        showToast("تم إيقاف التتبع");
        filterStations();
    });

    document.getElementById("navRecenterBtn")?.addEventListener("click", () => {
        if (!userLocationMarker) {
            showToast("لم يُحدد موقعك بعد", "error");
            return;
        }
        navFollowEnabled = true;
        map.flyTo(userLocationMarker.getLatLng(), 16, { duration: 0.8 });
    });

    document.getElementById("navExternalBtn")?.addEventListener("click", () => {
        if (navigationState?.station) openStationInMaps(navigationState.station);
    });

    document.getElementById("navExpandBtn")?.addEventListener("click", () => {
        toggleNavDetails();
    });
}

// Build popup content
function buildPopup(station) {
    const statusClass = station.is_active ? "active" : "inactive";
    const statusText = station.is_active ? "متوفر الآن" : "غير متوفر";
    const addr = station.address ? " - " + escapeHtml(station.address) : "";
    const isNavTarget =
        navigationState && Number(navigationState.stationId) === Number(station.id);
    return `
        <div class="popup-content">
            <h4>${escapeHtml(station.name)}</h4>
            <p>📍 ${escapeHtml(station.city)}${addr}</p>
            <p>⛽ ${fuelLabel(station.fuel_type)}</p>
            <p>👤 ${escapeHtml(station.manager_name)}</p>
            <p>🕐 آخر تحديث: ${timeAgo(station.last_status_update)}</p>
            <span class="popup-status ${statusClass}">${statusText}</span>
            <div class="popup-actions">
                <button type="button" class="popup-btn popup-btn-primary popup-nav-btn" data-station-id="${station.id}">
                    ${isNavTarget ? "● جاري التتبع" : "🧭 تتبع المسار"}
                </button>
                <button type="button" class="popup-btn popup-btn-secondary popup-external-btn" data-station-id="${station.id}">
                    فتح في الخرائط
                </button>
            </div>
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
            .bindPopup(buildPopup(station), { maxWidth: 300, className: "station-popup" });

        marker.stationId = station.id;
        marker.on("popupopen", ev => {
            const el = ev.popup?.getElement?.();
            if (el && typeof L !== "undefined") {
                L.DomEvent.disableClickPropagation(el);
                L.DomEvent.disableScrollPropagation(el);
            }
            bindPopupActions();
        });
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
                <h4>${escapeHtml(s.name)}</h4>
                <p>${escapeHtml(s.city)} ${s.address ? "- " + escapeHtml(s.address) : ""}</p>
                <p style="font-size:10px;color:var(--text-muted);">${timeAgo(s.last_status_update)}</p>
            </div>
            <span class="fuel-badge ${s.fuel_type}">${fuelLabel(s.fuel_type)}</span>
            <button type="button" class="station-nav-btn" data-id="${s.id}" title="تتبع المسار" aria-label="تتبع المسار إلى ${escapeHtml(s.name)}">🧭</button>
        </div>
    `).join("");

    list.querySelectorAll(".station-item").forEach(item => {
        item.addEventListener("click", () => {
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            const id = parseInt(item.dataset.id, 10);
            map.flyTo([lat, lng], 15, { duration: 1.5 });
            const marker = markers.find(m => m.stationId === id);
            if (marker) setTimeout(() => marker.openPopup(), 800);
        });
    });

    list.querySelectorAll(".station-nav-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            startStationNavigation(parseInt(btn.dataset.id, 10));
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

function debounce(fn, wait) {
    let t;
    return function debounced() {
        clearTimeout(t);
        t = setTimeout(fn, wait);
    };
}

const debouncedFilterStations = debounce(() => filterStations(), 150);

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
    document.getElementById("searchInput").addEventListener("input", debouncedFilterStations);

    // Filter chips
    document.querySelectorAll(".chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentFilter = chip.dataset.filter;
            filterStations();
        });
    });

    document.getElementById("locateBtn").addEventListener("click", () => {
        if (!navigator.geolocation) {
            showToast("تحديد الموقع غير مدعوم", "error");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => {
                const { latitude, longitude, accuracy } = pos.coords;
                updateUserLocation(latitude, longitude, accuracy);
                map.flyTo([latitude, longitude], 14, { duration: 1.5 });
                showToast("تم تحديد موقعك");
            },
            () => showToast("لم يتم السماح بتحديد الموقع", "error"),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    });

    // Auto-refresh every 30 seconds
    setInterval(fetchStations, 30000);
}

// Init
document.addEventListener("DOMContentLoaded", () => {
    initPwaInstall();
    initMap();
    initNavigation();
    setupEvents();
    initMobileBottomSheet();
    fetchStations();
});
