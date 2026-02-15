const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./db");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   MIDDLEWARES
========================= */

// CORS funcionando correctamente
app.use(cors({
  origin: true,
  methods: ["GET","POST","PUT","DELETE"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());

app.use(express.json());

// SERVIR FRONTEND DESDE /public
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   RUTA PRINCIPAL
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "planes.html"));
});

/* =========================
   REGISTRO
========================= */

app.post("/register", async (req, res) => {
  const { nombre, correo, telefono, password } = req.body;

  if (!nombre || !correo || !telefono || !password) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO usuarios (nombre_completo, correo, telefono, contrasena)
      VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [nombre, correo, telefono, hash], (err) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(400).json({ error: "El correo ya está registrado" });
        }
        return res.status(500).json({ error: "Error al registrar usuario" });
      }

      res.json({ mensaje: "Usuario registrado correctamente" });
    });

  } catch (error) {
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/login", (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: "Correo y contraseña requeridos" });
  }

  const sql = "SELECT * FROM usuarios WHERE correo = ?";

  db.query(sql, [correo], async (err, results) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });

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
   USUARIOS
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
    if (err) return res.status(500).json({ error: "Error al obtener usuarios" });
    res.json(results);
  });
});

app.delete("/usuarios/:id", (req, res) => {
  db.query(
    "DELETE FROM usuarios WHERE id_usuario = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: "Error al eliminar usuario" });
      res.json({ mensaje: "Usuario eliminado correctamente" });
    }
  );
});

app.put("/usuarios/:id/rol", (req, res) => {
  const { rol } = req.body;

  db.query(
    "UPDATE usuarios SET rol = ? WHERE id_usuario = ?",
    [rol, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: "No se pudo actualizar rol" });
      res.json({ ok: true });
    }
  );
});
/* =========================
   PLANES COTECSA
========================= */

// Obtener todos los planes
app.get("/api/planes", (req, res) => {
  db.query(
    "SELECT * FROM planes ORDER BY fecha_creacion DESC",
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Error obteniendo planes" });
      }
      res.json(results);
    }
  );
});

// Crear plan
app.post("/api/planes", (req, res) => {
  const { nombre, velocidad, precio, descripcion } = req.body;

  if (!nombre || !velocidad || !precio) {
    return res.status(400).json({ error: "Campos obligatorios" });
  }

  db.query(
    `INSERT INTO planes (nombre, velocidad, precio, descripcion, activo)
     VALUES (?, ?, ?, ?, 1)`,
    [nombre, velocidad, precio, descripcion],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error guardando plan" });
      }
      res.json({ mensaje: "Plan creado correctamente" });
    }
  );
});

// Actualizar plan
app.put("/api/planes/:id", (req, res) => {
  const { nombre, velocidad, precio, descripcion, activo } = req.body;

  db.query(
    `UPDATE planes 
     SET nombre=?, velocidad=?, precio=?, descripcion=?, activo=? 
     WHERE id_plan=?`,
    [nombre, velocidad, precio, descripcion, activo, req.params.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error actualizando plan" });
      }
      res.json({ mensaje: "Plan actualizado" });
    }
  );
});

// Eliminar plan
app.delete("/api/planes/:id", (req, res) => {
  db.query(
    "DELETE FROM planes WHERE id_plan=?",
    [req.params.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error eliminando plan" });
      }
      res.json({ mensaje: "Plan eliminado" });
    }
  );
});

/* =========================
   INICIAR SERVIDOR
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en Railway puerto ${PORT}`);
});
