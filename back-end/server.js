const compression = require("compression");
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = 3000;

app.set("trust proxy", 1);

const DEFAULT_ALLOWED_ORIGINS = [
    "https://gas-station-kq3v.onrender.com",
    "https://gas-station-bq3s.onrender.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

function allowedOriginsList() {
    const raw = process.env.ALLOWED_ORIGINS;
    if (raw && String(raw).trim()) {
        return String(raw).split(",").map(s => s.trim()).filter(Boolean);
    }
    return DEFAULT_ALLOWED_ORIGINS;
}

// Middleware: CORS (specific origins only)
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = allowedOriginsList();
    if (origin && allowed.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 80,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "محاولات كثيرة، حاول لاحقاً" }
});
app.use(compression({ threshold: 1024 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
    express.static(path.join(__dirname, "../public"), {
        etag: true,
        lastModified: true,
        setHeaders(res, filePath) {
            if (filePath.endsWith(".html")) {
                res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
            } else if (/\.(js|mjs|css|png|jpe?g|gif|webp|ico|json|svg|woff2?|map)$/i.test(filePath)) {
                res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
            }
        }
    })
);

// MySQL Connection Pool
// const pool = mysql.createPool({
//     host: "localhost",
//     user: "root",
//     password: "Root@123",
//     database: "gas_station_db",
//     waitForConnections: true,
//     connectionLimit: 10,
//     queueLimit: 0
// });

const pool = mysql.createPool({
    // الربط الذكي: يحاول الاتصال بالإنترنت أولاً، ثم بجهازك محلياً
    host: process.env.MYSQLHOST || "localhost",
    user: process.env.MYSQLUSER || "root",
    password: process.env.MYSQLPASSWORD || "Root@123",
    database: process.env.MYSQL_DATABASE || "gas_station_db",
    port: process.env.MYSQLPORT || 3306,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

    // تفعيل التشفير فقط عندما نكون على السيرفر (Render + Railway)
    ssl: process.env.DB_HOST ? { rejectUnauthorized: false } : false
});









// Server-side session store
const sessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Verify password; migrates legacy SHA-256 hashes to bcrypt on success. */
async function verifyPasswordWithMigration(plain, storedHash, adminId) {
    if (!storedHash || typeof storedHash !== "string") return false;
    if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
        return bcrypt.compare(plain, storedHash);
    }
    const legacy = crypto.createHash("sha256").update(plain).digest("hex");
    if (legacy !== storedHash) return false;
    try {
        const newHash = await bcrypt.hash(plain, 12);
        await pool.query("UPDATE admins SET password_hash = ? WHERE id = ?", [newHash, adminId]);
    } catch (e) {
        console.error("Password migration error:", e.message);
    }
    return true;
}

// Helper: generate session token
function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

// Helper: extract token from Authorization header
function getToken(req) {
    return req.headers["authorization"]?.replace("Bearer ", "") || null;
}

// Middleware: authenticate admin
function authenticateAdmin(req, res, next) {
    const token = getToken(req);
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: "غير مصرح - يرجى تسجيل الدخول" });
    }
    const session = sessions.get(token);
    if (session.expiresAt == null || session.expiresAt < Date.now()) {
        sessions.delete(token);
        return res.status(401).json({ error: "انتهت الجلسة - يرجى تسجيل الدخول من جديد" });
    }
    req.adminId = session.id;
    req.adminRole = session.role;
    next();
}

// Middleware: authenticate super admin
function authenticateSuperAdmin(req, res, next) {
    const token = getToken(req);
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: "غير مصرح - يرجى تسجيل الدخول" });
    }
    const session = sessions.get(token);
    if (session.expiresAt == null || session.expiresAt < Date.now()) {
        sessions.delete(token);
        return res.status(401).json({ error: "انتهت الجلسة - يرجى تسجيل الدخول من جديد" });
    }
    if (session.role !== "super_admin") {
        return res.status(403).json({ error: "صلاحيات غير كافية" });
    }
    req.adminId = session.id;
    req.adminRole = session.role;
    next();
}

