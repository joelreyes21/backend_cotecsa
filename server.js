console.log("API KEY:", process.env.RESEND_API_KEY);
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const db = require("./db");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use((req, res, next) => {
  if (req.originalUrl === "/webhook/stripe") {
    next(); // no parsear
  } else {
    express.json()(req, res, next);
  }
});

const PORT = process.env.PORT || 3000;

/* =========================
   CONFIGURACIÓN RESEND
========================= */

const resend = new Resend(process.env.RESEND_API_KEY);

/* =========================
   FUNCIÓN GENERAR CÓDIGO
========================= */

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
   REGISTRO
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

        // 🔥 ENVÍO DE CORREO CON RESEND
        try {
          await resend.emails.send({
            from: "COTECSA <noreply@cotecsa.shop>",
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

        } catch (error) {
          console.log("❌ ERROR RESEND:", error);
          return res.status(500).json({ error: "Error enviando correo" });
        }

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

      const usuario = results[0];

      db.query(
        "UPDATE usuarios SET verificado = true, codigo_verificacion = NULL WHERE correo = ?",
        [correo],
        (err) => {
          if (err) return res.status(500).json({ error: "Error actualizando usuario" });

          // 🔥 AHORA DEVOLVEMOS EL USUARIO
          res.json({
            mensaje: "Verificación exitosa",
            usuario: {
              id: usuario.id_usuario,
              nombre: usuario.nombre_completo,
              correo: usuario.correo,
              rol: usuario.rol
            }
          });
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

/* =========================
   OBTENER PLAN POR ID
========================= */

app.get("/api/planes/:id", (req, res) => {

  const id = req.params.id;

  const sql = `
    SELECT * FROM planes 
    WHERE id_plan = ? AND activo = 1
  `;

  db.query(sql, [id], (err, results) => {

    if (err) {
      console.error("Error obteniendo plan:", err);
      return res.status(500).json({ error: "Error obteniendo plan" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Plan no encontrado" });
    }

    res.json(results[0]);
  });

});

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

app.post("/api/tickets", (req, res) => {

const {
  usuario_id,
  asunto,
  descripcion,
  prioridad = "media",
  estado = "pendiente"
} = req.body;

const sql = `
INSERT INTO tickets (usuario_id, asunto, descripcion, prioridad, estado)
VALUES (?, ?, ?, ?, ?)
`;

db.query(sql, [
  usuario_id,
  asunto,
  descripcion,
  prioridad,
  estado
], (err, result) => {

  if (err) {
    console.error("Error creando ticket:", err);
    return res.status(500).json({
      error: "Error creando ticket"
    });
  }

  res.json({
    success: true,
    ticket_id: result.insertId
  });

});

});

app.get("/api/tickets", (req, res) => {

const sql = `
SELECT 
t.id_ticket,
u.nombre_completo AS cliente,
u.correo,
t.asunto,
t.descripcion,
t.estado,
t.prioridad,
t.tecnico_id
FROM tickets t
LEFT JOIN usuarios u
ON t.usuario_id = u.id_usuario
ORDER BY t.fecha_creacion DESC
`;

db.query(sql, (err, results) => {

if (err) {
console.error("Error obteniendo tickets:", err);
return res.status(500).json({
error: "Error obteniendo tickets"
});
}

res.json(results);

});

});

/* =========================
   ENVIAR CORREO DE SOPORTE
========================= */

app.post("/api/tickets/email", async (req, res) => {

const { correo, asunto, mensaje } = req.body;

if (!correo || !mensaje) {
return res.status(400).json({
error: "Faltan datos"
});
}

try {

await resend.emails.send({

from: "COTECSA Soporte <noreply@cotecsa.shop>",

to: correo,

subject: asunto || "Respuesta a tu ticket de soporte",

html: `
<h2>Soporte Técnico COTECSA</h2>

<p>${mensaje}</p>

<br>

<p>Un técnico está trabajando en tu solicitud.</p>

<hr>

<p style="color:gray;font-size:12px">
Este es un mensaje automático del sistema de soporte COTECSA
</p>
`

});

res.json({
success: true,
mensaje: "Correo enviado"
});

} catch (error) {

console.error("Error enviando correo:", error);

res.status(500).json({
error: "Error enviando correo"
});

}

});

/* =========================
   CAMBIAR ESTADO TICKET
========================= */

app.put("/api/tickets/:id/estado", (req, res) => {

const id = req.params.id;
const { estado } = req.body;

const sql = `
UPDATE tickets
SET estado = ?
WHERE id_ticket = ?
`;

db.query(sql, [estado, id], (err) => {

if (err) {
console.error("Error actualizando estado:", err);
return res.status(500).json({
error: "Error actualizando estado"
});
}

res.json({
success: true
});

});

});

/* =========================
   ASIGNAR TECNICO
========================= */

app.put("/api/tickets/:id/tecnico", (req, res) => {

const id = req.params.id;
const { tecnico } = req.body;

const sql = `
UPDATE tickets
SET tecnico_id = ?
WHERE id_ticket = ?
`;

db.query(sql, [tecnico, id], (err) => {

if (err) {
console.error("Error asignando técnico:", err);
return res.status(500).json({
error: "Error asignando técnico"
});
}

res.json({
success: true
});

});

});

/* =========================
   ELIMINAR TICKET
========================= */

app.delete("/api/tickets/:id", (req, res) => {

const id = req.params.id;

const sql = `
DELETE FROM tickets
WHERE id_ticket = ?
`;

db.query(sql, [id], (err) => {

if (err) {
console.error("Error eliminando ticket:", err);
return res.status(500).json({
error: "Error eliminando ticket"
});
}

res.json({
success: true,
mensaje: "Ticket eliminado"
});

});

});

/* =========================
   CONTRATOS
========================= */

/* Obtener todos los contratos */

app.get("/contratos", (req, res) => {

const sql = `
SELECT
c.id_contrato AS id,
u.nombre_completo AS cliente,
p.nombre AS plan,
c.fecha_inicio,
c.fecha_fin,
c.estado
FROM contratos c
LEFT JOIN usuarios u
ON c.usuario_id = u.id_usuario
LEFT JOIN planes p
ON c.plan_id = p.id_plan
ORDER BY c.id_contrato DESC
`;

db.query(sql, (err, results) => {

if (err) {
console.error("Error obteniendo contratos:", err);
return res.status(500).json({
error: "Error obteniendo contratos"
});
}

res.json(results);

});

});


/* Crear contrato */

app.post("/contratos", (req, res) => {

const {
usuario_id,
plan_id,
fecha_inicio,
fecha_fin,
estado
} = req.body;

if(!usuario_id || !plan_id || !fecha_inicio){

return res.status(400).json({
error:"Datos incompletos"
});

}

const sql = `
INSERT INTO contratos
(usuario_id, plan_id, fecha_inicio, fecha_fin, estado)
VALUES (?, ?, ?, ?, ?)
`;

db.query(sql, [

usuario_id,
plan_id,
fecha_inicio,
fecha_fin,
estado || "activo"

], (err, result) => {

if (err) {

console.error("Error creando contrato:", err);

return res.status(500).json({
error:"Error creando contrato"
});

}

res.json({
success:true,
id:result.insertId
});

});

});

/* =========================
   GENERAR FACTURAS MENSUALES
========================= */

app.post("/api/facturas/generar", (req, res) => {

const sql = `
SELECT 
c.id_contrato,
p.precio
FROM contratos c
JOIN planes p 
ON c.plan_id = p.id_plan
WHERE c.estado = 'activo'
`;

db.query(sql, (err, contratos) => {

if (err) {
console.error("Error obteniendo contratos:", err);
return res.status(500).json({ error: "Error contratos" });
}

contratos.forEach(c => {

const numeroFactura = "FAC-" + Date.now() + "-" + c.id_contrato;

const fechaEmision = new Date();
const fechaVencimiento = new Date();
fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);

const insertar = `
INSERT INTO facturas
(contrato_id, numero_factura, monto, fecha_emision, fecha_vencimiento, estado)
VALUES (?, ?, ?, ?, ?, 'pendiente')
`;

db.query(insertar, [
c.id_contrato,
numeroFactura,
c.precio,
fechaEmision,
fechaVencimiento
]);

});

res.json({
mensaje: "Facturas generadas correctamente"
});

});

});

/* =========================
   OBTENER FACTURAS
========================= */

app.get("/api/facturas", (req, res) => {

const sql = `
SELECT 
f.id_factura,
f.numero_factura,
f.monto,
f.fecha_emision,
f.fecha_vencimiento,
f.estado,
u.nombre_completo AS cliente,
p.nombre AS plan
FROM facturas f
JOIN contratos c
ON f.contrato_id = c.id_contrato
JOIN usuarios u
ON c.usuario_id = u.id_usuario
JOIN planes p
ON c.plan_id = p.id_plan
ORDER BY f.fecha_emision DESC
`;

db.query(sql, (err, results) => {

if (err) {
console.error(err);
return res.status(500).json({
error: "Error obteniendo facturas"
});
}

res.json(results);

});

});

/* =========================
   PAGAR FACTURA
========================= */

app.put("/api/facturas/:id/pagar", (req, res) => {

const id = req.params.id;

const sql = `
UPDATE facturas
SET estado = 'pagado'
WHERE id_factura = ?
`;

db.query(sql, [id], err => {

if (err) {
console.error(err);
return res.status(500).json({
error: "Error pagando factura"
});
}

res.json({
success: true,
mensaje: "Factura pagada"
});

});

});


app.get("/contratos/:id", (req, res) => {

const id = req.params.id;

const sql = `
SELECT 
c.id_contrato AS id,
c.usuario_id,
c.plan_id,
c.fecha_inicio,
c.fecha_fin,
c.estado
FROM contratos c
WHERE c.id_contrato = ?
`;

db.query(sql, [id], (err, results) => {

if (err) {
console.error("Error obteniendo contrato:", err);
return res.status(500).json({
error: "Error obteniendo contrato"
});
}

if (results.length === 0) {
return res.status(404).json({
error: "Contrato no encontrado"
});
}

res.json(results[0]);

});

});

app.put("/contratos/:id", (req, res) => {

const id = req.params.id;

const {
usuario_id,
plan_id,
fecha_inicio,
fecha_fin,
estado
} = req.body;

const sql = `
UPDATE contratos
SET
usuario_id = ?,
plan_id = ?,
fecha_inicio = ?,
fecha_fin = ?,
estado = ?
WHERE id_contrato = ?
`;

db.query(sql, [
usuario_id,
plan_id,
fecha_inicio,
fecha_fin,
estado,
id
], (err) => {

if (err) {
console.error("Error actualizando contrato:", err);
return res.status(500).json({
error: "Error actualizando contrato"
});
}

res.json({
success: true,
mensaje: "Contrato actualizado"
});

});

});

/* =========================
   CONTRATOS POR CLIENTE
========================= */

app.get("/api/contratos/cliente/:correo", (req, res) => {

const correo = req.params.correo;

const sql = `
SELECT 
c.id_contrato AS id,
p.nombre AS plan_nombre,
p.velocidad,
p.precio
FROM contratos c
JOIN usuarios u ON c.usuario_id = u.id_usuario
JOIN planes p ON c.plan_id = p.id_plan
WHERE u.correo = ?
AND c.estado = 'activo'
`;

db.query(sql, [correo], (err, results) => {

if (err) {
console.error("Error obteniendo contratos cliente:", err);
return res.status(500).json({
error: "Error obteniendo contratos"
});
}

res.json(results);

});

});

/* =========================
   STRIPE CHECKOUT
========================= */

app.post("/api/stripe/crear-sesion", async (req, res) => {

try {

const { contrato_id, nombre, precio } = req.body;

// 🔥 convertir a centavos USD aprox
console.log("PRECIO QUE LLEGA:", precio);

const usd = Math.round((Number(precio) / 24.5) * 100);

const session = await stripe.checkout.sessions.create({

payment_method_types: ["card"],

line_items: [
{
price_data: {
currency: "usd",
product_data: {
name: nombre
},
unit_amount: usd
},
quantity: 1
}
],

mode: "payment",

success_url: "https://cotecsahn.com/exito.html",
cancel_url: "https://cotecsahn.com/cancelado.html",

metadata: {
contrato_id
}

});

res.json({ id: session.id });

} catch (error) {

console.error("Error Stripe:", error);

res.status(500).json({
error: "Error creando sesión"
});

}

});

app.post("/webhook/stripe", express.raw({ type: "application/json" }), async (req, res) => {

  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }


  console.log("EVENTO:", event.type);
  if (event.type === "checkout.session.completed") {

    const session = event.data.object;

    const contrato_id = session.metadata.contrato_id;
    const monto = session.amount_total / 100;

    console.log("💳 PAGO COMPLETADO:", contrato_id, monto);

    db.query(
  "INSERT INTO pagos (contrato_id, monto, fecha_pago, metodo_pago, estado) VALUES (?, ?, NOW(), 'stripe', 'pagado')",
  [contrato_id, monto],
  (err, result) => {

    if (err) {
      console.error("❌ ERROR INSERTANDO PAGO:", err);
    } else {
      console.log("✅ PAGO INSERTADO:", result.insertId);
    }

  }
);

    db.query(
      "UPDATE facturas SET estado = 'pagado' WHERE contrato_id = ? AND estado = 'pendiente' LIMIT 1",
      [contrato_id]
    );
  }

  res.json({ received: true });

});

app.put("/api/usuarios/perfil", (req, res) => {

  const { nombre, correo } = req.body;

  if (!nombre || !correo) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  const sql = `
    UPDATE usuarios 
    SET nombre_completo = ?, correo = ?
    WHERE correo = ?
  `;

  // 🔥 USAMOS EL MISMO CORREO PARA BUSCAR
  db.query(sql, [nombre, correo, correo], (err, result) => {

    if (err) {
      console.error("ERROR SQL:", err);
      return res.status(500).json({ error: "Error en base de datos" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ ok: true });

  });

});

app.get("/api/pagos", (req, res) => {

  const sql = `
    SELECT 
      p.id_pago,
      p.contrato_id,
      p.monto,
      p.fecha_pago,
      p.estado,
      u.nombre_completo AS cliente
    FROM pagos p
    JOIN contratos c ON p.contrato_id = c.id_contrato
    JOIN usuarios u ON c.usuario_id = u.id_usuario
    ORDER BY p.fecha_pago DESC
  `;

  db.query(sql, (err, results) => {

    if (err) {
      console.error("ERROR EN PAGOS:", err);
      return res.status(500).json({ error: "Error obteniendo pagos" });
    }

    res.json(results);

  });

});

const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

app.get("/api/factura/:id", (req, res) => {

  const id = req.params.id;

  const sql = `
    SELECT 
      p.id_pago,
      p.monto,
      p.fecha_pago,
      u.nombre_completo AS cliente,
      c.numero_contrato
    FROM pagos p
    JOIN contratos c ON p.contrato_id = c.id_contrato
    JOIN usuarios u ON c.usuario_id = u.id_usuario
    WHERE p.id_pago = ?
  `;

  db.query(sql, [id], (err, results) => {

    if (err || results.length === 0) {
      console.error(err);
      return res.status(500).send("Error generando factura");
    }

    const data = results[0];

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=factura_${id}.pdf`
    );

    doc.pipe(res);

    const logoPath = path.join(__dirname, "logo-cotecsa.png");

    // ================= HEADER =================
    doc.rect(0, 0, 612, 100).fill("#0a1f44");

    // LOGO (no rompe si no existe)
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 25, { width: 80 });
    }

    doc.fillColor("#ffffff")
      .fontSize(20)
      .text("COTECSA", 150, 35);

    doc.fontSize(10)
      .text("Internet & Cable", 150, 60);

    doc.fillColor("#000");

    // ================= FACTURA INFO =================
    doc.moveDown(3);

    doc.fontSize(18)
      .text("FACTURA", { align: "right" });

    doc.fontSize(10)
      .text(`Factura No: FAC-2026-${id}`, { align: "right" });

    doc.moveDown();

    // ================= CLIENT BOX =================
    const boxTop = doc.y;

    doc.roundedRect(50, boxTop, 500, 80, 5)
      .stroke("#cccccc");

    doc.fontSize(12)
      .text("Datos del Cliente", 60, boxTop + 10, { underline: true });

    doc.fontSize(10)
      .text(`Nombre: ${data.cliente}`, 60, boxTop + 30);

    doc.text(`Contrato: ${data.numero_contrato}`, 60, boxTop + 45);

    doc.text(
      `Fecha: ${new Date(data.fecha_pago).toLocaleDateString()}`,
      60,
      boxTop + 60
    );

    doc.moveDown(4);

    // ================= MONEDA =================
    const tasa = 26.48;

    const montoUSD = parseFloat(data.monto);
    const montoLPS = montoUSD * tasa;

    const isv = montoLPS * 0.15;
    const total = montoLPS + isv;

    // ================= TABLA =================
    const tableTop = doc.y;

    doc.rect(50, tableTop, 500, 25).fill("#0a1f44");

    doc.fillColor("#fff")
      .fontSize(10)
      .text("Descripción", 60, tableTop + 7)
      .text("Cant.", 300, tableTop + 7)
      .text("USD", 370, tableTop + 7)
      .text("Lempiras", 460, tableTop + 7);

    doc.fillColor("#000");

    const rowY = tableTop + 30;

    doc.rect(50, rowY, 500, 25).stroke("#ddd");

    doc.text("Servicio mensual COTECSA", 60, rowY + 7);
    doc.text("1", 300, rowY + 7);
    doc.text(`$ ${montoUSD.toFixed(2)}`, 370, rowY + 7);
    doc.text(`L. ${montoLPS.toFixed(2)}`, 460, rowY + 7);

    // ================= TOTALES =================
    doc.moveDown(3);

    doc.fontSize(10)
      .text(`Subtotal: L. ${montoLPS.toFixed(2)}`, 350);

    doc.text(`ISV (15%): L. ${isv.toFixed(2)}`, 350);

    doc.fontSize(12)
      .text(`TOTAL: L. ${total.toFixed(2)}`, 350, doc.y + 5);

    doc.moveDown();

    doc.fontSize(9)
      .fillColor("#666")
      .text(`Tipo de cambio: 1 USD = L. ${tasa}`, 350);

    doc.text(`Equivalente USD: $ ${montoUSD.toFixed(2)}`, 350);

    // ================= FOOTER =================
    doc.moveDown(4);

    doc.moveTo(50, doc.y)
      .lineTo(550, doc.y)
      .stroke("#ccc");

    doc.moveDown();

    doc.fontSize(10)
      .fillColor("#555")
      .text("Gracias por confiar en COTECSA", { align: "center" });

    doc.text("Soporte: soporte@cotecsa.com", { align: "center" });
    doc.text("Tel: +504 9495-2504", { align: "center" });

    doc.end();

  });

});

app.post("/api/solicitudes", async (req, res) => {

  const { nombre, telefono, correo, plan_id } = req.body;

  if (!nombre || !telefono || !correo || !plan_id) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  try {

    // 🔥 1. GUARDAR EN DB
    const [result] = await db.query(`
      INSERT INTO solicitudes (nombre, telefono, correo, plan_id)
      VALUES (?, ?, ?, ?)
    `, [nombre, telefono, correo, plan_id]);



    // 🔥 2. OBTENER INFO DEL PLAN
    const [planRows] = await db.query(`
      SELECT nombre, precio FROM planes WHERE id = ?
    `, [plan_id]);

    const plan = planRows[0];



    // 🔥 3. ENVIAR CORREO AUTOMÁTICO
    await resend.emails.send({

      from: "COTECSA <noreply@cotecsa.shop>",

      to: correo,

      subject: "Hemos recibido tu solicitud 📡",

      html: `
        <div style="font-family:Segoe UI; padding:20px;">

          <h2 style="color:#0a1f44;">COTECSA</h2>

          <p>Hola <b>${nombre}</b>,</p>

          <p>
            Gracias por comunicarte con nosotros 🙌<br>
            Hemos recibido tu solicitud del plan:
          </p>

          <p style="font-size:18px; font-weight:bold;">
            ${plan.nombre} - L ${plan.precio}
          </p>

          <p>
            Nuestro equipo se pondrá en contacto contigo muy pronto 📞
          </p>

          <hr>

          <small style="color:#888;">
            Este es un mensaje automático, no es necesario responder.
          </small>

        </div>
      `
    });



    res.json({
      success: true,
      id: result.insertId
    });

  } catch (error) {

    console.error("ERROR SOLICITUD:", error);

    res.status(500).json({
      error: "Error al guardar solicitud"
    });

  }

});

app.get("/api/solicitudes", (req, res) => {

  const sql = `
    SELECT s.*, p.nombre AS plan_nombre, p.precio
    FROM solicitudes s
    JOIN planes p ON s.plan_id = p.id_plan
    ORDER BY s.id DESC
  `;

  db.query(sql, (err, results) => {

    if (err) {
      console.error("ERROR OBTENIENDO SOLICITUDES:", err);
      return res.status(500).json({
        error: "Error obteniendo solicitudes"
      });
    }

    res.json(results);

  });

});

app.get("/api/solicitudes", (req, res) => {

  const sql = `
    SELECT 
      s.id,
      s.nombre,
      s.telefono,
      s.correo,
      s.fecha,
      p.nombre AS plan_nombre,
      p.precio
    FROM solicitudes s
    JOIN planes p ON s.plan_id = p.id_plan
    ORDER BY s.id DESC
  `;

  db.query(sql, (err, results) => {

    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error obteniendo solicitudes" });
    }

    res.json(results);

  });

});

app.post("/api/solicitudes/email", async (req, res) => {

  const { correo, mensaje } = req.body;

  if (!correo || !mensaje) {
    return res.status(400).json({
      error: "Faltan datos"
    });
  }

  try {

    await resend.emails.send({

      from: "COTECSA <noreply@cotecsa.shop>",

      to: correo,

      subject: "Respuesta a tu solicitud",

      html: `
        <h2>COTECSA</h2>

        <p>${mensaje}</p>

        <br>

        <p>Gracias por tu interés en nuestros servicios, pronto nos comunicaremos contigo.</p>

        <hr>

        <small>Este es un correo automático</small>
      `
    });

    res.json({
      success: true
    });

  } catch (error) {

    console.error("ERROR CORREO:", error);

    res.status(500).json({
      error: "Error enviando correo"
    });

  }

});

/* =========================
   INICIAR SERVIDOR
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Servidor desplegado en Railway (puerto ${PORT})`);
});
