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



// Hash Password
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

// Login endpoint
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
            const eachRoles = { 1: 'borrower', 2: 'staff', 3: 'lender' };
            const eachRole = eachRoles[role];

            if (eachRole) {
                res.status(200).json({
                    message: "User login successfully",
                    role: eachRole,
                    // redirect: `/views/${eachRole}/home.html`
                });
            } else {
                return res.status(401).send('Wrong username or password');
            }
        });
    });
});

app.get("/asset", (req, res) => {
    const getAssetsSql = "SELECT asset_id, asset_name, asset_status, description, image FROM asset";
    con.query(getAssetsSql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: "Database error" });
        }
        res.json({ success: true, assets: results });
    });
});

// Borrow Asset
app.post("/borrower/borrow", (req, res) => {
    const { borrower_id, asset_id, borrow_date, return_date } = req.body;

    // 400 Bad Request - Missing required fields
    if (!borrower_id || !asset_id || !borrow_date || !return_date) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    con.beginTransaction((err) => {
        if (err) {
            console.error("Transaction error:", err);
            return res.status(500).json({ success: false, message: "Internal Server Error" });
        }

        // Step 1: Check if asset is available
        const checkAssetSql = "SELECT asset_status FROM asset WHERE asset_id = ?";
        con.query(checkAssetSql, [asset_id], (err, result) => {
            if (err) {
                return con.rollback(() => {
                    console.error("Database error:", err);
                    res.status(500).json({ success: false, message: "Internal Server Error" });
                });
            }
            if (result.length === 0) {
                return con.rollback(() => {
                    res.status(404).json({ success: false, message: "Asset not found" });
                });
            }
            if (result[0].asset_status !== "Available") {
                return con.rollback(() => {
                    res.status(409).json({ success: false, message: "Asset unavailable" });
                });
            }

            // Step 2: Insert borrow request
            const insertRequestSql = `
                INSERT INTO request_log (borrower_id, asset_id, borrow_date, return_date, approval_status)
                VALUES (?, ?, ?, ?, 'Pending')`;

            con.query(insertRequestSql, [borrower_id, asset_id, borrow_date, return_date], (err, result) => {
                if (err) {
                    return con.rollback(() => {
                        console.error("Database error:", err);
                        res.status(500).json({ success: false, message: "Internal Server Error" });
                    });
                }

                // Step 3: Update asset_status to "Pending"
                const updateAssetSql = "UPDATE asset SET asset_status = 'Pending' WHERE asset_id = ?";
                con.query(updateAssetSql, [asset_id], (err, updateResult) => {
                    if (err) {
                        return con.rollback(() => {
                            console.error("Database error:", err);
                            res.status(500).json({ success: false, message: "Internal Server Error" });
                        });
                    }

                    con.commit((err) => {
                        if (err) {
                            return con.rollback(() => {
                                console.error("Transaction commit error:", err);
                                res.status(500).json({ success: false, message: "Internal Server Error" });
                            });
                        }

                        res.status(200).json({
                            success: true,
                            message: "Borrow request submitted successfully",
                            request_id: result.insertId
                        });
                    });
                });
            });
        });
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

// Reject Request
app.put("/lender/borrowingRequest/:request_id/reject", (req, res) => {
    const { request_id } = req.params;
    const { lender_id } = req.body; // Pass lender_id in request body

    con.beginTransaction((err) => {
        if (err) {
            console.error("Transaction error:", err);
            return res.status(500).send("Internal Server Error");
        }

        // Step 1: Reject the request
        const updateRequestQuery = `
            UPDATE request_log 
            SET approval_status = 'Rejected', lender_id = ?
            WHERE request_id = ? AND approval_status = 'Pending'
        `;

        con.query(updateRequestQuery, [lender_id, request_id], (err, result) => {
            if (err) {
                return con.rollback(() => {
                    console.error("Error rejecting request:", err);
                    res.status(500).send("Internal Server Error");
                });
            }

            if (result.affectedRows === 0) {
                return con.rollback(() => {
                    res.status(400).send("Request not found or already processed");
                });
            }

            // Step 2: Update asset_status to "Available"
            const updateAssetQuery = `
                UPDATE asset 
                SET asset_status = 'Available' 
                WHERE asset_id = (SELECT asset_id FROM request_log WHERE request_id = ?)
            `;

            con.query(updateAssetQuery, [request_id], (err, result) => {
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

                    res.json({ message: "Request rejected successfully, asset marked as Available" });
                });
            });
        });
    });
});

// Return Asset by Staff
app.put("/staff/returnAsset/:request_id", (req, res) => {
    const { request_id } = req.params;
    const { staff_id } = req.body; // Pass staff_id in request body

    // Validate request
    if (!staff_id) {
        return res.status(400).json({ message: "staff_id is required" });
    }

    con.beginTransaction((err) => {
        if (err) {
            console.error("Transaction error:", err);
            return res.status(500).send("Internal Server Error");
        }

        // Step 1: Get asset_id from request_log
        const getAssetQuery = "SELECT asset_id FROM request_log WHERE request_id = ? AND approval_status = 'Approved' AND return_status IS NULL";

        con.query(getAssetQuery, [request_id], (err, result) => {
            if (err) {
                return con.rollback(() => {
                    console.error("Error fetching asset_id:", err);
                    res.status(500).send("Internal Server Error");
                });
            }

            if (result.length === 0) {
                return con.rollback(() => {
                    res.status(400).send("Request not found, already returned, or not approved");
                });
            }

            const asset_id = result[0].asset_id;

            // Step 2: Update request_log - Mark as Returned
            const updateRequestQuery = `
                UPDATE request_log 
                SET return_status = 'Returned', staff_id = ?, actual_return_date = NOW()
                WHERE request_id = ? AND return_status IS NULL
            `;

            con.query(updateRequestQuery, [staff_id, request_id], (err, result) => {
                if (err) {
                    return con.rollback(() => {
                        console.error("Error updating return status:", err);
                        res.status(500).send("Internal Server Error");
                    });
                }

                if (result.affectedRows === 0) {
                    return con.rollback(() => {
                        res.status(400).send("Request not found or already processed");
                    });
                }

                // Step 3: Update asset_status to "Available"
                const updateAssetQuery = `
                    UPDATE asset 
                    SET asset_status = 'Available' 
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

                        res.json({ message: "Asset returned successfully, marked as Available" });
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

// Serve the default page (index)
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