// Initialize database tables
async function initDatabase() {
    try {
        const connection = await pool.getConnection();

        await connection.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(200) NOT NULL,
                phone VARCHAR(20),
                role ENUM('super_admin', 'manager') DEFAULT 'manager',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add role column if table already exists without it
        try {
            await connection.query(`ALTER TABLE admins ADD COLUMN role ENUM('super_admin', 'manager') DEFAULT 'manager'`);
        } catch (e) {
            // Column already exists, ignore
        }

        // Seed super admin (username: admin). Password: SUPER_ADMIN_INITIAL_PASSWORD or default admin123 — change in production.
        const seedPassword = process.env.SUPER_ADMIN_INITIAL_PASSWORD || "admin123";
        const superAdminHash = await bcrypt.hash(seedPassword, 12);
        try {
            await connection.query(
                `INSERT INTO admins (username, password_hash, full_name, role) VALUES (?, ?, ?, 'super_admin')`,
                ["admin", superAdminHash, "مدير الموقع"]
            );
            console.log("Super admin seed created (username: admin). Use SUPER_ADMIN_INITIAL_PASSWORD on production hosts.");
        } catch (e) {
            // Already exists
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS stations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                admin_id INT NOT NULL,
                name VARCHAR(200) NOT NULL,
                city VARCHAR(100) NOT NULL,
                address VARCHAR(300),
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                is_active BOOLEAN DEFAULT FALSE,
                fuel_type ENUM('benzine', 'diesel', 'both') DEFAULT 'benzine',
                last_status_update TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS activity_log (
                id INT AUTO_INCREMENT PRIMARY KEY,
                station_id INT NOT NULL,
                action ENUM('activated', 'deactivated') NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
            )
        `);

        connection.release();
        console.log("Database tables initialized successfully");
    } catch (error) {
        console.error("Database initialization error:", error.message);
        console.log("Make sure MySQL is running and the database 'gas_station_db' exists.");
        console.log("Run: CREATE DATABASE gas_station_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
    }
}

// ==================== AUTH ROUTES ====================

// Super admin creates a manager account
app.post("/api/auth/register", authenticateSuperAdmin, async (req, res) => {
    try {
        const { username, password, full_name, phone } = req.body;

        if (!username || !password || !full_name) {
            return res.status(400).json({ error: "جميع الحقول مطلوبة" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await pool.query(
            "INSERT INTO admins (username, password_hash, full_name, phone, role) VALUES (?, ?, ?, ?, 'manager')",
            [username, passwordHash, full_name, phone || null]
        );

        res.status(201).json({
            message: "تم إنشاء حساب مدير المحطة بنجاح",
            manager: { id: result.insertId, username, full_name }
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ error: "اسم المستخدم مستخدم بالفعل" });
        }
        console.error("Register error:", error);
        res.status(500).json({ error: "خطأ في الخادم" });
    }
});

// Login (unified)
app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان" });
        }

        const [rows] = await pool.query(
            "SELECT id, username, full_name, role, password_hash FROM admins WHERE username = ?",
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
        }

        const admin = rows[0];
        const valid = await verifyPasswordWithMigration(password, admin.password_hash, admin.id);
        if (!valid) {
            return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
        }

        const token = generateToken();
        sessions.set(token, { id: admin.id, role: admin.role, expiresAt: Date.now() + SESSION_TTL_MS });

        res.json({
            message: "تم تسجيل الدخول بنجاح",
            token,
            admin: { id: admin.id, username: admin.username, full_name: admin.full_name, role: admin.role }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "خطأ في الخادم" });
    }
});

// Check current session
app.get("/api/auth/me", (req, res) => {
    const token = getToken(req);
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: "غير مسجل الدخول" });
    }
    const session = sessions.get(token);
    if (session.expiresAt == null || session.expiresAt < Date.now()) {
        sessions.delete(token);
        return res.status(401).json({ error: "انتهت الجلسة - يرجى تسجيل الدخول من جديد" });
    }
    pool.query("SELECT id, username, full_name, role FROM admins WHERE id = ?", [session.id])
        .then(([rows]) => {
            if (rows.length === 0) {
                sessions.delete(token);
                return res.status(401).json({ error: "الحساب غير موجود" });
            }
            res.json({ admin: rows[0] });
        })
        .catch(() => res.status(500).json({ error: "خطأ في الخادم" }));
});

// Logout
app.post("/api/auth/logout", (req, res) => {
    const token = getToken(req);
    if (token) sessions.delete(token);
    res.json({ message: "تم تسجيل الخروج بنجاح" });
});

// ==================== STATION ROUTES ====================

// Get all active stations (public - for the map)
app.get("/api/stations", async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.name, s.city, s.address, s.latitude, s.longitude, 
                    s.is_active, s.fuel_type, s.last_status_update,
                    a.full_name as manager_name
             FROM stations s 
             JOIN admins a ON s.admin_id = a.id
             ORDER BY s.is_active DESC, s.last_status_update DESC`
        );
        res.json(rows);
    } catch (error) {
        console.error("Get stations error:", error);
        res.status(500).json({ error: "خطأ في جلب البيانات" });
    }
});

