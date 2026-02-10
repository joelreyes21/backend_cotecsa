const mysql = require("mysql2");

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  ssl: {
    // Railway usa certificados auto-firmados → así evitamos el error HANDSHAKE_SSL_ERROR
    rejectUnauthorized: false
  }
});

db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Error conectando a MySQL Railway:", err);
  } else {
    console.log("✅ Conectado a MySQL Railway");
    connection.release();
  }
});

module.exports = db;
