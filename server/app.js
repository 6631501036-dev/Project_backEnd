// server/app.js
const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const multer = require("multer");
const con = require("./config/db");
const cors = require("cors");
const app = express();
const jwt = require('jsonwebtoken');
// const { fail } = require("assert");
const JWT_KEY = 'm0bile2Simple';

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/public/image", express.static(path.join(__dirname, "public/image")));

// =======================================================
//  🔐 JWT Verification Middleware
// =======================================================
function verifyUser(req, res, next) {
   let token = req.headers['authorization'] || req.headers['x-access-token'];
   if (token == undefined || token == null) {
       // no token
       return res.status(400).send('No token');
   }


   // token found
   if (req.headers.authorization) {
       const tokenString = token.split(' ');
       if (tokenString[0] == 'Bearer') {
           token = tokenString[1];
       }
   }
   jwt.verify(token, JWT_KEY, (err, decoded) => {
       if (err) {
           res.status(401).send('Incorrect token');
       }
      else if (!['student', 'staff', 'lender'].includes(decoded.role)) {
           res.status(403).send('Forbidden: Invalid role');
       }
       else {
           // remember the decoded token
           req.decoded = decoded;
           // go further to the route
           next();
       }
   });
}


// =======================================================
//  🧩 File Upload Config
//   Multer สำหรับรับรูปจาก Flutter
// =======================================================
// 
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/image"); // เก็บในโฟลเดอร์ asset/image
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// =======================================================
//  🔐 Password Hash Tester
// =======================================================
app.get("/password/:pass", (req, res) => {
    const password = req.params.pass;
    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.status(500).send("Hashing error");
        res.send(hash);
    });
});

// =======================================================
//  👤 Register
// =======================================================
// Register endpoint บอสแก้
app.post('/register', function (req, res) {
    const { username, email, password: rawPassword, repassword } = req.body;
    const role = 1; // Default role: student

    if (rawPassword !== repassword) {
        return res.status(400).send('Passwords do not match');
    }//400 client ส่งมา ข้อมูลไม่ถูกต้อง

    const checkUsernameSql = "SELECT username FROM user WHERE username = ?";
    con.query(checkUsernameSql, [username], function (err, result) {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
        }//500 server มีปัญหา
        if (result.length > 0) {
            return res.status(409).send('Username already exists');
        } //client ส่งมา ขัดแย้งกับข้อมูลที่มีอยู่ในระบบแล้ว

        bcrypt.hash(rawPassword, 10, function (err, hash) {
            if (err) {
                return res.status(500).send('Internal Server Error');
            }

            const insertUserSql =
                "INSERT INTO user (email, username, password, role) VALUES (?, ?, ?, ?)";
            con.query(insertUserSql, [email, username, hash, role], function (err) {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Internal Server Error');
                }
                res.status(200).send('User registered successfully');
            });
        });
    });
});

// =======================================================
//  🔑 Login -------------------------- JWT encode / creation --------------
// =======================================================
app.post('/login', function (req, res) {
    const { username, password: raw } = req.body;
    const sql = "SELECT user_id, username, email, password, role FROM user WHERE username=?";

    con.query(sql, [username], function (err, result) {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
        }
        if (result.length !== 1) {
            return res.status(401).send('Wrong username or password');
        }

        bcrypt.compare(raw, result[0].password, function (err2, same) {
            if (err2) {
                console.error(err2);
                return res.status(500).send('Internal Server Error');
            }
            if (!same) {
                return res.status(401).send('Wrong username or password');
            }

            // Role Mapping
            const role = result[0].role;
            const eachRoles = { 1: 'student', 2: 'staff', 3: 'lender' };
            const eachRole = eachRoles[role];
            // JWT Payload
            const payload = { user_id: result[0].user_id, role: eachRole, username: result[0].username ,email: result[0].email, message: "User login successfully"};
            if (eachRole) {
                // Create JWT Token
                const token = jwt.sign(payload, JWT_KEY, { expiresIn: '1h' });
                return res.status(200).send(token);
            } else {
                return res.status(401).send('Wrong username or password');
            }
        });
    });
});
// =======================================================
//  🟢 STUDENT API SECTION 
// =======================================================