// Get only active stations (for map filter)
app.get("/api/stations/active", async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.name, s.city, s.address, s.latitude, s.longitude, 
                    s.fuel_type, s.last_status_update,
                    a.full_name as manager_name
             FROM stations s 
             JOIN admins a ON s.admin_id = a.id
             WHERE s.is_active = TRUE
             ORDER BY s.last_status_update DESC`
        );
        res.json(rows);
    } catch (error) {
        console.error("Get active stations error:", error);
        res.status(500).json({ error: "خطأ في جلب البيانات" });
    }
});

// Get admin's stations
app.get("/api/admin/stations", authenticateAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.*, 
                    (SELECT COUNT(*) FROM activity_log WHERE station_id = s.id AND action = 'activated') as total_activations
             FROM stations s 
             WHERE s.admin_id = ?
             ORDER BY s.created_at DESC`,
            [req.adminId]
        );
        res.json(rows);
    } catch (error) {
        console.error("Get admin stations error:", error);
        res.status(500).json({ error: "خطأ في جلب البيانات" });
    }
});

// Add new station
app.post("/api/admin/stations", authenticateAdmin, async (req, res) => {
    try {
        const { name, city, address, latitude, longitude, fuel_type } = req.body;

        if (!name || !city || !latitude || !longitude) {
            return res.status(400).json({ error: "الاسم والمدينة والموقع مطلوبين" });
        }

        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (isNaN(lat) || isNaN(lng) || lat < 19 || lat > 34 || lng < 9 || lng > 26) {
            return res.status(400).json({ error: "الموقع الجغرافي غير صحيح - يجب أن يكون داخل ليبيا" });
        }

        const [result] = await pool.query(
            `INSERT INTO stations (admin_id, name, city, address, latitude, longitude, fuel_type) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.adminId, name, city, address || null, lat, lng, fuel_type || "benzine"]
        );

        res.status(201).json({
            message: "تم إضافة المحطة بنجاح",
            station: { id: result.insertId, name, city, latitude: lat, longitude: lng }
        });
    } catch (error) {
        console.error("Add station error:", error);
        res.status(500).json({ error: "خطأ في إضافة المحطة" });
    }
});

// Toggle station active status
app.patch("/api/admin/stations/:id/toggle", authenticateAdmin, async (req, res) => {
    try {
        const stationId = req.params.id;

        // Verify ownership
        const [station] = await pool.query(
            "SELECT id, is_active FROM stations WHERE id = ? AND admin_id = ?",
            [stationId, req.adminId]
        );

        if (station.length === 0) {
            return res.status(404).json({ error: "المحطة غير موجودة أو ليست لك" });
        }

        const newStatus = !station[0].is_active;

        await pool.query(
            "UPDATE stations SET is_active = ?, last_status_update = NOW() WHERE id = ?",
            [newStatus, stationId]
        );

        // Log the activity
        await pool.query(
            "INSERT INTO activity_log (station_id, action) VALUES (?, ?)",
            [stationId, newStatus ? "activated" : "deactivated"]
        );

        res.json({
            message: newStatus ? "تم تفعيل المحطة" : "تم إيقاف المحطة",
            is_active: newStatus
        });
    } catch (error) {
        console.error("Toggle station error:", error);
        res.status(500).json({ error: "خطأ في تحديث الحالة" });
    }
});

// Update fuel type
app.patch("/api/admin/stations/:id/fuel", authenticateAdmin, async (req, res) => {
    try {
        const stationId = req.params.id;
        const { fuel_type } = req.body;

        if (!["benzine", "diesel", "both"].includes(fuel_type)) {
            return res.status(400).json({ error: "نوع الوقود غير صحيح" });
        }

        const [station] = await pool.query(
            "SELECT id FROM stations WHERE id = ? AND admin_id = ?",
            [stationId, req.adminId]
        );

        if (station.length === 0) {
            return res.status(404).json({ error: "المحطة غير موجودة" });
        }

        await pool.query(
            "UPDATE stations SET fuel_type = ? WHERE id = ?",
            [fuel_type, stationId]
        );

        const labels = { benzine: "بنزين", diesel: "ديزل", both: "بنزين + ديزل" };
        res.json({ message: `تم تحديث نوع الوقود إلى: ${labels[fuel_type]}` });
    } catch (error) {
        console.error("Update fuel type error:", error);
        res.status(500).json({ error: "خطأ في تحديث نوع الوقود" });
    }
});

// Update station info
app.put("/api/admin/stations/:id", authenticateAdmin, async (req, res) => {
    try {
        const stationId = req.params.id;
        const { name, city, address, latitude, longitude, fuel_type } = req.body;

        if (!name || !city || latitude == null || longitude == null) {
            return res.status(400).json({ error: "الاسم والمدينة والموقع مطلوبين" });
        }

        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        if (isNaN(lat) || isNaN(lng) || lat < 19 || lat > 34 || lng < 9 || lng > 26) {
            return res.status(400).json({ error: "الموقع الجغرافي غير صحيح - يجب أن يكون داخل ليبيا" });
        }

        const ft = fuel_type || "benzine";
        if (!["benzine", "diesel", "both"].includes(ft)) {
            return res.status(400).json({ error: "نوع الوقود غير صحيح" });
        }

        // Verify ownership
        const [station] = await pool.query(
            "SELECT id FROM stations WHERE id = ? AND admin_id = ?",
            [stationId, req.adminId]
        );

        if (station.length === 0) {
            return res.status(404).json({ error: "المحطة غير موجودة" });
        }

        await pool.query(
            `UPDATE stations SET name = ?, city = ?, address = ?, latitude = ?, longitude = ?, fuel_type = ?
             WHERE id = ? AND admin_id = ?`,
            [name, city, address || null, lat, lng, ft, stationId, req.adminId]
        );

        res.json({ message: "تم تحديث بيانات المحطة بنجاح" });
    } catch (error) {
        console.error("Update station error:", error);
        res.status(500).json({ error: "خطأ في تحديث المحطة" });
    }
});

// Delete station
app.delete("/api/admin/stations/:id", authenticateAdmin, async (req, res) => {
    try {
        const stationId = req.params.id;

        const [result] = await pool.query(
            "DELETE FROM stations WHERE id = ? AND admin_id = ?",
            [stationId, req.adminId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "المحطة غير موجودة" });
        }

        res.json({ message: "تم حذف المحطة بنجاح" });
    } catch (error) {
        console.error("Delete station error:", error);
        res.status(500).json({ error: "خطأ في حذف المحطة" });
    }
});

// ==================== STATS ROUTE ====================

app.get("/api/stats", async (req, res) => {
    try {
        const [totalStations] = await pool.query("SELECT COUNT(*) as count FROM stations");
        const [activeStations] = await pool.query("SELECT COUNT(*) as count FROM stations WHERE is_active = TRUE");
        const [cities] = await pool.query("SELECT DISTINCT city FROM stations WHERE is_active = TRUE");

        res.json({
            total: totalStations[0].count,
            active: activeStations[0].count,
            cities: cities.map(c => c.city)
        });
    } catch (error) {
        console.error("Stats error:", error);
        res.status(500).json({ error: "خطأ في جلب الإحصائيات" });
    }
});

// ==================== SUPER ADMIN ROUTES ====================

// Get all managers
app.get("/api/super/managers", authenticateSuperAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.id, a.username, a.full_name, a.phone, a.created_at,
                    COUNT(s.id) as station_count,
                    SUM(CASE WHEN s.is_active = TRUE THEN 1 ELSE 0 END) as active_count
             FROM admins a
             LEFT JOIN stations s ON s.admin_id = a.id
             WHERE a.role = 'manager'
             GROUP BY a.id
             ORDER BY a.created_at DESC`
        );
        res.json(rows);
    } catch (error) {
        console.error("Get managers error:", error);
        res.status(500).json({ error: "خطأ في جلب البيانات" });
    }
});

