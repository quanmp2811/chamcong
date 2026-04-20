const path = require("path");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { WebSocketServer } = require("ws");
console.log("CLIENT_ID:", process.env.GOOGLE_CLIENT_ID);
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_PORT:", process.env.DB_PORT);
console.log("DB_USER:", process.env.DB_USER);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = path.resolve(__dirname, "../frontend");
const DB_CONFIG = {
  host: process.env.DB_HOST || "nozomi.proxy.rlwy.net",
  port: Number(process.env.DB_PORT || 42639),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "sWVLOJdiitcPIwZkIsVaAkRkVDuNFSbY",
  database: process.env.DB_NAME || "railway",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0
};
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/login.html"));
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});
let mysql = null;
let dbPool = null;
let dbEnabled = false;
let dbError = null;

// JWT middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

function authorizeAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());
app.use(express.static(FRONTEND_DIR));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cham-cong-backend",
    transport: ["http", "websocket"],
    database: {
      enabled: dbEnabled,
      driver: dbEnabled ? "mysql2" : null,
      name: DB_CONFIG.database,
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      fallback: "disabled",
      error: dbError
    }
  });
});

app.get("/api/cham-cong", authenticateToken, async (req, res) => {
  const { month, storeCode, employeeId } = req.query;

  try {
    ensureDatabaseConnected();
    const params = [];
    const conditions = [];

    if (month) {
      conditions.push("DATE_FORMAT(time, '%Y-%m') = ?");
      params.push(String(month));
    }

    if (storeCode) {
      conditions.push("ten = ?");
      params.push(String(storeCode));
    }

    if (employeeId) {
      conditions.push("employee_id = ?");
      params.push(String(employeeId));
    }

    const whereClause = conditions.length ? `AND ${conditions.join(" AND ")}` : "";
    const [rows] = await dbPool.query(`
      SELECT
        id,
        employee_id AS employeeId,
        employee_code AS employeeCode,
        employee_name AS employeeName,
        ten,
        time,
        status,
        note
      FROM cham_cong
      WHERE ten IS NOT NULL
      ${whereClause}
      ORDER BY time DESC
    `, params);

    res.json(rows);
  } catch (error) {
    handleApiError(res, error, "Cannot load attendance data");
  }
});