////////////////////////////////////////////////////////////
// 🟢 USER INFO
////////////////////////////////////////////////////////////
app.get("/api/user/:userId", (req, res) => {
    const userId = req.params.userId;
    const sql = "SELECT username FROM user WHERE user_id = ?";
    con.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (results.length === 0) return res.status(404).json({ error: "User not found" });
        res.json(results[0]);
    });
});

////////////////////////////////////////////////////////////
// 🟢 ASSET (Student Home)
////////////////////////////////////////////////////////////
app.get("/api/student/asset", (req, res) => {
  const borrowerId = req.query.borrower_id; 
  if (!borrowerId) {
    return res.status(400).json({ success: false, message: "Missing borrower_id" });
  }

  const sql = `
SELECT a.asset_id, a.asset_name, a.asset_status, a.image,
       r.request_id, r.borrower_id, r.return_status, r.approval_status
FROM asset a
LEFT JOIN (
    SELECT r1.*
    FROM request_log r1
    INNER JOIN (
        SELECT asset_id, MAX(request_id) AS max_request_id
        FROM request_log
        WHERE borrower_id = ?
        GROUP BY asset_id
    ) r2
    ON r1.asset_id = r2.asset_id AND r1.request_id = r2.max_request_id
) r
ON a.asset_id = r.asset_id
WHERE a.asset_status != 'Deleted'

`;


  con.query(sql, [borrowerId, borrowerId], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });

    const assets = results.map((row) => {
      let status = row.asset_status;

      if (row.asset_status === 'Disabled') {
        status = 'Disabled';
      } else if (row.return_status === 'Requested Return') {
        status = "Pending Return";
      } else if (row.return_status === 'Returned') {
        status = "Available";
      } else if (row.approval_status === "Approved") {
        status = "Borrowed";
      } else if (row.approval_status === "Rejected") {
        status = "Available";
      } else if (row.approval_status === "Pending") {
        status = "Pending";
      }
      return {
        asset_id: row.asset_id,
        asset_name: row.asset_name,
        asset_status: status || "Available",
        image: row.image || 'default.jpg',
        request_id: row.request_id || null,
        borrower_id: row.borrower_id || null,
        return_status: row.return_status || "Not Returned",
      };
    });

    res.json({ success: true, assets });
  });
});

