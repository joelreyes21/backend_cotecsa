console.log("🔥 VERSION NUEVA SMTP 587");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const db = require("./db");

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5500",
    "http://localhost:3000",
    "https://bisque-dunlin-728476.hostingersite.com"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =========================
   CONFIGURACIÓN EMAIL
========================= */

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ ERROR SMTP:", error);
  } else {
    console.log("✅ SMTP listo para enviar");
  }
});

function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* =========================
   RUTA PRINCIPAL
========================= */
app.get("/", (req, res) => {
  res.send("Backend COTECSA funcionando ✔️");
});

/* =========================
   REGISTRO CON VERIFICACIÓN
========================= */
app.post("/register", async (req, res) => {
  const { nombre, correo, telefono, password } = req.body;

  if (!nombre || !correo || !telefono || !password) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

    const regexTelefono = /^[389]\d{7}$/;

  if (!regexTelefono.test(telefono)) {
    return res.status(400).json({
      error: "Número inválido. Debe tener 8 dígitos y comenzar con 3, 8 o 9"
    });
  }

  try {

    db.query("SELECT * FROM usuarios WHERE correo = ?", [correo], async (err, results) => {

      if (err) return res.status(500).json({ error: "Error DB" });

      if (results.length > 0) {
        return res.status(400).json({ error: "El correo ya está registrado" });
      }

      const hash = await bcrypt.hash(password, 10);
      const codigo = generarCodigo();

      const sql = `
        INSERT INTO usuarios (nombre_completo, correo, telefono, contrasena, codigo_verificacion, verificado)
        VALUES (?, ?, ?, ?, ?, false)
      `;

      db.query(sql, [nombre, correo, telefono, hash, codigo], async (err) => {

        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al registrar usuario" });
        }

        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: correo,
          subject: "Código de verificación COTECSA",
          html: `
            <h2>Bienvenido a COTECSA</h2>
            <p>Tu código de verificación es:</p>
            <h1>${codigo}</h1>
            <p>Ingresa este código en la plataforma.</p>
          `
        });

        res.json({ mensaje: "Código enviado al correo" });

      });

    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});


/* =========================
   VERIFICAR CÓDIGO
========================= */
app.post("/verificar-codigo", (req, res) => {
  const { correo, codigo } = req.body;

  db.query(
    "SELECT * FROM usuarios WHERE correo = ? AND codigo_verificacion = ?",
    [correo, codigo],
    (err, results) => {

      if (err) return res.status(500).json({ error: "Error DB" });

      if (results.length === 0) {
        return res.status(400).json({ error: "Código incorrecto" });
      }

      db.query(
        "UPDATE usuarios SET verificado = true, codigo_verificacion = NULL WHERE correo = ?",
        [correo],
        (err) => {
          if (err) return res.status(500).json({ error: "Error actualizando usuario" });
          res.json({ ok: true });
        }
      );

    }
  );
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
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error del servidor" });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const usuario = results[0];

    if (!usuario.verificado) {
      return res.status(403).json({ error: "Debes verificar tu correo primero" });
    }

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

  db.query(
    "SELECT rol FROM usuarios WHERE id_usuario = ?",
    [id],
    (err, rows) => {

      if (err) return res.status(500).json({ error: "Error DB" });

      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const usuario = rows[0];

      db.query(
        "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin'",
        (err, result) => {

          if (err) return res.status(500).json({ error: "Error DB" });

          const admins = result[0].total;

          if (usuario.rol === "admin" && admins <= 1) {
            return res.status(400).json({
              error: "Debe existir al menos un administrador"
            });
          }

          db.query(
            "DELETE FROM usuarios WHERE id_usuario = ?",
            [id],
            err => {

              if (err) {
                return res.status(500).json({ error: "Error al eliminar usuario" });
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

  db.query(
    "SELECT rol FROM usuarios WHERE id_usuario = ?",
    [id],
    (err, rows) => {

      if (err) return res.status(500).json({ error: "Error DB" });

      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const usuarioActual = rows[0];

      db.query(
        "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin'",
        (err, result) => {

          if (err) return res.status(500).json({ error: "Error DB" });

          const admins = result[0].total;

          if (
            usuarioActual.rol === "admin" &&
            admins <= 1 &&
            rol !== "admin"
          ) {
            return res.status(400).json({
              error: "Debe existir al menos un administrador"
            });
          }

          db.query(
            "UPDATE usuarios SET rol = ? WHERE id_usuario = ?",
            [rol, id],
            err => {

              if (err) {
                return res.status(500).json({
                  error: "No se pudo actualizar rol"
                });
              }

              res.json({ ok: true });
            }
          );
        }
      );
    }
  );
});

/* =========================
   PLANES COTECSA
========================= */

// Obtener todos los planes
app.get("/api/planes", (req, res) => {
  const sql = "SELECT * FROM planes ORDER BY fecha_creacion DESC";

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error obteniendo planes:", err);
      return res.status(500).json({ error: "Error obteniendo planes" });
    }
    res.json(results);
  });
});

// Crear nuevo plan
app.post("/api/planes", (req, res) => {
  const { nombre, velocidad, precio, descripcion } = req.body;

  if (!nombre || !velocidad || !precio) {
    return res.status(400).json({ error: "Campos obligatorios" });
  }

  const sql = `
    INSERT INTO planes (nombre, velocidad, precio, descripcion, activo)
    VALUES (?, ?, ?, ?, 1)
  `;

  db.query(sql, [nombre, velocidad, precio, descripcion], (err) => {
    if (err) {
      console.error("Error insertando plan:", err);
      return res.status(500).json({ error: "Error guardando plan" });
    }

    res.json({ mensaje: "Plan creado correctamente" });
  });
});

// Actualizar plan
app.put("/api/planes/:id", (req, res) => {
  const id = req.params.id;
  const { nombre, velocidad, precio, descripcion, activo } = req.body;

  const sql = `
    UPDATE planes 
    SET nombre=?, velocidad=?, precio=?, descripcion=?, activo=? 
    WHERE id_plan=?
  `;

  db.query(sql, [nombre, velocidad, precio, descripcion, activo, id], (err) => {
    if (err) {
      console.error("Error actualizando plan:", err);
      return res.status(500).json({ error: "Error actualizando plan" });
    }

    res.json({ mensaje: "Plan actualizado" });
  });
});

// Eliminar plan
app.delete("/api/planes/:id", (req, res) => {
  const id = req.params.id;

  db.query("DELETE FROM planes WHERE id_plan=?", [id], (err) => {
    if (err) {
      console.error("Error eliminando plan:", err);
      return res.status(500).json({ error: "Error eliminando plan" });
    }

    res.json({ mensaje: "Plan eliminado" });
  });
});

/* =========================
   INICIAR SERVIDOR
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor desplegado en Railway (puerto ${PORT})`);
});