app.post("/api/cham-cong", authenticateToken, async (req, res) => {
  const payload = req.body || {};

  try {
    ensureDatabaseConnected();
    const employees = await getEmployeesData();
    const stores = await getStoresData();
    const time = payload.time || new Date().toISOString();
    const employee =
      employees.find((item) => item.id === payload.employeeId) ||
      employees.find((item) => item.code === payload.employeeCode);
    const store =
      stores.find((item) => item.code === payload.ten) ||
      stores.find((item) => item.code === payload.storeCode) ||
      stores.find((item) => item.id === payload.storeId);

    const record = {
      id: `cc${Date.now()}`,
      employeeId: employee?.id || payload.employeeId || null,
      employeeCode: employee?.code || payload.employeeCode || null,
      employeeName: employee?.name || payload.employeeName || null,
      ten: store?.code || payload.ten || payload.storeCode || null,
      time,
      status: payload.status || "present",
      note: payload.note || ""
    };

    if (!record.ten) {
      res.status(400).json({ ok: false, message: "Missing store code" });
      return;
    }

    await dbPool.query(
      `
        INSERT INTO cham_cong (
          id,
          employee_id,
          employee_code,
          employee_name,
          ten,
          time,
          status,
          note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.employeeId,
        record.employeeCode,
        record.employeeName,
        record.ten,
        toMysqlDateTime(record.time),
        record.status,
        record.note
      ]
    );

    broadcast({
      type: "attendance:created",
      payload: record,
      timestamp: new Date().toISOString()
    });

    res.status(201).json({ ok: true, data: record });
  } catch (error) {
    handleApiError(res, error, "Cannot create attendance record");
  }
});

app.get("/api/nhan-vien", authenticateToken, async (_req, res) => {
  try {
    ensureDatabaseConnected();
    res.json(await getEmployeesData());
  } catch (error) {
    handleApiError(res, error, "Cannot load employees");
  }
});

app.get("/api/stores", authenticateToken, async (_req, res) => {
  try {
    ensureDatabaseConnected();
    res.json(await getStoresData());
  } catch (error) {
    handleApiError(res, error, "Cannot load stores");
  }
});

app.get("/api/khu-vuc", async (_req, res) => {
  try {
    ensureDatabaseConnected();
    res.json(await getRegionsData());
  } catch (error) {
    handleApiError(res, error, "Cannot load regions");
  }
});

app.post("/api/auth/google", async (req, res) => {
  const { token } = req.body;
  console.log("TOKEN:", token);
  console.log("CLIENT_ID:", process.env.GOOGLE_CLIENT_ID);

  try {
    ensureDatabaseConnected();

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const avatar = payload.picture || null;

    const [rows] = await dbPool.query(
      "SELECT * FROM users WHERE google_id = ? OR email = ? LIMIT 1",
      [googleId, email]
    );

    let user;

    if (rows.length) {
      user = rows[0];
    } else {
      // 🔥 Super admin hardcoded - không sửa/xóa
      if (email === "phamquan28112004@gmail.com") {
        let role = "admin";
        let store_code = null;

        await dbPool.query(
          "INSERT INTO users (google_id, email, name, avatar, role, store_code) VALUES (?, ?, ?, ?, ?, ?)",
          [googleId, email, name, avatar, role, store_code]
        );

        user = { google_id: googleId, email, name, avatar, role, store_code };
      } else {
        res.status(403).json({ message: "Tài khoản không có quyền truy cập" });
        return;
      }
    }

    if (user.id) {
      await dbPool.query(
        `
          UPDATE users
          SET google_id = ?, email = ?, name = ?, avatar = ?
          WHERE id = ?
        `,
        [googleId, email, name, avatar, user.id]
      );
      user = { ...user, google_id: googleId, email, name, avatar };
    }

    res.json({
      token: jwt.sign({ email: user.email, name: user.name, role: user.role, store_code: user.store_code }, process.env.JWT_SECRET, { expiresIn: '24h' }),
      user: { email: user.email, name: user.name, role: user.role, store_code: user.store_code }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || "Internal server error" });
  }
});

app.get("/api/index-data", async (_req, res) => {
  try {
    ensureDatabaseConnected();
    res.json(await getIndexData());
  } catch (error) {
    handleApiError(res, error, "Cannot load index data");
  }
});
app.post("/api/stores", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    console.log("STORE BODY:", req.body);

    let { code, name, region, manager } = req.body;

    // 🔥 chuẩn hóa dữ liệu
    code = code?.trim();
    name = name?.trim();
    region = region?.trim();
    manager = manager?.trim() || null;

    // 🔥 validate
    if (!code || !name || !region) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu mã, tên hoặc khu vực"
      });
    }

    // 🔥 check khu vực
    ensureDatabaseConnected();

    const [regionRows] = await dbPool.query(
      "SELECT id, ma_khu_vuc FROM khu_vuc WHERE ten_khu_vuc = ? LIMIT 1",
      [region]
    );

    if (!regionRows.length) {
      return res.status(400).json({
        ok: false,
        message: "Khu vực không tồn tại"
      });
    }

    const regionData = regionRows[0];

    // 🔥 check trùng mã đơn vị
    const [exist] = await dbPool.query(
      "SELECT 1 FROM don_vi WHERE ma_don_vi = ? LIMIT 1",
      [code]
    );

    if (exist.length) {
      return res.status(409).json({
        ok: false,
        message: "Mã đơn vị đã tồn tại"
      });
    }

    // 🔥 tìm dòng NULL
    const [empty] = await dbPool.query(`
      SELECT id FROM don_vi
      WHERE ma_don_vi IS NULL
      LIMIT 1
    `);
    
    let storeId;
    
    if (empty.length > 0) {
      // ✅ update dòng rỗng
      await dbPool.query(`
        UPDATE don_vi
        SET ma_don_vi=?, ten_don_vi=?, khu_vuc_id=?, nguoi_phu_trach=?
        WHERE id=?
      `, [code, name, regionData.id, manager, empty[0].id]);
    
      storeId = empty[0].id;
    
    } else {
      // ✅ insert mới
      const [result] = await dbPool.query(`
        INSERT INTO don_vi (ma_don_vi, ten_don_vi, khu_vuc_id, nguoi_phu_trach)
        VALUES (?, ?, ?, ?)
      `, [code, name, regionData.id, manager]);
    
      storeId = result.insertId;
    }

    // 🔥 check đã có quản lý chưa
    const [existManager] = await dbPool.query(`
      SELECT id FROM nhan_vien
      WHERE store_code = ? AND role = 'Quản lý'
      LIMIT 1
    `, [code]);
    
    if (!existManager.length && manager) {
      await createDefaultManagerForStore(dbPool, {
        storeId,
        storeCode: code,
        managerName: manager
      });
    }

    res.status(201).json({
      ok: true,
      message: "Tạo đơn vị thành công",
      data: {
        id: storeId,
        code,
        name,
        region: region,
        manager
      }
    });
    
    } catch (error) {
      console.error("🔥 CREATE STORE ERROR:", error);
      res.status(500).json({
        ok: false,
        message: error.message,
        stack: error.stack
      });
    }
});
app.put("/api/stores/:code", authenticateToken, authorizeAdmin, async (req, res) => {
  const currentCode = String(req.params.code || "");
  const payload = normalizeStorePayload(req.body || {}, currentCode);
  const requiresManager = payload.region !== "TPKD/QLV";

  if (!payload.code || !payload.name || !payload.region || (requiresManager && !payload.manager)) {
    res.status(400).json({ ok: false, message: "Missing store code, name, region or manager" });
    return;
  }

  try {
    ensureDatabaseConnected();
    const region = await findRegionByName(payload.region);
    if (!region) {
      res.status(400).json({ ok: false, message: "Region not found" });
      return;
    }

    const [duplicateRows] = await dbPool.query(
      "SELECT 1 FROM don_vi WHERE ma_don_vi = ? AND ma_don_vi <> ? LIMIT 1",
      [payload.code, currentCode]
    );
    if (duplicateRows.length) {
      res.status(409).json({ ok: false, message: "Store code already exists" });
      return;
    }

    const [result] = await dbPool.query(
      `
        UPDATE don_vi
        SET ma_don_vi = ?, ten_don_vi = ?, khu_vuc_id = ?, nguoi_phu_trach = ?
        WHERE ma_don_vi = ?
      `,
      [payload.code, payload.name, region.id, payload.manager, currentCode]
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ ok: false, message: "Store not found" });
      return;
    }

    res.json({ ok: true, data: { ...payload, regionCode: region.code } });
  } catch (error) {
    handleApiError(res, error, "Cannot update store");
  }
});

app.delete("/api/stores/:code", authenticateToken, authorizeAdmin, async (req, res) => {
  const code = String(req.params.code || "");

  try {
    ensureDatabaseConnected();

    const [result] = await dbPool.query(`
      UPDATE don_vi 
      SET 
        ma_don_vi = NULL,
        ten_don_vi = NULL,
        khu_vuc_id = NULL,
        nguoi_phu_trach = NULL
      WHERE ma_don_vi = ?
    `, [code]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Store not found" });
    }

    res.json({ ok: true, message: "Đã reset đơn vị (không xoá)" });
  } catch (error) {
    handleApiError(res, error, "Cannot soft delete store");
  }
});
app.get("/api/khu-vuc", async (_req, res) => {
  try {
    ensureDatabaseConnected();

    const [rows] = await dbPool.query(`
      SELECT
        id,
        ma_khu_vuc AS code,
        ten_khu_vuc AS name,
        nguoi_quan_ly AS manager
      FROM khu_vuc
      WHERE ma_khu_vuc IS NOT NULL
        AND ten_khu_vuc IS NOT NULL
      ORDER BY ten_khu_vuc
    `);

    res.json(rows);
  } catch (error) {
    handleApiError(res, error, "Cannot load regions");
  }
});

app.post("/api/khu-vuc", authenticateToken, authorizeAdmin, async (req, res) => {
  const { code, name, manager } = req.body;

  console.log("DEBUG: POST /api/khu-vuc req.body =", req.body);

  if (!code || !name) {
    return res.status(400).json({ ok: false, message: "Thiếu code hoặc name" });
  }

  try {
    ensureDatabaseConnected();

    // check trùng
    const [exist] = await dbPool.query(
      "SELECT 1 FROM khu_vuc WHERE ma_khu_vuc = ? LIMIT 1",
      [code]
    );

    if (exist.length) {
      return res.status(409).json({ ok: false, message: "Khu vực đã tồn tại" });
    }

    // tìm slot rỗng
    const [empty] = await dbPool.query(`
      SELECT id FROM khu_vuc
      WHERE ma_khu_vuc IS NULL
      LIMIT 1
    `);

    if (empty.length > 0) {
      await dbPool.query(`
        UPDATE khu_vuc
        SET ma_khu_vuc=?, ten_khu_vuc=?, nguoi_quan_ly=?
        WHERE id=?
      `, [code, name, manager || null, empty[0].id]);

    } else {
      await dbPool.query(`
        INSERT INTO khu_vuc (ma_khu_vuc, ten_khu_vuc, nguoi_quan_ly)
        VALUES (?, ?, ?)
      `, [code, name, manager || null]);
    }

    res.json({ ok: true });

  } catch (error) {
    handleApiError(res, error, "Cannot create region");
  }
});

app.put("/api/khu-vuc/:code", authenticateToken, authorizeAdmin, async (req, res) => {
  const oldCode = req.params.code;
  const { code, name, manager } = req.body;

  console.log("DEBUG: PUT /api/khu-vuc req.body =", req.body);

  if (!code || !name) {
    return res.status(400).json({ ok: false, message: "Thiếu dữ liệu" });
  }

  try {
    ensureDatabaseConnected();

    const [dup] = await dbPool.query(
      "SELECT 1 FROM khu_vuc WHERE ma_khu_vuc=? AND ma_khu_vuc<>?",
      [code, oldCode]
    );

    if (dup.length) {
      return res.status(409).json({ ok: false, message: "Trùng mã khu vực" });
    }

    const [result] = await dbPool.query(`
      UPDATE khu_vuc
      SET ma_khu_vuc=?, ten_khu_vuc=?, nguoi_quan_ly=?
      WHERE ma_khu_vuc=?
    `, [code, name, manager || null, oldCode]);

    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy khu vực" });
    }

    res.json({ ok: true });

  } catch (error) {
    handleApiError(res, error, "Cannot update region");
  }
});
app.delete("/api/khu-vuc/:code", authenticateToken, authorizeAdmin, async (req, res) => {
  const code = req.params.code;

  try {
    ensureDatabaseConnected();

    // 🔥 CHECK ĐANG ĐƯỢC DÙNG
    const [used] = await dbPool.query(`
      SELECT 1 
      FROM don_vi 
      WHERE khu_vuc_id = (
        SELECT id FROM khu_vuc WHERE ma_khu_vuc = ?
      )
      LIMIT 1
    `, [code]);

    if (used.length) {
      return res.status(400).json({
        ok: false,
        message: "Khu vực đang chứa đơn vị, không thể xóa"
      });
    }

    // 🔥 XOÁ (RESET NULL)
    const [result] = await dbPool.query(`
      UPDATE khu_vuc
      SET 
        ma_khu_vuc = NULL,
        ten_khu_vuc = NULL
      WHERE ma_khu_vuc = ?
    `, [code]);

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        message: "Không tìm thấy khu vực"
      });
    }

    res.json({ ok: true });

  } catch (error) {
    handleApiError(res, error, "Cannot delete region");
  }
});

app.get("/api/ca-lam", authenticateToken, async (_req, res) => {
  try {
    ensureDatabaseConnected();
    const [rows] = await dbPool.query(`
      SELECT id, ma_ca AS code, name,
        start_time AS startTime, end_time AS endTime
      FROM ca_lam ORDER BY id
    `);
    res.json(rows);
  } catch (error) {
    handleApiError(res, error, "Cannot get shifts");
  }
});

app.post("/api/ca-lam", authenticateToken, authorizeAdmin, async (req, res) => {
  const { code, name, startTime, endTime } = req.body;
  if (!code || !name) return res.status(400).json({ ok: false, message: "Thiếu mã ca hoặc tên ca" });
  try {
    ensureDatabaseConnected();
    const [exist] = await dbPool.query("SELECT 1 FROM ca_lam WHERE ma_ca = ? LIMIT 1", [code]);
    if (exist.length) return res.status(409).json({ ok: false, message: "Mã ca đã tồn tại" });
    await dbPool.query(
      "INSERT INTO ca_lam (ma_ca, name, start_time, end_time) VALUES (?, ?, ?, ?)",
      [code, name, startTime || null, endTime || null]
    );
    res.json({ ok: true });
  } catch (error) {
    handleApiError(res, error, "Cannot create shift");
  }
});

app.put("/api/ca-lam/:code", authenticateToken, authorizeAdmin, async (req, res) => {
  const oldCode = req.params.code;
  const { code, name, startTime, endTime } = req.body;
  if (!code || !name) return res.status(400).json({ ok: false, message: "Thiếu dữ liệu" });
  try {
    ensureDatabaseConnected();
    const [dup] = await dbPool.query("SELECT 1 FROM ca_lam WHERE ma_ca=? AND ma_ca<>?", [code, oldCode]);
    if (dup.length) return res.status(409).json({ ok: false, message: "Trùng mã ca" });
    const [result] = await dbPool.query(
      "UPDATE ca_lam SET ma_ca=?, name=?, start_time=?, end_time=? WHERE ma_ca=?",
      [code, name, startTime || null, endTime || null, oldCode]
    );
    if (!result.affectedRows) return res.status(404).json({ ok: false, message: "Không tìm thấy ca" });
    res.json({ ok: true });
  } catch (error) {
    handleApiError(res, error, "Cannot update shift");
  }
});

app.delete("/api/ca-lam/:code", authenticateToken, authorizeAdmin, async (req, res) => {
  const code = req.params.code;
  try {
    ensureDatabaseConnected();
    const [result] = await dbPool.query("DELETE FROM ca_lam WHERE ma_ca=?", [code]);
    if (!result.affectedRows) return res.status(404).json({ ok: false, message: "Không tìm thấy ca" });
    res.json({ ok: true });
  } catch (error) {
    handleApiError(res, error, "Cannot delete shift");
  }
});

app.get("/api/users", authenticateToken, authorizeAdmin, async (_req, res) => {
  try {
    ensureDatabaseConnected();
    const [rows] = await dbPool.query(`
      SELECT
        email,
        name,
        role,
        store_code AS storeCode
      FROM users
      ORDER BY email
    `);
    res.json(rows);
  } catch (error) {
    handleApiError(res, error, "Cannot load users");
  }
});

app.post("/api/users", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    console.log("BODY:", req.body); // 🔥 debug

    let { email, name, role, storeCode } = req.body;

    // 🔥 trim dữ liệu (rất quan trọng)
    email = email?.trim();
    name = name?.trim();
    role = role?.trim();

    // 🔥 validate cơ bản
    if (!email || !name || !role) {
      return res.status(400).json({ ok: false, message: "Thiếu email, name hoặc role" });
    }

    // 🔥 validate role
    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({ ok: false, message: "Role phải là admin hoặc user" });
    }

    // 🔥 chuẩn hóa storeCode
    if (role === "admin") {
      storeCode = null;
    } else {
      storeCode = storeCode?.trim() || null;

      if (!storeCode) {
        return res.status(400).json({ ok: false, message: "User cần storeCode" });
      }
    }

    ensureDatabaseConnected();

    // 🔥 check email tồn tại
    const [exist] = await dbPool.query(
      "SELECT 1 FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (exist.length) {
      return res.status(409).json({ ok: false, message: "Email đã tồn tại" });
    }

    // 🔥 tìm dòng NULL
    const [empty] = await dbPool.query(`
      SELECT id FROM users
      WHERE email IS NULL
      LIMIT 1
    `);
    
    if (empty.length > 0) {
      // ✅ update dòng rỗng
      await dbPool.query(`
        UPDATE users
        SET email=?, name=?, role=?, store_code=?
        WHERE id=?
      `, [email, name, role, storeCode || null, empty[0].id]);
    
    } else {
      // ✅ insert mới
      await dbPool.query(`
        INSERT INTO users (email, name, role, store_code)
        VALUES (?, ?, ?, ?)
      `, [email, name, role, storeCode || null]);
    }

    res.json({ ok: true, message: "Đã thêm user" });

  } catch (error) {
    console.error("CREATE USER ERROR:", error);
    handleApiError(res, error, "Cannot create user");
  }
});

app.put("/api/users/:email", authenticateToken, authorizeAdmin, async (req, res) => {
  const { email } = req.params;
  const { name, role, storeCode } = req.body;

  if (!name || !role) {
    return res.status(400).json({ ok: false, message: "Thiếu name hoặc role" });
  }

  if (role !== "admin" && role !== "user") {
    return res.status(400).json({ ok: false, message: "Role phải là admin hoặc user" });
  }

  if (role === "user" && !storeCode) {
    return res.status(400).json({ ok: false, message: "User cần storeCode" });
  }

  // 🔥 Super admin không cho sửa role
  if (email === "phamquan28112004@gmail.com" && role !== "admin") {
    return res.status(403).json({ ok: false, message: "Không thể thay đổi role của super admin" });
  }

  try {
    ensureDatabaseConnected();

    const result = await dbPool.query(
      "UPDATE users SET name = ?, role = ?, store_code = ? WHERE email = ?",
      [name, role, storeCode || null, email]
    );

    if (!result[0].affectedRows) {
      return res.status(404).json({ ok: false, message: "User không tìm thấy" });
    }

    res.json({ ok: true });
  } catch (error) {
    handleApiError(res, error, "Cannot update user");
  }
});

app.delete("/api/users/:email", authenticateToken, authorizeAdmin, async (req, res) => {
  const { email } = req.params;

  // 🔥 Super admin không cho xóa
  if (email === "phamquan28112004@gmail.com") {
    return res.status(403).json({ ok: false, message: "Không thể xóa super admin" });
  }

  try {
    ensureDatabaseConnected();

    const result = await dbPool.query(
      "DELETE FROM users WHERE email = ?",
      [email]
    );

    if (!result[0].affectedRows) {
      return res.status(404).json({ ok: false, message: "User không tìm thấy" });
    }

    // Gửi signal logout đến frontend
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'auth:logout',
          payload: { email }
        }));
      }
    });

    res.json({ ok: true });
  } catch (error) {
    handleApiError(res, error, "Cannot delete user");
  }
});

app.post("/api/events", (req, res) => {
  const message = {
    type: req.body?.type || "attendance:update",
    payload: req.body?.payload || {},
    timestamp: new Date().toISOString()
  };

  broadcast(message);
  res.status(202).json({ ok: true, delivered: countClients(), message });
});

app.get("/ring", (req, res) => {
  console.log("🔔 Có người bấm chuông!");
  broadcast({
    type: "ring",
    payload: {},
    timestamp: new Date().toISOString()
  });
  res.send("OK");
});

app.get("/app/*", (req, res) => {
  const requestedPath = path.resolve(FRONTEND_DIR, `.${req.path}`);

  if (!requestedPath.startsWith(FRONTEND_DIR)) {
    res.status(404).end();
    return;
  }

  res.sendFile(requestedPath, (error) => {
    if (error) {
      res.sendFile(path.join(FRONTEND_DIR, "index.html"));
    }
  });
});

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "system:welcome",
      payload: {
        message: "WebSocket connected"
      },
      timestamp: new Date().toISOString()
    })
  );

  socket.on("message", (rawMessage) => {
    try {
      const parsedMessage = JSON.parse(rawMessage.toString());
      const message = {
        type: parsedMessage?.type || "attendance:update",
        payload: parsedMessage?.payload || {},
        timestamp: new Date().toISOString()
      };

      broadcast(message);
    } catch (_error) {
      socket.send(
        JSON.stringify({
          type: "system:error",
          payload: {
            message: "Invalid JSON payload"
          },
          timestamp: new Date().toISOString()
        })
      );
    }
  });
});

start();
app.post("/api/schedules", authenticateToken, async (req, res) => {
  try {
    ensureDatabaseConnected();

    const { nhan_vien_id, ngay, ca_id } = req.body;

    if (!nhan_vien_id || !ngay || !ca_id) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu dữ liệu"
      });
    }

    // 🔥 xử lý ca_id (số hoặc mã)
    let shiftId = ca_id;

    if (isNaN(ca_id)) {
      const [rows] = await dbPool.query(
        "SELECT id FROM ca_lam WHERE ma_ca = ? LIMIT 1",
        [ca_id]
      );
      shiftId = rows[0]?.id;
    }

    if (!shiftId) {
      return res.status(400).json({
        ok: false,
        message: "Ca không tồn tại"
      });
    }

    // 🔥 CHECK có chưa
    const [exist] = await dbPool.query(`
      SELECT id FROM lich_lam_viec
      WHERE nhan_vien_id = ? AND ngay = ?
      LIMIT 1
    `, [nhan_vien_id, ngay]);

    if (exist.length > 0) {
      // 🔥 UPDATE nếu đã có
      await dbPool.query(`
        UPDATE lich_lam_viec
        SET ca_id = ?, start_time = '08:00:00', end_time = '17:30:00'
        WHERE id = ?
      `, [shiftId, exist[0].id]);

    } else {
      // 🔥 INSERT nếu chưa có
      await dbPool.query(`
        INSERT INTO lich_lam_viec (nhan_vien_id, ngay, ca_id, start_time, end_time)
        VALUES (?, ?, ?, '08:00:00', '17:30:00')
      `, [nhan_vien_id, ngay, shiftId]);
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("SAVE SCHEDULE ERROR:", err);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/history", authenticateToken, async (req, res) => {
  try {
    ensureDatabaseConnected();

    const { month } = req.query; // format: YYYY-MM

    let sql = `
      SELECT
        nhan_vien_id, ten_nhan_vien AS employee,
        khu_vuc AS region, cua_hang AS store,
        DATE_FORMAT(ngay, '%Y-%m-%d') AS dateLabel,
        tu_ca AS fromShift, sang_ca AS toShift,
        nguoi_sua AS editor,
        DATE_FORMAT(thoi_gian, '%H:%i:%s %d/%m/%Y') AS time
      FROM lich_su_chinh_sua
    `;
    const params = [];

    if (month) {
      sql += ` WHERE DATE_FORMAT(thoi_gian, '%Y-%m') = ?`;
      params.push(month);
    }

    sql += ` ORDER BY thoi_gian DESC LIMIT 500`;

    const [rows] = await dbPool.query(sql, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error("GET HISTORY ERROR:", err);
    res.status(500).json({ ok: false, data: [] });
  }
});

app.post("/api/history", authenticateToken, async (req, res) => {
  try {
    ensureDatabaseConnected();

    const { nhan_vien_id, ten_nhan_vien, khu_vuc, cua_hang, ngay, tu_ca, sang_ca, nguoi_sua } = req.body;

    await dbPool.query(`
      INSERT INTO lich_su_chinh_sua
        (nhan_vien_id, ten_nhan_vien, khu_vuc, cua_hang, ngay, tu_ca, sang_ca, nguoi_sua)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [nhan_vien_id, ten_nhan_vien, khu_vuc, cua_hang, ngay, tu_ca, sang_ca, nguoi_sua]);

    res.json({ ok: true });
  } catch (err) {
    console.error("SAVE HISTORY ERROR:", err);
    res.status(500).json({ ok: false });
  }
});