////////////////////////////////////////////////////////////
// 🟢 BORROW REQUEST
////////////////////////////////////////////////////////////
app.post("/api/student/borrow", (req, res) => {
    const { borrower_id, asset_id, borrow_date, return_date } = req.body;

    if (!borrower_id || !asset_id || !borrow_date || !return_date) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // 🔹 ขั้นตอนที่ 1: ตรวจว่านักเรียนยืมของวันนี้ไปแล้วหรือยัง (และยังไม่คืน)
    const checkBorrowSql = `
  
SELECT request_id
FROM request_log
WHERE borrower_id = ?
AND return_status IN ('Not Returned', 'Requested Return') 
AND can_borrow_today = 0

`; // 💡 แก้ไข: เพิ่ม 'AND can_borrow_today = 0' เพื่อปลดล็อกการยืมซ้ำ

    con.query(checkBorrowSql, [borrower_id], (err, borrowCheck) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: "Database error" });
        }

        // 🔹 ถ้าเจอรายการที่กำลัง Active และ can_borrow_today = 0 → ห้ามยืมซ้ำ
        if (borrowCheck.length > 0) { // <--- บรรทัดที่ 329
            return res.status(403).json({
                success: false,
                message: "You have already borrowed today. Please return before borrowing again.",
            });
        }

        // 🔹 ขั้นตอนที่ 2: เริ่ม transaction เพื่อยืมของ
        con.beginTransaction((err) => {
            if (err) return res.status(500).json({ success: false, message: "Transaction error" });

            const checkAssetSql = "SELECT asset_status FROM asset WHERE asset_id = ?";
            con.query(checkAssetSql, [asset_id], (err, result) => {
                if (err) return con.rollback(() => res.status(500).json({ message: "Database error" }));
                if (result.length === 0)
                    return con.rollback(() => res.status(404).json({ message: "Asset not found" }));
                if (result[0].asset_status !== "Available")
                    return con.rollback(() => res.status(409).json({ message: "Asset unavailable" }));

                const insertSql = `
                    INSERT INTO request_log 
                        (borrower_id, asset_id, borrow_date, return_date, approval_status, return_status, can_borrow_today)
                    VALUES (?, ?, ?, ?, 'Pending', 'Not Returned', 0)
                `;
                con.query(insertSql, [borrower_id, asset_id, borrow_date, return_date], (err) => {
                    if (err)
                        return con.rollback(() => res.status(500).json({ message: "Insert error" }));

                    const updateAssetSql = "UPDATE asset SET asset_status = 'Pending' WHERE asset_id = ?";
                    con.query(updateAssetSql, [asset_id], (err) => {
                        if (err)
                            return con.rollback(() => res.status(500).json({ message: "Update error" }));

                        con.commit((err) => {
                            if (err)
                                return con.rollback(() => res.status(500).json({ message: "Commit error" }));

                            res.status(200).json({
                                success: true,
                                message: "Borrow request submitted successfully",
                            });
                        });
                    });
                });
            });
        });
    });
});

////////////////////////////////////////////////////////////
// 🟢 RETURN REQUEST (Student)
////////////////////////////////////////////////////////////
app.put("/api/student/returnAsset/:request_id",(req, res) => {
    const { request_id } = req.params;
    
    // 💡 NOTE: ใน endpoint นี้ เราต้องการตรวจสอบแค่สถานะของ request_id ที่ระบุ
    // ไม่ใช่การตรวจสอบการยืมซ้ำเหมือนใน endpoint /borrow
    const preCheck = `
        SELECT approval_status, return_status 
        FROM request_log 
        WHERE request_id = ?
    `;

    con.query(preCheck, [request_id], (err, rows) => { // ใช้ 'rows' แทน 'borrowCheck'
        if (err) return res.status(500).json({ message: "Database error" });
        if (rows.length === 0) return res.status(404).json({ message: "Request not found" });

        const { approval_status, return_status } = rows[0];

        // ตรวจสอบว่าสามารถกด Request Return ได้หรือไม่ (ต้อง Approved และยัง Not Returned)
        if (approval_status !== "Approved" || return_status !== "Not Returned")
            return res.status(400).json({ message: "Return not allowed (Status must be Approved and Not Returned)" });

        const updateSql = `
            UPDATE request_log
            SET return_status = 'Requested Return'
            WHERE request_id = ? AND approval_status = 'Approved' AND return_status = 'Not Returned'
        `;
        con.query(updateSql, [request_id], (err, result) => {
            if (err) return res.status(500).json({ message: "Update failed" });
            if (result.affectedRows === 0)
                return res.status(400).json({ message: "Return already requested or status mismatch" });
            res.json({ message: "Return request submitted successfully" });
        });
    });
});
////////////////////////////////////////////////////////////
// 🟢 STATUS PAGE
////////////////////////////////////////////////////////////
app.get("/api/student/status/:userId", (req, res) => {
  const userId = req.params.userId;
  const sql = `
 SELECT 
  rl.request_id,
  rl.borrow_date AS request_date,
  a.asset_name,
  CASE 
    WHEN rl.return_status = 'Requested Return' THEN 'Requested Return'
    WHEN rl.return_status = 'Returned' THEN 'Returned'
    WHEN rl.approval_status = 'Pending' THEN 'Pending'
    WHEN rl.approval_status = 'Approved' AND rl.return_status = 'Not Returned' THEN 'Borrowed'
    ELSE a.asset_status
  END AS asset_status,
  rl.can_borrow_today
FROM request_log rl
JOIN asset a ON rl.asset_id = a.asset_id
 WHERE rl.request_id = (
      SELECT MAX(request_id)
      FROM request_log
      WHERE borrower_id = ?
    );

;
`;
  con.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(results.length > 0 ? results[0] : null);
  });
});
////////////////////////////////////////////////////////////
// 🟢 HISTORY PAGE
////////////////////////////////////////////////////////////
app.get("/api/student/history/:userId", (req, res) => {
  const userId = req.params.userId;
  const sql = `
    SELECT 
      r.request_id,
      a.asset_name,
      r.borrow_date,
      r.return_date,
      r.approval_status AS request_status,
      r.return_status,
      lender.username AS lender_name,
      staff.username AS staff_name
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    LEFT JOIN user lender ON r.lender_id = lender.user_id
    LEFT JOIN user staff ON r.staff_id = staff.user_id
    WHERE r.borrower_id = ?
    ORDER BY r.request_id ASC;
  `;

  con.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(results);
  });
});

