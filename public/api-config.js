(function (global) {
    const PRODUCTION_API = "https://gas-station-kq3v.onrender.com";
    const LOCAL_API = "http://localhost:3000";

    function isLocalHost(hostname) {
        return hostname === "localhost" || hostname === "127.0.0.1";
    }

    function resolveApiBase() {
        if (typeof location === "undefined") return PRODUCTION_API;

        const { hostname, protocol, port, origin } = location;

        if (!protocol.startsWith("http")) {
            return PRODUCTION_API;
        }

        if (hostname.endsWith(".onrender.com")) {
            return origin;
        }

        if (isLocalHost(hostname)) {
            if (port === "3000") return origin;
            return LOCAL_API;
        }

        if (port === "3000") return origin;

        return origin || PRODUCTION_API;
    }

    const base = resolveApiBase();
    global.API_BASE = base;
    global.API = base;
})(typeof globalThis !== "undefined" ? globalThis : window);
