const API = "/api/planes";

let editId = null;

document.addEventListener("DOMContentLoaded", cargarPlanes);

function abrirModal(){
    document.getElementById("modalPlan").style.display = "flex";
}

function cerrarModal(){
    document.getElementById("modalPlan").style.display = "none";
    limpiarCampos();
}

function limpiarCampos(){
    document.getElementById("nombrePlan").value = "";
    document.getElementById("velocidadPlan").value = "";
    document.getElementById("precioPlan").value = "";
    document.getElementById("descripcionPlan").value = "";
    editId = null;
}

async function guardarPlan(){

    const nombre = document.getElementById("nombrePlan").value;
    const velocidad = document.getElementById("velocidadPlan").value;
    const precio = document.getElementById("precioPlan").value;
    const descripcion = document.getElementById("descripcionPlan").value;

    if(!nombre || !velocidad || !precio){
        alert("Todos los campos son obligatorios");
        return;
    }

    const datos = {
        nombre,
        velocidad,
        precio,
        descripcion,
        activo: 1
    };

    if(editId){
        await fetch(`${API}/${editId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datos)
        });
    } else {
        await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datos)
        });
    }

    cerrarModal();
    cargarPlanes();
}

async function cargarPlanes(){

    const res = await fetch(API);
    const planes = await res.json();

    const tabla = document.getElementById("tablaPlanes");
    tabla.innerHTML = "";

    planes.forEach(plan => {

        const fila = document.createElement("tr");

        fila.innerHTML = `
            <td>${plan.nombre}</td>
            <td>${plan.velocidad}</td>
            <td>$${plan.precio}</td>
            <td>
                <span style="color:${plan.activo ? '#10b981' : '#ef4444'}; font-weight:600;">
                    ${plan.activo ? "Activo" : "Inactivo"}
                </span>
            </td>
            <td class="actions">
                <button class="edit">Editar</button>
                <button class="delete">Eliminar</button>
            </td>
        `;

        // Botón editar seguro
        fila.querySelector(".edit").addEventListener("click", () => {
            editarPlan(plan);
        });

        // Botón eliminar seguro
        fila.querySelector(".delete").addEventListener("click", () => {
            eliminarPlan(plan.id_plan);
        });

        tabla.appendChild(fila);
    });
}


function editarPlan(plan){

    document.getElementById("nombrePlan").value = plan.nombre;
    document.getElementById("velocidadPlan").value = plan.velocidad;
    document.getElementById("precioPlan").value = plan.precio;
    document.getElementById("descripcionPlan").value = plan.descripcion;

    editId = plan.id_plan;
    abrirModal();
}


async function eliminarPlan(id){

    if(confirm("¿Eliminar este plan?")){
        await fetch(`${API}/${id}`, {
            method: "DELETE"
        });
        cargarPlanes();
    }
}