app.get("/api/lender/history/:userId", (req, res) => {
  const userId = req.params.userId;
  const sql = `
    SELECT 
      r.request_id,
      a.asset_name,
      r.borrow_date,
      r.return_date,
      r.approval_status AS request_status,
      lender.username AS lender_name,
      staff.username AS staff_name,
      u.username AS borrower_name
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    LEFT JOIN user lender ON r.lender_id = lender.user_id
    LEFT JOIN user staff ON r.staff_id = staff.user_id
    LEFT JOIN user u ON r.borrower_id = u.user_id
    WHERE (r.lender_id = ? OR r.staff_id = ?)
    ORDER BY r.borrow_date DESC;
  `;

  con.query(sql, [userId, userId], (err, results) => {
    if (err) {
      console.error("DB Error /api/lender/history:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
});

app.get("/api/staff/history", (req, res) => {
  const userId = req.params.userId;
  const sql = `
    SELECT 
      r.request_id,
      a.asset_name,
      r.borrow_date,
      r.return_date,
      r.approval_status AS request_status,
      u.username AS borrower_name,
      staff.username AS staff_name
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    LEFT JOIN user u ON r.borrower_id = u.user_id
    LEFT JOIN user staff ON r.staff_id = staff.user_id
    ORDER BY r.borrow_date DESC;
  `;

  con.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("DB Error /api/staff/history:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
});

// =======================================================
//  🟢 STAFF API SECTION 
// =======================================================
// Add Asset
app.post("/staff/addAsset", upload.single("image"), (req, res) => {
    const { name, description } = req.body;
    const imagePath = req.file ? `/public/image/${req.file.filename}` : "/public/image/default.jpg";

    if (!name || !description) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const sql = `
    INSERT INTO asset (asset_name, asset_status, description, image)
    VALUES (?, 'Available', ?, ?)
  `;
    con.query(sql, [name, description, imagePath], (err, result) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ success: false, message: "Database error" });
        }
        res.json({
            success: true,
            message: "Asset added successfully",
            asset_id: result.insertId,
            image: imagePath
        });
    });
});

// Edit Asset 
app.put("/staff/editAsset/:id", upload.single("image"), (req, res) => {
    const assetId = req.params.id;
    const { name, description } = req.body;

    let updateFields = [];
    let params = [];

    if (name) {
        updateFields.push("asset_name = ?");
        params.push(name);
    }
    if (description) {
        updateFields.push("description = ?");
        params.push(description);
    }
    if (req.file) {
        updateFields.push("image = ?");
        params.push(`/public/image/${req.file.filename}`);
    }

    if (updateFields.length === 0) {
        return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    const sql = `UPDATE asset SET ${updateFields.join(", ")} WHERE asset_id = ?`;
    params.push(assetId);

    con.query(sql, params, (err, result) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ success: false, message: "Database error" });
        }
        res.json({ success: true, message: "Asset updated successfully" });
    });
});

