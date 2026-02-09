const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =========================
   ENDPOINT DE REGISTRO
========================= */
app.post("/register", async (req, res) => {
  const { nombre, correo, telefono, password } = req.body;

  // 🔎 Validaciones básicas
  if (!nombre || !correo || !telefono || !password) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO usuarios (nombre_completo, correo, telefono, contrasena)
      VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [nombre, correo, telefono, hash], err => {
      if (err) {
        // 📧 Correo duplicado
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(400).json({ error: "El correo ya está registrado" });
        }
        console.error(err);
        return res.status(500).json({ error: "Error al registrar usuario" });
      }

      res.json({ mensaje: "Usuario registrado correctamente" });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* =========================
   ENDPOINT DE LOGIN
========================= */
app.post("/login", (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: "Correo y contraseña requeridos" });
  }

  const sql = "SELECT * FROM usuarios WHERE correo = ?";

  db.query(sql, [correo], async (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error del servidor" });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const usuario = results[0];
    const match = await bcrypt.compare(password, usuario.contrasena);

    if (!match) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    res.json({
      mensaje: "Login correcto",
      usuario: {
        id: usuario.id_usuario,
        nombre: usuario.nombre_completo,
        correo: usuario.correo,
        rol: usuario.rol
      }
    });
  });
});

/* =========================
   OBTENER USUARIOS
========================= */
app.get("/usuarios", (req, res) => {
  const sql = `
    SELECT
      id_usuario AS id,
      nombre_completo AS nombre,
      correo,
      telefono,
      rol
    FROM usuarios
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener usuarios" });
    }
    res.json(results);
  });
});

/* =========================
   ELIMINAR USUARIO
========================= */
app.delete("/usuarios/:id", (req, res) => {
  const { id } = req.params;

  // 1️⃣ Buscar usuario
  db.query(
    "SELECT rol FROM usuarios WHERE id_usuario = ?",
    [id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error de base de datos" });
      }

      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const usuario = rows[0];

      // 2️⃣ Contar admins
      db.query(
        "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin'",
        (err, result) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error de base de datos" });
          }

          const admins = result[0].total;

          // 3️⃣ Proteger último admin
          if (usuario.rol === "admin" && admins <= 1) {
            return res.status(400).json({
              error: "Debe existir al menos un administrador"
            });
          }

          // 4️⃣ Eliminar
          db.query(
            "DELETE FROM usuarios WHERE id_usuario = ?",
            [id],
            err => {
              if (err) {
                console.error(err);
                return res
                  .status(500)
                  .json({ error: "Error al eliminar usuario" });
              }

              res.json({ mensaje: "Usuario eliminado correctamente" });
            }
          );
        }
      );
    }
  );
});

/* =========================
   ACTUALIZAR ROL
========================= */
app.put("/usuarios/:id/rol", (req, res) => {
  const { id } = req.params;
  const { rol } = req.body;

  if (!["admin", "cliente"].includes(rol)) {
    return res.status(400).json({ error: "Rol inválido" });
  }

  // Contar admins actuales
  db.query(
    "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin'",
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error de base de datos" });
      }

      const admins = result[0].total;

      // No permitir quedar sin admins
      if (admins <= 1 && rol !== "admin") {
        return res.status(400).json({
          error: "Debe existir al menos un administrador"
        });
      }

      // Actualizar rol
      db.query(
        "UPDATE usuarios SET rol = ? WHERE id_usuario = ?",
        [rol, id],
        err => {
          if (err) {
            console.error(err);
            return res
              .status(500)
              .json({ error: "No se pudo actualizar rol" });
          }

          res.json({ ok: true });
        }
      );
    }
  );
});

/* =========================
   INICIAR SERVIDOR
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