async function start() {
  await initializeDatabase();

  server.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
    console.log(`Serving frontend from ${FRONTEND_DIR}`);
    console.log(`WebSocket endpoint ws://localhost:${PORT}/ws`);

    if (dbEnabled) {
      console.log(`MySQL connected to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    } else {
      console.log("MySQL not connected");
    }
  });
}

async function initializeDatabase() {
  try {
    mysql = require("mysql2/promise");
    dbPool = mysql.createPool(DB_CONFIG);
    await dbPool.query("SELECT 1");
    await ensureSchema();
    dbEnabled = true;
    dbError = null;
  } catch (error) {
    console.error("DB CONNECTION FAILED:", error.message);
    console.error("DB_CONFIG:", {
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      user: DB_CONFIG.user,
      database: DB_CONFIG.database,
      // password ẩn
    });
    dbEnabled = false;
    dbError = error.message;
  }
}

async function ensureSchema() {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS khu_vuc (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ma_khu_vuc VARCHAR(50) UNIQUE,
      ten_khu_vuc VARCHAR(255),
      nguoi_quan_ly VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await ensureColumn("khu_vuc", "ma_khu_vuc", "VARCHAR(50) NULL");
  await ensureColumn("khu_vuc", "ten_khu_vuc", "VARCHAR(255) NULL");
  await ensureColumn("khu_vuc", "nguoi_quan_ly", "VARCHAR(255) NULL");
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      google_id VARCHAR(255) UNIQUE,
      email VARCHAR(255) UNIQUE,
      name VARCHAR(255),
      avatar TEXT,
      store_code VARCHAR(64) DEFAULT NULL,
      role VARCHAR(50) DEFAULT 'user'
    )
  `);
  await ensureColumn("users", "google_id", "VARCHAR(255) NULL");
  await ensureColumn("users", "avatar", "TEXT NULL");
  await ensureColumn("users", "store_code", "VARCHAR(64) NULL");
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS don_vi (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ma_don_vi VARCHAR(50) UNIQUE,
      ten_don_vi VARCHAR(255),
      khu_vuc_id INT,
      nguoi_phu_trach VARCHAR(255)
    )
  `);
  await ensureColumn("don_vi", "ma_don_vi", "VARCHAR(50) NULL");
  await ensureColumn("don_vi", "ten_don_vi", "VARCHAR(255) NULL");
  await ensureColumn("don_vi", "khu_vuc_id", "INT NULL");
  await ensureColumn("don_vi", "nguoi_phu_trach", "VARCHAR(255) NULL");

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      city VARCHAR(255) DEFAULT NULL
    )
  `);
  await ensureColumn("stores", "code", "VARCHAR(64) NOT NULL UNIQUE");
  await ensureColumn("stores", "name", "VARCHAR(255) NOT NULL");
  await ensureColumn("stores", "city", "VARCHAR(255) DEFAULT NULL");
  await ensureColumn("stores", "region", "VARCHAR(255) DEFAULT NULL");
  await ensureColumn("stores", "manager", "VARCHAR(255) DEFAULT NULL");

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS nhan_vien (
      id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      store_code VARCHAR(64) DEFAULT NULL,
      role VARCHAR(255) DEFAULT NULL
    )
  `);
  await ensureColumn("nhan_vien", "code", "VARCHAR(64) NULL");
  await ensureColumn("nhan_vien", "name", "VARCHAR(255) NULL");
  await ensureColumn("nhan_vien", "store_code", "VARCHAR(64) DEFAULT NULL");
  await ensureColumn("nhan_vien", "role", "VARCHAR(255) DEFAULT NULL");

  await dbPool.query(`
    UPDATE nhan_vien
    SET
      code = COALESCE(NULLIF(code, ''), NULLIF(ma_nv, '')),
      name = COALESCE(NULLIF(name, ''), NULLIF(ten_nv, ''))
    WHERE
      (code IS NULL OR code = '' OR name IS NULL OR name = '')
  `).catch(() => {});

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS cham_cong (
      id VARCHAR(64) PRIMARY KEY,
      employee_id VARCHAR(64) DEFAULT NULL,
      employee_code VARCHAR(64) DEFAULT NULL,
      employee_name VARCHAR(255) DEFAULT NULL,
      ten VARCHAR(64) NOT NULL,
      time DATETIME NOT NULL,
      status VARCHAR(50) DEFAULT 'present',
      note TEXT DEFAULT NULL,
      INDEX idx_cham_cong_time (time),
      INDEX idx_cham_cong_store (ten),
      INDEX idx_cham_cong_employee (employee_id)
    )
  `)
    // 🔥 BẢNG LỊCH LÀM VIỆC
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS lich_lam_viec (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nhan_vien_id VARCHAR(64),
        ngay DATE,
        ca_id INT,
        start_time TIME DEFAULT '08:00:00',
        end_time TIME DEFAULT '17:30:00'
      )
    `);
    
    // 🔥 BẢNG LỊCH SỬ CHỈNH SỬA
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS lich_su_chinh_sua (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nhan_vien_id VARCHAR(64),
        ten_nhan_vien VARCHAR(255),
        khu_vuc VARCHAR(255),
        cua_hang VARCHAR(255),
        ngay DATE,
        tu_ca VARCHAR(50),
        sang_ca VARCHAR(50),
        nguoi_sua VARCHAR(255),
        thoi_gian TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ca_lam (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ma_ca VARCHAR(50) UNIQUE,
      name VARCHAR(255)
    )
  `);
  await ensureColumn("ca_lam", "start_time", "TIME NULL");
  await ensureColumn("ca_lam", "end_time", "TIME NULL");
}