// Disable Asset
app.put("/staff/editAsset/:asset_id/disable", (req, res) => {
  const assetId = req.params.asset_id;
  const getAssetSql = "SELECT asset_name, asset_status FROM asset WHERE asset_id = ?";
  const updateStatusSql = "UPDATE asset SET asset_status = 'Disabled' WHERE asset_id = ?";

  con.query(getAssetSql, [assetId], (err, assetResult) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    if (assetResult.length === 0) return res.status(404).json({ success: false, message: "Asset not found" });

    const assetName = assetResult[0].asset_name;
    const currentStatus = assetResult[0].asset_status;

    // ถ้า Borrowed → ห้าม disable
    if (currentStatus === "Borrowed") {
      return res.status(400).json({
        success: false,
        message: `${assetName} is currently Borrowed and cannot be disabled.`,
      });
    }

    // เริ่ม transaction
    con.beginTransaction((err) => {
      if (err) return res.status(500).json({ success: false, message: "Transaction error" });

      // อัพเดต asset เป็น Disabled
      con.query(updateStatusSql, [assetId], (err, updateResult) => {
        if (err) return con.rollback(() => res.status(500).json({ success: false, message: "Update failed" }));

        // ถ้ามี request_log ที่ Pending ให้เปลี่ยนเป็น Rejected และ set can_borrow_today = 1
        const rejectPendingSql = `
          UPDATE request_log
          SET approval_status = 'Rejected',
              can_borrow_today = 1
          WHERE asset_id = ? AND approval_status = 'Pending'
        `;
        con.query(rejectPendingSql, [assetId], (err, rejectResult) => {
          if (err) return con.rollback(() => res.status(500).json({ success: false, message: "Failed to update requests" }));

          con.commit((err) => {
            if (err) return con.rollback(() => res.status(500).json({ success: false, message: "Commit failed" }));

            res.json({
              success: true,
              message: `${assetName} disabled successfully. Pending requests rejected.`,
              asset_id: assetId,
              status: "Disabled",
            });
          });
        });
      });
    });
  });
});

// Enable Asset
app.put("/staff/editAsset/:asset_id/enable", (req, res) => {
    const assetId = req.params.asset_id;
    const getAssetNameSql = "SELECT asset_name FROM asset WHERE asset_id = ?";
    const updateStatusSql = "UPDATE asset SET asset_status = 'Available' WHERE asset_id = ?";

    con.query(getAssetNameSql, [assetId], (err, result) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Asset not found' });
        }

        const assetName = result[0].asset_name;

        con.query(updateStatusSql, [assetId], (err, updateResult) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).json({ success: false, message: 'Update failed' });
            }

            if (updateResult.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Asset not found' });
            }

            res.json({
                success: true,
                message: `${assetName} is now Available`,
                asset_id: assetId,
                status: "Available"
            });
        });
    });
});

// DELETE Asset
app.delete("/staff/deleteAsset/:id", (req, res) => {
    const assetId = req.params.id;
    const sql = "DELETE FROM asset WHERE asset_id = ?";

    con.query(sql, [assetId], (err, result) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ success: false, message: "Database error" });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Asset not found" });
        }
        res.json({ success: true, message: "Asset deleted successfully" });
    });
});

//get assets
app.get("/assets", (req, res) => {
  // ไม่ต้อง verifyToken
  const sql = "SELECT * FROM asset";
  con.query(sql, (err, result) => {
    if (err) throw err;
    res.json({ assets: result });
  });
});

//get staff
app.get("/staff", verifyUser, (req, res) => {
  if (req.user.role !== 'staff') {
    return res.status(403).json({ success: false, message: "Access denied: not a staff" });
  }
  const staffId = req.user.user_id;
  const username = req.user.username;

  console.log(`Staff ${username} (ID: ${staffId}) accessed /staff/assets`);

  
});

