// // server/app.js
const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const multer = require("multer");
const con = require("./config/db");
const app = express();
const cors = require("cors");

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/public/image", express.static(path.join(__dirname, "public/image")));

// 🧩 Multer สำหรับรับรูปจาก Flutter
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/image"); // เก็บในโฟลเดอร์ asset/image
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });



// // Hash Password
app.get("/password/:pass", function (req, res) {
    const password = req.params.pass;
    const saltRounds = 10;

    bcrypt.hash(password, saltRounds, function (err, hash) {
        if (err) {
            return res.status(500).send("Hashing error");
        }
        res.send(hash);
    });
});

// // Register endpoint บอสแก้
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

// // Login endpoint
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

            if (eachRole) {
                res.status(200).json({
                    message: "User login successfully",
                    role: eachRole,
                    username: result[0].username,
                    email: result[0].email,
                    user_id: result[0].user_id
                });
            } else {
                return res.status(401).send('Wrong username or password');
            }
        });
    });
});


// // ----------------- Fix /asset to accept borrower_id -----------------
app.get("/asset", (req, res) => {
  // อ่าน borrower_id จาก query string (optional)
  const borrowerId = req.query.borrower_id ? Number(req.query.borrower_id) : null;

  const query = `
    SELECT 
      a.asset_id,
      a.asset_name,
      a.asset_status,
      a.image,
      r.request_id,
      r.borrower_id,
      r.approval_status,
      r.return_status,
      r.borrow_date,
      r.return_date
    FROM asset a
    LEFT JOIN request_log r
      ON a.asset_id = r.asset_id
      AND r.borrower_id = ?
      AND r.approval_status IN ('Pending','Approved')
  `;

  con.query(query, [borrowerId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const assets = results.map(row => ({
      asset_id: row.asset_id,
      asset_name: row.asset_name,
      asset_status: row.asset_status || 'Available',
      image: row.image || '/public/image/default.jpg',
      request_id: row.request_id || null,
      borrower_id: row.borrower_id || null,
      approval_status: row.approval_status || null,
      return_status: row.return_status || 'Not Returned',
      borrow_date: row.borrow_date || null,
      return_date: row.return_date || null
    }));

    res.json({ success: true, assets });
  });
});