async function getStoresData() {
  const [legacyStoreCountRows] = await dbPool.query("SELECT COUNT(*) AS total FROM don_vi");
  if (Number(legacyStoreCountRows[0]?.total || 0) > 0) {
    const [rows] = await dbPool.query(`
      SELECT
        don_vi.id,
        don_vi.ma_don_vi AS code,
        don_vi.ten_don_vi AS name,
        khu_vuc.ten_khu_vuc AS region,
        don_vi.nguoi_phu_trach AS manager,
        khu_vuc.ma_khu_vuc AS regionCode
      FROM don_vi
      LEFT JOIN khu_vuc ON khu_vuc.id = don_vi.khu_vuc_id
      WHERE don_vi.ma_don_vi IS NOT NULL
      ORDER BY don_vi.ma_don_vi
    `);

    return rows;
  }

  const [rows] = await dbPool.query(
    `
      SELECT
        id,
        code,
        name,
        city,
        region,
        manager,
        NULL AS regionCode
      FROM stores
      WHERE code IS NOT NULL
      AND name IS NOT NULL
      ORDER BY code
    `
  );

  return rows;
}

async function getRegionsData() {
  const [rows] = await dbPool.query(`
    SELECT
      id,
      ma_khu_vuc AS code,
      ten_khu_vuc AS name,
      nguoi_quan_ly AS manager
    FROM khu_vuc
    WHERE ma_khu_vuc IS NOT NULL
      AND ten_khu_vuc IS NOT NULL
    ORDER BY ten_khu_vuc
  `);

  return rows;
}

