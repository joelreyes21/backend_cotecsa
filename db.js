const mysql = require("mysql2");

console.log("📌 Variables recibidas por Railway:");
console.log("HOST:", process.env.MYSQLHOST);
console.log("USER:", process.env.MYSQLUSER);
console.log("DB:", process.env.MYSQLDATABASE);
console.log("PORT:", process.env.MYSQLPORT);

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
});

db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Error conectando a MySQL en Railway:", err);
  } else {
    console.log("✅ Conectado a MySQL Railway");
    connection.release();
  }
});

module.exports = db;