// // ====================== Borrower ===============================================
app.get("/borrower/status/:id", (req, res) => {
  const borrowerId = req.params.id;

  const sql = `
    SELECT 
      r.request_id,
      a.asset_name,
      a.image,
      r.borrow_date,
      r.return_date,
      r.approval_status,
      r.return_status,
      a.asset_status
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    WHERE r.borrower_id = ?
    ORDER BY r.request_id DESC
  `;

  con.query(sql, [borrowerId], (err, result) => {
    if (err) {
      console.error("❌ Fetch status error:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    res.json({ success: true, requests: result });
  });
});


app.get("/borrower/history/:id", (req, res) => {
  const borrowerId = req.params.id;

  const sql = `
    SELECT 
      r.request_id,
      a.asset_name,
      a.image,
      r.borrow_date,
      r.return_date,
      r.approval_status,
      lender.username AS lender_name,
      staff.username AS staff_name
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    LEFT JOIN user lender ON r.lender_id = lender.user_id
    LEFT JOIN user staff ON r.staff_id = staff.user_id
    WHERE r.borrower_id = ?
    ORDER BY r.borrow_date DESC
  `;

  con.query(sql, [borrowerId], (err, result) => {
    if (err) {
      console.error("❌ History fetch error:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    res.json({ success: true, history: result });
  });
});


// // ----------------- Borrower: borrow item -----------------
// app.post("/borrower/borrow", (req, res) => {
//   const { borrower_id, asset_id } = req.body;

//   if (!borrower_id || !asset_id) {
//     return res.status(400).json({ success: false, message: "Missing fields" });
//   }

//   // ตรวจสอบว่ายืมสินค้าชิ้นนี้หรือมีการยืมในวันเดียวกันไปแล้ว
//   const sqlCheck = `
//     SELECT * FROM request_log
//     WHERE borrower_id = ?
//       AND (borrow_date = CURDATE() OR (
//         asset_id = ? AND approval_status IN ('Pending','Approved')
//         AND return_status IN ('Not Returned','Requested Return')
//       ))
//   `;
//    con.query(sqlCheck, [borrower_id, asset_id], (err, result) => {
//     if (err) {
//       console.error("❌ Database error:", err);
//       return res.status(500).json({ success: false, message: "Database error" });
//     }

//     if (result.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "You already borrowed an item today or this item."
//       });
//     }

//     // ✅ borrow_date = วันนี้, return_date = พรุ่งนี้
//     const sqlInsert = `
//       INSERT INTO request_log (
//         borrower_id, asset_id, borrow_date, return_date,
//         approval_status, return_status
//       )
//       VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'Pending', 'Not Returned')
//     `;

//     const sqlUpdate = `UPDATE asset SET asset_status = 'Pending' WHERE asset_id = ?`;

//     con.beginTransaction(err => {
//       if (err)
//         return res.status(500).json({ success: false, message: "Transaction error" });

//       con.query(sqlInsert, [borrower_id, asset_id], (err) => {
//         if (err) {
//           console.error("❌ Insert failed:", err.sqlMessage || err);
//           return con.rollback(() =>
//             res.status(500).json({ success: false, message: "Insert failed" })
//           );
//         }

//         con.query(sqlUpdate, [asset_id], (err2) => {
//           if (err2) {
//             console.error("❌ Asset update failed:", err2.sqlMessage || err2);
//             return con.rollback(() =>
//               res.status(500).json({ success: false, message: "Asset update failed" })
//             );
//           }

//           con.commit(err3 => {
//             if (err3) {
//               console.error("❌ Commit failed:", err3.sqlMessage || err3);
//               return con.rollback(() =>
//                 res.status(500).json({ success: false, message: "Commit failed" })
//               );
//             }

//             console.log("✅ Borrow request submitted successfully");
//             res.json({ success: true, message: "Borrow request submitted successfully" });
//           });
//         });
//       });
//     });
//   });
// });

// ----------------- Borrower: borrow item (แก้ไขแล้ว) -----------------
app.post("/borrower/borrow", (req, res) => {
  const { borrower_id, asset_id } = req.body;

  if (!borrower_id || !asset_id) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  // 💡 SQL CHECK ที่แก้ไข:
  // ตรวจสอบว่าผู้ใช้มีการยืมสินค้าที่ยัง Active (Pending/Approved) และยังไม่ถูกคืน (Not Returned/Requested Return)
  // 1. ตรวจสอบว่ามีการยืม 'วันนี้' ที่ยังไม่คืน เพื่อจำกัดโควต้า 1 ครั้งต่อวัน
  // 2. ตรวจสอบว่ามียืมสินค้าชิ้นเดียวกันที่ยัง Pending/Approved อยู่หรือไม่
  const sqlCheck = `
    SELECT * FROM request_log
    WHERE borrower_id = ?
      AND (
        (
          borrow_date = CURDATE() 
          AND approval_status IN ('Pending','Approved')
          AND return_status IN ('Not Returned','Requested Return')
        )
        OR (
          asset_id = ? 
          AND approval_status IN ('Pending','Approved')
          AND return_status IN ('Not Returned','Requested Return')
        )
      )
  `;

  con.query(sqlCheck, [borrower_id, asset_id], (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    if (result.length > 0) {
      const activeBorrow = result.find(r => 
        r.borrow_date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]
      );
      if (activeBorrow) {
        return res.status(400).json({
          success: false,
          message: "You already have an active borrowing request today. Please return the current item first."
        });
      }
      // กรณีนี้คือพยายามยืม item เดิมที่ยัง Pending/Approved อยู่
      return res.status(400).json({
        success: false,
        message: "You already have a pending/approved request for this item."
      });
    }

    // ✅ borrow_date = วันนี้, return_date = พรุ่งนี้
    const sqlInsert = `
      INSERT INTO request_log (
        borrower_id, asset_id, borrow_date, return_date,
        approval_status, return_status
      )
      VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'Pending', 'Not Returned')
    `;

    const sqlUpdate = `UPDATE asset SET asset_status = 'Pending' WHERE asset_id = ?`;

    // เริ่ม Transaction
    con.beginTransaction(err => {
      if (err)
        return res.status(500).json({ success: false, message: "Transaction error" });

      con.query(sqlInsert, [borrower_id, asset_id], (err) => {
        if (err) {
          console.error("❌ Insert failed:", err.sqlMessage || err);
          return con.rollback(() =>
            res.status(500).json({ success: false, message: "Insert failed" })
          );
        }

        con.query(sqlUpdate, [asset_id], (err2) => {
          if (err2) {
            console.error("❌ Asset update failed:", err2.sqlMessage || err2);
            return con.rollback(() =>
              res.status(500).json({ success: false, message: "Asset update failed" })
            );
          }

          con.commit(err3 => {
            if (err3) {
              console.error("❌ Commit failed:", err3.sqlMessage || err3);
              return con.rollback(() =>
                res.status(500).json({ success: false, message: "Commit failed" })
              );
            }

            console.log("✅ Borrow request submitted successfully");
            res.json({ success: true, message: "Borrow request submitted successfully" });
          });
        });
      });
    });
  });
});



// ----------------- Borrower: return item -----------------
app.delete("/borrower/return/:request_id", (req, res) => {
  const requestId = req.params.request_id;

  // ดึง asset_id ก่อน
  const sqlFind = "SELECT asset_id FROM request_log WHERE request_id = ?";
  con.query(sqlFind, [requestId], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    if (result.length === 0)
      return res.status(404).json({ success: false, message: "Request not found" });

    const assetId = result[0].asset_id;

    // เริ่ม transaction
    con.beginTransaction(err => {
      if (err) return res.status(500).json({ success: false, message: "Transaction error" });

      // อัปเดต asset_status = Available
      const sqlUpdateAsset = "UPDATE asset SET asset_status = 'Available' WHERE asset_id = ?";
      con.query(sqlUpdateAsset, [assetId], (err2) => {
        if (err2) {
          return con.rollback(() =>
            res.status(500).json({ success: false, message: "Asset update failed" })
          );
        }

        // ลบ record ใน request_log
        const sqlDeleteLog = "DELETE FROM request_log WHERE request_id = ?";
        con.query(sqlDeleteLog, [requestId], (err3) => {
          if (err3) {
            return con.rollback(() =>
              res.status(500).json({ success: false, message: "Delete failed" })
            );
          }

          con.commit(err4 => {
            if (err4) {
              return con.rollback(() =>
                res.status(500).json({ success: false, message: "Commit failed" })
              );
            }
            res.json({ success: true, message: "Item returned successfully" });
          });
        });
      });
    });
  });
});

// ----------------- Borrower: return item (update version) -----------------
app.put("/borrower/return/:request_id", (req, res) => {
  const requestId = req.params.request_id;

  const sqlFind = "SELECT asset_id FROM request_log WHERE request_id = ?";
  con.query(sqlFind, [requestId], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    if (result.length === 0)
      return res.status(404).json({ success: false, message: "Request not found" });

    const assetId = result[0].asset_id;

    con.beginTransaction(err => {
      if (err) return res.status(500).json({ success: false, message: "Transaction error" });

      // อัปเดต asset_status = Available
      const sqlUpdateAsset = "UPDATE asset SET asset_status = 'Available' WHERE asset_id = ?";
      con.query(sqlUpdateAsset, [assetId], (err2) => {
        if (err2) {
          return con.rollback(() =>
            res.status(500).json({ success: false, message: "Asset update failed" })
          );
        }

        // อัปเดต return_status ใน request_log เป็น 'Returned'
        const sqlUpdateLog = "UPDATE request_log SET return_status = 'Returned', actual_return_date = NOW() WHERE request_id = ?";
        con.query(sqlUpdateLog, [requestId], (err3) => {
          if (err3) {
            return con.rollback(() =>
              res.status(500).json({ success: false, message: "Update request log failed" })
            );
          }

          con.commit(err4 => {
            if (err4) {
              return con.rollback(() =>
                res.status(500).json({ success: false, message: "Commit failed" })
              );
            }
            res.json({ success: true, message: "Item returned successfully" });
          });
        });
      });
    });
  });
});

// ----------------- Borrower: status return item -----------------
app.get("/borrower/status/:borrower_id", (req, res) => {
  const borrowerId = req.params.borrower_id;
  const sql = `
    SELECT
      r.request_id,
      a.asset_name,
      a.image,
      r.borrow_date,
      r.return_date,
      a.asset_status,
      r.approval_status,
      r.return_status
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    WHERE r.borrower_id = ?
    ORDER BY r.borrow_date DESC
  `;
  con.query(sql, [borrowerId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Database error" });
    }
    res.json({ success: true, requests: results });
  });
});