async function getEmployeesData() {
  const [rows] = await dbPool.query(`
    SELECT
      id,
      code,
      name,
      store_code AS storeCode,
      role
    FROM nhan_vien
    WHERE code IS NOT NULL
    ORDER BY code
  `);

  return rows;
}

async function getShiftsData() {
  const [rows] = await dbPool.query(`
    SELECT
      id,
      ma_ca AS code,
      name,
      start_time AS startTime,
      end_time AS endTime
    FROM ca_lam
    ORDER BY id
  `);

  return rows;
}

async function getWorkSchedules() {
  const [rows] = await dbPool.query(`
    SELECT
      llv.id,
      llv.nhan_vien_id AS employeeId,
      llv.ngay AS date,
      llv.ca_id AS shiftId,
      COALESCE(ca.start_time, llv.start_time) AS startTime,
      COALESCE(ca.end_time, llv.end_time) AS endTime
    FROM lich_lam_viec llv
    LEFT JOIN ca_lam ca ON ca.id = llv.ca_id
  `);

  return rows;
}

async function getWorkSchedulesData() {
  const [rows] = await dbPool.query(`
    SELECT
      llv.id,
      llv.nhan_vien_id AS employeeId,
      llv.ngay AS date,
      llv.ca_id AS shiftId,
      COALESCE(ca.start_time, llv.start_time) AS startTime,
      COALESCE(ca.end_time, llv.end_time) AS endTime
    FROM lich_lam_viec llv
    LEFT JOIN ca_lam ca ON ca.id = llv.ca_id
    ORDER BY llv.ngay, llv.id
  `);

  return rows;
}
async function getIndexData() {
  const [regions, units, employees, shifts, workSchedules] = await Promise.all([
    getRegionsData(),
    getStoresData(),
    getEmployeesData(),
    getShiftsData(),
    getWorkSchedulesData()
  ]);

  // 🔥 AUTO FIX DATA
  for (const store of units) {
    const hasEmployee = employees.some(e => e.storeCode === store.code);
    const hasSchedule = workSchedules.some(ws => {
      const emp = employees.find(e => e.id === ws.employeeId);
      return emp && emp.storeCode === store.code;
    });

    if (!hasEmployee || !hasSchedule) {
      console.log("⚠️ Auto tạo dữ liệu cho store:", store.code);

      await createDefaultManagerForStore(dbPool, {
        storeId: store.id,
        storeCode: store.code,
        managerName: store.manager || "Quản lý Store"
      });
    }
  }

  // 🔥 load lại sau khi tạo
  const updatedEmployees = await getEmployeesData();
  const updatedSchedules = await getWorkSchedulesData();

  return {
    regions,
    units,
    employees: updatedEmployees,
    shifts,
    workSchedules: updatedSchedules
  };
}


