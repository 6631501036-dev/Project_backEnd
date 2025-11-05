// server/app.js
const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const multer = require("multer");
const con = require("./config/db");

const app = express();

// Middleware
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/image", express.static(path.join(__dirname, "asset/image"))); // serve images
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // รองรับ form data

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "asset/image/"); // save to asset/image folder
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // unique filename
    }
});
const upload = multer({ storage });

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

/*
  GET /asset
  - returns all assets
  - includes latest relevant request (Pending or Approved) per asset:
    request_id, borrower_id (or NULL)
  This allows client to determine:
    - who borrowed it
    - the related request id (for return requests)
*/
app.get("/asset", (req, res) => {
    // Step 1: Get assets and the latest request (Pending or Approved) per asset (if any)
    const borrowerId = 1; // Replace with actual logged-in student ID

  const query = `
    SELECT 
      a.asset_id,
      a.asset_name,
      a.asset_status,
      a.image,
      r.request_id,
      r.borrower_id,
      r.return_status
    FROM asset a
    LEFT JOIN request_log r
      ON a.asset_id = r.asset_id
      AND r.borrower_id = ?
      AND r.approval_status = 'Approved'
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
      image: row.image || 'uploads/default.jpg',
      request_id: row.request_id || null,
      borrower_id: row.borrower_id || null,
      return_status: row.return_status || 'Not Returned',
    }));

    res.json({ success: true, assets });
  });
});

// Borrow Asset
app.post("/borrower/borrow", (req, res) => {
    // Step 1: Validate input
    const { borrower_id, asset_id, borrow_date, return_date } = req.body;
    if (!borrower_id || !asset_id || !borrow_date || !return_date) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    con.beginTransaction((err) => {
        if (err) {
            console.error("Transaction error:", err);
            return res.status(500).json({ success: false, message: "Internal Server Error" });
        }

        // Step 2: Check if asset is Available
        const checkAssetSql = "SELECT asset_status FROM asset WHERE asset_id = ?";
        con.query(checkAssetSql, [asset_id], (err, result) => {
            if (err) return con.rollback(() => res.status(500).json({ success: false, message: "Database error" }));
            if (result.length === 0) return con.rollback(() => res.status(404).json({ success: false, message: "Asset not found" }));
            if (result[0].asset_status !== "Available") return con.rollback(() => res.status(409).json({ success: false, message: "Asset unavailable" }));

            // Step 3: Insert request_log as Pending
            const insertRequestSql = `
                INSERT INTO request_log (borrower_id, asset_id, borrow_date, return_date, approval_status, return_status)
                VALUES (?, ?, ?, ?, 'Pending', 'Not Returned')
            `;
            con.query(insertRequestSql, [borrower_id, asset_id, borrow_date, return_date], (err, result) => {
                if (err) return con.rollback(() => res.status(500).json({ success: false, message: "Database error" }));

                const requestId = result.insertId;

                // Step 4: Update asset status to Pending
                const updateAssetSql = "UPDATE asset SET asset_status = 'Pending' WHERE asset_id = ?";
                con.query(updateAssetSql, [asset_id], (err, updateResult) => {
                    if (err) return con.rollback(() => res.status(500).json({ success: false, message: "Database error" }));

                    // Step 5: Commit transaction
                    con.commit((err) => {
                        if (err) return con.rollback(() => res.status(500).json({ success: false, message: "Commit error" }));

                        // Step 6: Return updated asset info including the request_id (for the borrower)
                        const getAssetSql = `
                            SELECT 
                                a.asset_id,
                                a.asset_name,
                                a.asset_status,
                                a.description,
                                a.image,
                                r.request_id,
                                r.borrower_id,
                                r.approval_status,
                                r.return_status
                            FROM asset a
                            LEFT JOIN request_log r
                              ON a.asset_id = r.asset_id AND r.request_id = ?
                            WHERE a.asset_id = ?
                        `;

                        con.query(getAssetSql, [requestId, asset_id], (err, assets) => {
                            if (err) return res.status(500).json({ success: false, message: "Database error" });

                            res.status(200).json({
                                success: true,
                                message: "Borrow request submitted successfully",
                                asset: assets[0]
                            });
                        });
                    });
                });
            });
        });
    });
});

/*
  Add Asset (staff) - unchanged behaviour but kept for completeness
*/
app.post("/staff/addAsset", (req, res) => {
    const { name, description } = req.body;
    if (!name || !description) {
        return res.status(400).send('Name and description are required');
    }
    const checkAssetSql = "SELECT * FROM asset WHERE asset_name = ?";
    con.query(checkAssetSql, [name], (err, result) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).send('Internal Server Error');
        }
        if (result.length > 0) {
            return res.status(409).send('Asset already exists');
        }
        const imageUrl = '/uploads/default.jpg';
        const insertAssetSql = `
            INSERT INTO asset (asset_name, asset_status, description, image) 
            VALUES (?, 'Available', ?, ?)
        `;
        con.query(insertAssetSql, [name, description, imageUrl], (err, result) => {
            if (err) {
                console.error("Database Error:", err);
                return res.status(500).send('Internal Server Error');
            }
            res.status(201).json({
                asset_id: result.insertId,
                name,
                description,
                imageUrl
            });
        });
    });
});

/*
  Edit / Disable / Enable / Approve / Reject endpoints
  (same logic you had — left unchanged except kept formatting)
*/

// Edit Asset
app.put("/staff/editAsset/:id", upload.single("image"), (req, res) => {
    const assetId = req.params.id;
    const { name, description } = req.body;

    if (!name && !description && !req.file) {
        return res.status(400).send('At least one field is required to update');
    }

    con.query("SELECT * FROM asset WHERE asset_id = ?", [assetId], (err, rows) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).send('Internal Server Error');
        }
        if (rows.length === 0) {
            return res.status(404).send('Asset not found');
        }
        const currentAsset = rows[0];
        const updatedName = name || currentAsset.asset_name;
        const updatedDescription = description || currentAsset.description;
        const updatedImage = req.file ? `/asset/image/${req.file.filename}` : currentAsset.image;

        con.query(
            "UPDATE asset SET asset_name = ?, description = ?, image = ? WHERE asset_id = ?",
            [updatedName, updatedDescription, updatedImage, assetId],
            (updateErr, result) => {
                if (updateErr) {
                    console.error("Database error:", updateErr);
                    return res.status(500).send('Internal Server Error');
                }
                res.status(200).json({ message: `${updatedName} updated successfully` });
            }
        );
    });
});

// Disable Asset
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

// Approve Request (lender)
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

// Return Asset by Student (request return)
app.put("/student/returnAsset/:request_id", (req, res) => {
    const { request_id } = req.params;

    // Step 1: Only allow if request currently Approved and Not Returned
    // We'll ensure that student can only request return for an Approved & Not Returned request.
    const preCheckSql = `
        SELECT approval_status, return_status
        FROM request_log
        WHERE request_id = ?
    `;
    con.query(preCheckSql, [request_id], (err, rows) => {
        if (err) {
            console.error("Error requesting return:", err);
            return res.status(500).send("Internal Server Error");
        }
        if (rows.length === 0) {
            return res.status(400).send("Request not found");
        }
        const { approval_status, return_status } = rows[0];
        if (approval_status !== 'Approved' || return_status !== 'Not Returned') {
            return res.status(400).send("Return not allowed (must be Approved and Not Returned)");
        }

        const updateRequestQuery = `
            UPDATE request_log
            SET return_status = 'Requested Return'
            WHERE request_id = ? AND approval_status = 'Approved' AND return_status = 'Not Returned'
        `;

        con.query(updateRequestQuery, [request_id], (err, result) => {
            if (err) {
                console.error("Error requesting return:", err);
                return res.status(500).send("Internal Server Error");
            }

            if (result.affectedRows === 0) {
                return res.status(400).send("Return already requested or not allowed");
            }

            res.json({ message: "Return request submitted successfully" });
        });
    });
});

// Serve pages (unchanged)
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