// Delete a manager
app.delete("/api/super/managers/:id", authenticateSuperAdmin, async (req, res) => {
    try {
        const [result] = await pool.query(
            "DELETE FROM admins WHERE id = ? AND role = 'manager'",
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "المدير غير موجود" });
        }
        res.json({ message: "تم حذف المدير وجميع محطاته" });
    } catch (error) {
        console.error("Delete manager error:", error);
        res.status(500).json({ error: "خطأ في الحذف" });
    }
});

// Get all stations (super admin view)
app.get("/api/super/stations", authenticateSuperAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.*, a.full_name as manager_name, a.username as manager_username
             FROM stations s
             JOIN admins a ON s.admin_id = a.id
             ORDER BY s.is_active DESC, s.last_status_update DESC`
        );
        res.json(rows);
    } catch (error) {
        console.error("Super get stations error:", error);
        res.status(500).json({ error: "خطأ في جلب البيانات" });
    }
});

// Serve pages
app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/admin.html"));
});

app.get("/superadmin", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/superadmin.html"));
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
});





















// Start server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on https://gas-station-kq3v.onrender.com:${PORT}`);
        console.log(`Map page: https://gas-station-kq3v.onrender.com:${PORT}`);
        console.log(`Admin page: https://gas-station-kq3v.onrender.com:${PORT}/admin`);
        console.log(`Super Admin: https://gas-station-kq3v.onrender.com:${PORT}/superadmin`);
    });
});