function handleApiError(res, error, message) {
  res.status(error.statusCode || 500).json({
    ok: false,
    message,
    error: error.message
  });
}

function toMysqlDateTime(value) {
  return new Date(value).toISOString().slice(0, 19).replace("T", " ");
}

function broadcast(message) {
  const data = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function countClients() {
  let count = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      count += 1;
    }
  });

  return count;
}

function normalizeStorePayload(payload, fallbackCode = "") {
  const code = String(payload.code || fallbackCode || "").trim().toUpperCase();
  const city = String(payload.city || "").trim() || null;
  const region = String(payload.region || "").trim();
  const manager = String(payload.manager || "").trim();
  const id = String(payload.id || slugify(code || `store-${Date.now()}`)).trim();

  return {
    id,
    code,
    name: String(payload.name || "").trim(),
    city,
    region,
    manager
  };
}

async function findRegionByName(regionName) {
  if (!regionName) return null;

  const [rows] = await dbPool.query(`
    SELECT id, ma_khu_vuc AS code, ten_khu_vuc AS name
    FROM khu_vuc
    WHERE TRIM(LOWER(ten_khu_vuc)) = TRIM(LOWER(?))
      AND ten_khu_vuc IS NOT NULL
    LIMIT 1
  `, [regionName]);

  return rows[0] || null;
}

