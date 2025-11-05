const express = require("express");
const path = require("path");
const con = require("./config/db");
const app = express();

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/public", express.static(path.join(__dirname, "public")));

////////////////////////////////////////////////////////////
//                   🟢 USER INFO                         //
////////////////////////////////////////////////////////////
app.get("/api/user/:userId", (req, res) => {
  const userId = req.params.userId;
  const sql = "SELECT username FROM user WHERE user_id = ?";

  con.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(results[0]);
  });
});

////////////////////////////////////////////////////////////
//                   🟢 ASSET (Student Home)              //
////////////////////////////////////////////////////////////
app.get("/asset", (req, res) => {
  const borrowerId = 18; // <-- fix ชั่วคราว
  const sql = `
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

  con.query(sql, [borrowerId], (err, results) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    const assets = results.map((row) => ({
      asset_id: row.asset_id,
      asset_name: row.asset_name,
      asset_status: row.asset_status || "Available",
      image: row.image || "uploads/default.jpg",
      request_id: row.request_id || null,
      borrower_id: row.borrower_id || null,
      return_status: row.return_status || "Not Returned",
    }));

    res.json({ success: true, assets });
  });
});

////////////////////////////////////////////////////////////
//                   🟢 BORROW REQUEST                   //
////////////////////////////////////////////////////////////
app.post("/borrower/borrow", (req, res) => {
  const { borrower_id, asset_id, borrow_date, return_date } = req.body;

  if (!borrower_id || !asset_id || !borrow_date || !return_date) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  con.beginTransaction((err) => {
    if (err) {
      console.error("Transaction error:", err);
      return res.status(500).json({ success: false, message: "Transaction error" });
    }

    const checkSql = "SELECT asset_status FROM asset WHERE asset_id = ?";
    con.query(checkSql, [asset_id], (err, result) => {
      if (err) return con.rollback(() => res.status(500).json({ message: "Database error" }));
      if (result.length === 0)
        return con.rollback(() => res.status(404).json({ message: "Asset not found" }));
      if (result[0].asset_status !== "Available")
        return con.rollback(() => res.status(409).json({ message: "Asset unavailable" }));

      const insertSql = `
        INSERT INTO request_log (borrower_id, asset_id, borrow_date, return_date, approval_status, return_status)
        VALUES (?, ?, ?, ?, 'Pending', 'Not Returned')
      `;
      con.query(insertSql, [borrower_id, asset_id, borrow_date, return_date], (err) => {
        if (err) return con.rollback(() => res.status(500).json({ message: "Insert error" }));

        const updateSql = "UPDATE asset SET asset_status = 'Pending' WHERE asset_id = ?";
        con.query(updateSql, [asset_id], (err) => {
          if (err) return con.rollback(() => res.status(500).json({ message: "Update error" }));

          con.commit((err) => {
            if (err) return con.rollback(() => res.status(500).json({ message: "Commit error" }));
            res.status(200).json({ success: true, message: "Borrow request submitted successfully" });
          });
        });
      });
    });
  });
});

////////////////////////////////////////////////////////////
//                   🟢 RETURN REQUEST (Student)          //
////////////////////////////////////////////////////////////
app.put("/student/returnAsset/:request_id", (req, res) => {
  const { request_id } = req.params;

  const preCheck = `
    SELECT approval_status, return_status
    FROM request_log
    WHERE request_id = ?
  `;

  con.query(preCheck, [request_id], (err, rows) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (rows.length === 0)
      return res.status(404).json({ message: "Request not found" });

    const { approval_status, return_status } = rows[0];
    if (approval_status !== "Approved" || return_status !== "Not Returned") {
      return res.status(400).json({ message: "Return not allowed" });
    }

    const updateSql = `
      UPDATE request_log
      SET return_status = 'Requested Return'
      WHERE request_id = ? AND approval_status = 'Approved' AND return_status = 'Not Returned'
    `;
    con.query(updateSql, [request_id], (err, result) => {
      if (err) return res.status(500).json({ message: "Update failed" });
      if (result.affectedRows === 0)
        return res.status(400).json({ message: "Return already requested" });

      res.json({ message: "Return request submitted successfully" });
    });
  });
});

////////////////////////////////////////////////////////////
//                   🟢 STATUS PAGE                       //
////////////////////////////////////////////////////////////
app.get("/api/status/:userId", (req, res) => {
  const userId = req.params.userId;

  const sql = `
    SELECT 
      rl.request_id,
      rl.borrow_date AS request_date,
      a.asset_name,
      CASE 
        WHEN rl.return_status = 'Requested Return' THEN 'Requested Return'
        WHEN rl.approval_status = 'Pending' THEN 'Pending'
        WHEN rl.approval_status = 'Approved' AND rl.return_status = 'Not Returned' THEN 'Borrowed'
        ELSE a.asset_status
      END AS asset_status
    FROM request_log rl
    JOIN asset a ON rl.asset_id = a.asset_id
    WHERE rl.borrower_id = ?
      AND (
        rl.approval_status = 'Pending'
        OR (rl.approval_status = 'Approved' AND rl.return_status IN ('Not Returned', 'Requested Return'))
      )
    ORDER BY rl.borrow_date DESC
    LIMIT 1
  `;

  con.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results.length > 0 ? results[0] : null);
  });
});


////////////////////////////////////////////////////////////
//                   🟢 HISTORY PAGE                      //
////////////////////////////////////////////////////////////
app.get("/api/history/:userId", (req, res) => {
  const userId = req.params.userId;

  const sql = `
    SELECT
      rl.request_id,
      rl.approval_status AS request_status,
      rl.return_status,
      a.asset_name,
      rl.borrow_date,
      rl.return_date,
      lender.username AS lender_name,
      staff.username AS staff_name
    FROM request_log rl
    JOIN asset a ON rl.asset_id = a.asset_id
    LEFT JOIN user lender ON rl.lender_id = lender.user_id
    LEFT JOIN user staff ON rl.staff_id = staff.user_id
    WHERE rl.borrower_id = ?
      AND (
        (rl.approval_status = 'Rejected')
        OR (rl.approval_status = 'Approved' AND rl.return_status = 'Returned')
      )
    ORDER BY rl.return_date DESC
  `;

  con.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(results);
  });
});

////////////////////////////////////////////////////////////
//                   🟢 SERVER START                      //
////////////////////////////////////////////////////////////
const port = 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`✅ API Server running at port ${port}`);
});