//  Get Requests for Staff
app.get("/staff/request/:staff_id", (req, res) => {
  const staffId = req.params.staff_id;
  const sql = `
    SELECT 
      r.request_id AS id,
      a.asset_name AS name,
      a.image AS imagePath,
      r.borrow_date AS borrowDate,
      r.return_date AS returnDate,
      r.return_status AS returnStatus
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    WHERE r.staff_id = ? OR r.return_status = 'Requested Return';
  `;
  con.query(sql, [staffId], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "DB Error" });
    }
    res.json({ success: true, requests: result });
  });
});

////////////////////////////////////////////////////////////
// 🟢 STAFF RETURN ASSET (PUT)
////////////////////////////////////////////////////////////
app.put("/staff/returnAsset/:request_id", (req, res) => {
    const { request_id } = req.params;
    const { staff_id } = req.body;

    if (!staff_id) return res.status(400).json({ message: "staff_id is required" });

    con.beginTransaction((err) => {
        if (err) return res.status(500).json({ message: "Transaction error" });

        const getAssetQuery = `
            SELECT asset_id, borrower_id
            FROM request_log 
            WHERE request_id = ? AND approval_status = 'Approved' AND return_status != 'Returned'
        `;

        con.query(getAssetQuery, [request_id], (err, result) => {
            if (err) return con.rollback(() => res.status(500).json({ message: "Database error" }));
            if (result.length === 0) return con.rollback(() => res.status(400).json({ message: "Request not found or already returned" }));

            const assetId = result[0].asset_id;

            const updateRequestQuery = `
                UPDATE request_log
                SET return_status = 'Returned',
                    actual_return_date = NOW(),
                    staff_id = ?,
                    can_borrow_today = 1
                WHERE request_id = ?
            `;

            con.query(updateRequestQuery, [staff_id, request_id], (err, result) => {
                if (err) return con.rollback(() => res.status(500).json({ message: "Update failed" }));
                if (result.affectedRows === 0) return con.rollback(() => res.status(400).json({ message: "Failed to update request status" }));

                // asset status กลับเป็น Available
                const updateAssetQuery = `
                    UPDATE asset
                    SET asset_status = 'Available'
                    WHERE asset_id = ?
                `;

                con.query(updateAssetQuery, [assetId], (err, result) => {
                    if (err) return con.rollback(() => res.status(500).json({ message: "Asset update failed" }));

                    con.commit((err) => {
                        if (err) return con.rollback(() => res.status(500).json({ message: "Commit failed" }));

                        res.json({
                            success: true,
                            message: "Asset returned successfully. Student can borrow again today.",
                        });
                    });
                });
            });
        });
    });
});

// =======================================================
//  🟢 LENDER API SECTION 
// =======================================================
// GET Pending Requests for Lender
app.get("/lender/pending-requests", (req, res) => { 
    
    const sql = `
        SELECT 
            rl.request_id,
            a.asset_name,
            a.image AS asset_image,
            u.username AS borrower_name,
            rl.borrow_date
        FROM request_log rl
        JOIN asset a ON rl.asset_id = a.asset_id
        JOIN user u ON rl.borrower_id = u.user_id
        WHERE rl.approval_status = 'Pending'
        ORDER BY rl.borrow_date ASC;
    `;

    con.query(sql, (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ success: false, message: "Database error" });
        }
        res.json({ success: true, pendingRequests: results });
    });
});