// ----------------- Borrower: history endpoint -----------------
app.get("/borrower/history/:borrower_id", (req, res) => {
  const borrowerId = req.params.borrower_id;

  const sql = `
    SELECT 
      r.request_id,
      a.asset_name,
      a.image,
      r.borrow_date,
      r.return_date,
      r.approval_status,
      r.return_status
    FROM request_log r
    JOIN asset a ON r.asset_id = a.asset_id
    WHERE r.borrower_id = ?
    ORDER BY r.borrow_date DESC
  `;

  con.query(sql, [borrowerId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Database error" });
    }
    res.json({ success: true, history: results });
  });
});


//====================== Staff ===============================================

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

/*
  Edit / Disable / Enable / Approve / Reject endpoints
  (same logic you had — left unchanged except kept formatting)
*/

// Edit Asset


// Disable Asset
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


app.put("/staff/editAsset/:asset_id/disable", (req, res) => {
    const assetId = req.params.asset_id;
    const getAssetNameSql = "SELECT asset_name FROM asset WHERE asset_id = ?";
    const updateStatusSql = "UPDATE asset SET asset_status = 'Disabled' WHERE asset_id = ?";

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
                message: `${assetName} is now Disabled`,
                asset_id: assetId,
                status: "Disabled"
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

// เพิ่มมาใหม่ Get Requests for Staff
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
    WHERE r.staff_id = ?;
  `;
});

//get all staff
app.get("/staff/assets", (req, res) => {
  const sql = "SELECT * FROM asset";
  con.query(sql, (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    res.json({ success: true, assets: result });
  });
});

//====================== Lender ===============================================

// Approve Request
app.put("/lender/borrowingRequest/:request_id/approve", (req, res) => {
    const { request_id } = req.params;
    const { lender_id } = req.body;

    con.beginTransaction((err) => {
        if (err) return res.status(500).send("Internal Server Error");

        // Step 1: find pending request
        const getAssetQuery = "SELECT asset_id FROM request_log WHERE request_id = ? AND approval_status = 'Pending'";
        con.query(getAssetQuery, [request_id], (err, result) => {
            if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
            if (result.length === 0) return con.rollback(() => res.status(400).send("Request not found or already processed"));

            const asset_id = result[0].asset_id;

            // Step 2: mark approved and set lender_id
            const updateRequestQuery = `
                UPDATE request_log 
                SET approval_status = 'Approved', lender_id = ? 
                WHERE request_id = ? AND approval_status = 'Pending'
            `;
            con.query(updateRequestQuery, [lender_id, request_id], (err, result) => {
                if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
                if (result.affectedRows === 0) return con.rollback(() => res.status(400).send("Request not found or already processed"));

                // Step 3: set asset to Borrowed
                const updateAssetQuery = `UPDATE asset SET asset_status = 'Borrowed' WHERE asset_id = ?`;
                con.query(updateAssetQuery, [asset_id], (err, result) => {
                    if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));

                    con.commit((err) => {
                        if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
                        res.json({ message: "Request approved successfully, asset marked as Borrowed" });
                    });
                });
            });
        });
    });
});

// Reject Request
app.put("/lender/borrowingRequest/:request_id/reject", (req, res) => {
    const { request_id } = req.params;
    const { lender_id } = req.body;

    con.beginTransaction((err) => {
        if (err) return res.status(500).send("Internal Server Error");

        const updateRequestQuery = `
            UPDATE request_log 
            SET approval_status = 'Rejected', lender_id = ?
            WHERE request_id = ? AND approval_status = 'Pending'
        `;
        con.query(updateRequestQuery, [lender_id, request_id], (err, result) => {
            if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
            if (result.affectedRows === 0) return con.rollback(() => res.status(400).send("Request not found or already processed"));

            const updateAssetQuery = `
                UPDATE asset 
                SET asset_status = 'Available' 
                WHERE asset_id = (SELECT asset_id FROM request_log WHERE request_id = ?)
            `;
            con.query(updateAssetQuery, [request_id], (err, result) => {
                if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));

                con.commit((err) => {
                    if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
                    res.json({ message: "Request rejected successfully, asset marked as Available" });
                });
            });
        });
    });
});

// Return Asset by Staff
app.put("/staff/returnAsset/:request_id", (req, res) => {
    const { request_id } = req.params;
    const { staff_id } = req.body;

    if (!staff_id) return res.status(400).json({ message: "staff_id is required" });

    con.beginTransaction((err) => {
        if (err) return res.status(500).send("Internal Server Error");

        const getAssetQuery = `
            SELECT asset_id 
            FROM request_log 
            WHERE request_id = ? 
              AND approval_status = 'Approved' 
              AND return_status = 'Requested Return'
        `;

        con.query(getAssetQuery, [request_id], (err, result) => {
            if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
            if (result.length === 0) return con.rollback(() => res.status(400).send("Return request not found or already processed"));

            const asset_id = result[0].asset_id;

            const updateRequestQuery = `
                UPDATE request_log
                SET return_status = 'Returned',
                    staff_id = ?,
                    actual_return_date = NOW()
                WHERE request_id = ? AND return_status = 'Requested Return'
            `;

            con.query(updateRequestQuery, [staff_id, request_id], (err, result) => {
                if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
                if (result.affectedRows === 0) return con.rollback(() => res.status(400).send("Request not found or already processed"));

                const updateAssetQuery = `UPDATE asset SET asset_status = 'Available' WHERE asset_id = ?`;
                con.query(updateAssetQuery, [asset_id], (err, result) => {
                    if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
                    con.commit((err) => {
                        if (err) return con.rollback(() => res.status(500).send("Internal Server Error"));
                        res.json({ message: "Asset return approved successfully" });
                    });
                });
            });
        });
    });
});



// Serve specific pages
app.get("/register", (req, res) => res.sendFile(path.join(__dirname, "")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "views/login.html")));
app.get("/logout", (req, res) => res.sendFile(path.join(__dirname, "views/index.html")));
// borrower
app.get("/borrower/home", (req, res) => res.sendFile(path.join(__dirname, "views/borrower/home.html")));
app.get("/borrower/reqStatus", (req, res) => res.sendFile(path.join(__dirname, "views/borrower/reqStatus.html")));
app.get("/borrower/history", (req, res) => res.sendFile(path.join(__dirname, "views/borrower/history.html")));
// staff
app.get("/staff/home", (req, res) => res.sendFile(path.join(__dirname, "views/staff/home.html")));
app.get("/staff/manage", (req, res) => res.sendFile(path.join(__dirname, "views/staff/assetManagement.html")));
app.get("/staff/dashboard", (req, res) => res.sendFile(path.join(__dirname, "views/staff/dashboard.html")));
app.get("/staff/history", (req, res) => res.sendFile(path.join(__dirname, "views/staff/history.html")));
// lender
app.get("/lender/home", (req, res) => res.sendFile(path.join(__dirname, "views/lender/home.html")));
app.get("/lender/borrowRequest", (req, res) => res.sendFile(path.join(__dirname, "views/lender/borrowingRequest.html")));
app.get("/lender/dashboard", (req, res) => res.sendFile(path.join(__dirname, "/views/lender/dashboard.html")));
app.get("/lender/history", (req, res) => res.sendFile(path.join(__dirname, "/views/lender/history.html")));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views/index.html")));

app.get('/views/:role/home.html', function (req, res) {
    const filePath = path.join(__dirname, `views/${req.params.role}/home.html`);
    res.sendFile(filePath);
});

//=================== Starting server =======================
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