async function createDefaultManagerForStore(connection, { storeId, storeCode, managerName }) {

  // Tìm hoặc tạo nhân viên quản lý
  const [exist] = await connection.query(`
    SELECT id FROM nhan_vien
    WHERE store_code = ? AND role = 'Quản lý'
    LIMIT 1
  `, [storeCode]);

  let employeeId;

  if (exist.length) {
    employeeId = exist[0].id;
  } else {
    const finalName = managerName || "Quản lý Store";
    const managerCode = `${storeCode}-QL`;
    employeeId = `nv_${Date.now()}`;

    await connection.query(`
      INSERT INTO nhan_vien (id, code, name, store_code, role)
      VALUES (?, ?, ?, ?, ?)
    `, [employeeId, managerCode, finalName, storeCode, "Quản lý"]);
  }

  // Lấy id ca QLS
  const shiftId = await ensureManagerShift(connection);

  // Tạo lịch tuần hiện tại, bỏ qua ngày đã có
  const today = new Date();
  const startOfWeek = new Date(today);
  const day = startOfWeek.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  startOfWeek.setDate(startOfWeek.getDate() + diff);

  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(date.getDate() + i);

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const formattedDate = `${yyyy}-${mm}-${dd}`;

    const [existSchedule] = await connection.query(`
      SELECT id FROM lich_lam_viec
      WHERE nhan_vien_id = ? AND ngay = ?
      LIMIT 1
    `, [employeeId, formattedDate]);

    if (!existSchedule.length) {
      await connection.query(`
        INSERT INTO lich_lam_viec (nhan_vien_id, ngay, ca_id)
        VALUES (?, ?, ?)
      `, [employeeId, formattedDate, shiftId]);
    }
  }
}
async function ensureManagerShift(connection) {
  const [rows] = await connection.query(`
    SELECT id FROM ca_lam
    WHERE ma_ca = 'CA QLS'
    LIMIT 1
  `);

  if (rows[0]?.id) {
    return rows[0].id;
  }

  const [insertResult] = await connection.query(`
    INSERT INTO ca_lam (ma_ca, name)
    VALUES ('CA QLS', 'Ca quản lý')
  `);

  return insertResult.insertId;
}
function getCurrentWeekDates() {
  const today = new Date();
  const monday = new Date(today);
  const day = monday.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const date = String(current.getDate()).padStart(2, "0");
    return `${year}-${month}-${date}`;
  });
}

async function ensureColumn(tableName, columnName, definition) {
  const [rows] = await dbPool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  if (rows.length === 0) {
    await dbPool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function getColumnType(tableName, columnName) {
  const [rows] = await dbPool.query(
    `
      SELECT DATA_TYPE
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows[0]?.DATA_TYPE || null;
}

async function getTableCount(tableName) {
  const [[row]] = await dbPool.query(`SELECT COUNT(*) AS total FROM ${tableName}`);
  return Number(row.total || 0);
}

function ensureDatabaseConnected() {
  if (!dbEnabled || !dbPool) {
    const error = new Error(dbError || "Database is not connected");
    error.statusCode = 503;
    throw error;
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