//API สำหรับ Dashboard lender
// ✅ Fixed lender dashboard stats
app.get("/lender/asset-stats", (req, res) => {
  const sql = `
    SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN asset_status = 'Available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN asset_status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN asset_status = 'Borrowed' THEN 1 ELSE 0 END) AS borrowed,
        SUM(CASE WHEN asset_status = 'Disabled' THEN 1 ELSE 0 END) AS disabled
    FROM asset;
  `;

  con.query(sql, (err, results) => {
    if (err) {
      console.error("Database Error (Stats):", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    const stats = results && results.length > 0 ? results[0] : null;
    console.log("Lender Asset Stats:", stats); // <-- เพิ่มบรรทัดนี้ debug

    res.json({ success: true, stats });
  });
});


//get lender
app.get("/lender", verifyUser, (req, res) => {
  if (req.user.role !== 'lender') {
    return res.status(403).json({ success: false, message: "Access denied: not alenderstaff" });
  }

  const staffId = req.user.user_id;
  const username = req.user.username;

  console.log(`Lender ${username} (ID: ${lenderId}) accessed /lender/assets`);

  const sql = "SELECT * FROM asset";
  con.query(sql, (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    res.json({ success: true, assets: result, staff: { lenderId, username } });
  });
});
// Approve Request (lender)
app.put("/lender/borrowingRequest/:request_id/approve", (req, res) => {
    const { request_id } = req.params;
    const { lender_id } = req.body; // Pass lender_id in request body

    con.beginTransaction((err) => {
        if (err) {
            console.error("Transaction error:", err);
            return res.status(500).send("Internal Server Error");
        }

        // Step 1: Get asset_id from request_log
        const getAssetQuery = "SELECT asset_id FROM request_log WHERE request_id = ? AND approval_status = 'Pending'";

        con.query(getAssetQuery, [request_id], (err, result) => {
            if (err) {
                return con.rollback(() => {
                    console.error("Error fetching asset_id:", err);
                    res.status(500).send("Internal Server Error");
                });
            }

            if (result.length === 0) {
                return con.rollback(() => {
                    res.status(400).send("Request not found or already processed");
                });
            }

            const asset_id = result[0].asset_id;

            // Step 2: Approve the request
            const updateRequestQuery = `
                UPDATE request_log 
                SET approval_status = 'Approved', lender_id = ? 
                WHERE request_id = ? AND approval_status = 'Pending'
            `;

            con.query(updateRequestQuery, [lender_id, request_id], (err, result) => {
                if (err) {
                    return con.rollback(() => {
                        console.error("Error approving request:", err);
                        res.status(500).send("Internal Server Error");
                    });
                }

                if (result.affectedRows === 0) {
                    return con.rollback(() => {
                        res.status(400).send("Request not found or already processed");
                    });
                }

                // Step 3: Update asset_status to "Borrowed"
                const updateAssetQuery = `
                    UPDATE asset 
                    SET asset_status = 'Borrowed' 
                    WHERE asset_id = ?
                `;

                con.query(updateAssetQuery, [asset_id], (err, result) => {
                    if (err) {
                        return con.rollback(() => {
                            console.error("Error updating asset status:", err);
                            res.status(500).send("Internal Server Error");
                        });
                    }

                    con.commit((err) => {
                        if (err) {
                            return con.rollback(() => {
                                console.error("Transaction commit error:", err);
                                res.status(500).send("Internal Server Error");
                            });
                        }

                        res.json({ message: "Request approved successfully, asset marked as Borrowed" });
                    });
                });
            });
        });
    });
});


// Reject Request (No Transaction Version)
app.put("/lender/borrowingRequest/:request_id/reject", (req, res) => {
    const { request_id } = req.params;
    const { lender_id } = req.body; 

    // [แก้ไข] เราจะไม่ใช้ con.beginTransaction
    // เราจะยิง 3 คำสั่งต่อกัน (Chain)

    // Step 1: ดึง asset_id ออกมาก่อน (ยังจำเป็น)
    const getAssetQuery = "SELECT asset_id FROM request_log WHERE request_id = ? AND approval_status = 'Pending'";
    
    con.query(getAssetQuery, [request_id], (err, result) => {
        if (err) {
            console.error("REJECT Step 1 Error (getAssetQuery):", err);
            return res.status(500).send("Internal Server Error");
        }
        if (result.length === 0) {
            return res.status(400).send("Request not found or already processed");
        }
        
        // เก็บ asset_id ไว้
        const asset_id = result[0].asset_id;
        console.log(`>>> [REJECT - NoTx] Got asset_id: ${asset_id}`);

        // Step 2: อัปเดต request_log เป็น 'Rejected'
        const updateRequestQuery = `
            UPDATE request_log 
            SET approval_status = 'Rejected', lender_id = ?
            WHERE request_id = ? AND approval_status = 'Pending'
        `;

        con.query(updateRequestQuery, [lender_id, request_id], (err, result) => {
            if (err) {
                console.error("REJECT Step 2 Error (updateRequestQuery):", err);
                return res.status(500).send("Internal Server Error");
            }
            if (result.affectedRows === 0) {
                return res.status(400).send("Request already processed (log)");
            }
            
            console.log(`>>> [REJECT - NoTx] Updated request_log. Now updating asset...`);

            // Step 3: อัปเดต asset เป็น 'Available'
            const updateAssetQuery = `
                UPDATE asset 
                SET asset_status = 'Available' 
                WHERE asset_id = ?
            `;

            con.query(updateAssetQuery, [asset_id], (err, result) => {
                if (err) {
                    console.error("REJECT Step 3 Error (updateAssetQuery):", err);
                    // แม้ Step 3 พลาด เราก็ทำอะไรไม่ได้แล้ว (เพราะไม่มี Rollback)
                    return res.status(500).send("Internal Server Error (Step 3)");
                }
                
                console.log(`>>> [REJECT - NoTx] Asset updated to Available!`);
                res.json({ message: "Request rejected successfully (No Transaction)" });
            });
        });
    });
});

// =======================================================
//  🟢 Dashborad API SECTION 
// =======================================================

// Staff Dashboard
app.get("/staff/dashboard/:staff_id", (req, res) => {
  const staffId = req.params.staff_id;

  const sql = `
    SELECT
      (SELECT COUNT(*) FROM asset) AS total_assets,
      (SELECT COUNT(*) FROM asset WHERE asset_status = 'Available') AS available_assets,
      (SELECT COUNT(*) FROM asset WHERE asset_status = 'Borrowed') AS borrowed_assets,
      (SELECT COUNT(*) FROM asset WHERE asset_status = 'Disabled') AS disabled_assets,
      (SELECT COUNT(*) FROM request_log WHERE approval_status = 'Pending') AS pending_requests,
      (SELECT COUNT(*) FROM request_log WHERE return_status = 'Requested Return') AS requested_returns
  `;

  con.query(sql, [staffId], (err, result) => {
    if (err) {
      console.error("Dashboard Query Error:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    res.json({
      success: true,
      data: result[0],
    });
  });
});

// =======================================================
//  🟢 Notification API 
// =======================================================
let returnNotifications = 0;
// 📩 เพิ่มแจ้งเตือนเมื่อ student ขอคืนของ
app.post("/api/notifyReturn", (req, res) => {
  returnNotifications++;
  console.log(`🔔 แจ้งเตือนใหม่! รวมทั้งหมด: ${returnNotifications}`);
  res.json({ success: true, message: "แจ้งเตือนส่งไปยัง staff แล้ว" });
});

// 👀 ให้ staff ดูจำนวนแจ้งเตือน
app.get("/api/returnCount", (req, res) => {
  res.json({ count: returnNotifications });
});

// 🧹 ล้างแจ้งเตือนเมื่อ staff เปิดดูแล้ว
app.delete("/api/clearReturnNotifications", (req, res) => {
  returnNotifications = 0;
  console.log("✅ ล้างแจ้งเตือนทั้งหมดแล้ว");
  res.json({ success: true });
});
// =======================================================
//  🚀 START SERVER
// =======================================================
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server is running on port ${PORT}`);
});