/**
 * editor-procesos.js — Alta/baja/edición de procesos: id, arribo, prioridad
 * y ráfagas (alternadas CPU/IO, una columna de tabla por ráfaga).
 *
 * La estimación inicial de ráfaga que usa HRRN NO se edita acá: como es un
 * dato que solo le importa a ese algoritmo, vive en la tarjeta de HRRN
 * dentro de "Ver algoritmos" (ver main.js) — esta tabla de procesos es
 * genérica y no depende de qué algoritmos estén agregados.
 *
 * Las ráfagas alternan CPU/IO siempre empezando en CPU, así que el tipo de
 * cada COLUMNA se deduce de su posición (índice par = CPU, impar = IO) y es
 * el mismo para todos los procesos — no hace falta que el usuario lo elija.
 * Como distintos procesos pueden tener distinta cantidad de ráfagas, la
 * tabla tiene tantas columnas de ráfaga como el proceso que más tiene; los
 * procesos más cortos solo muestran el botón "+" para extenderse hasta ahí.
 *
 * Por simplicidad, solo se puede quitar la ÚLTIMA ráfaga de cada proceso
 * (como una pila): así la alternancia nunca queda inconsistente sin tener
 * que recalcular tipos de las demás.
 *
 * El campo `hilos` queda preparado en el modelo de datos (KLT/ULT) pero sin
 * UI todavía — ver el modelo de datos documentado en el handoff del proyecto.
 */
const EditorProcesos = (function () {
  "use strict";

  function tipoRafagaEnIndice(indice) {
    return indice % 2 === 0 ? "CPU" : "IO";
  }

  function crearProcesoVacio(idSugerido) {
    return {
      id: idSugerido,
      arribo: 0,
      prioridad: 1,
      rafagas: [{ tipo: "CPU", duracion: 1 }],
      estimacionInicial: null,
      hilos: [],
    };
  }

  /** Estimación inicial "efectiva": la que puso el usuario, o por defecto la primera ráfaga de CPU real. */
  function estimacionEfectiva(proceso) {
    if (proceso.estimacionInicial != null) return proceso.estimacionInicial;
    const primeraCPU = proceso.rafagas.find((r) => r.tipo === "CPU");
    return primeraCPU ? primeraCPU.duracion : 0;
  }

  function crearInputNumero(valor, alCambiar) {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "input-numero";
    input.value = valor;
    // "change" (no "input"): dispara al salir del campo, no en cada tecla —
    // si re-renderizáramos la tabla en cada tecla, el input perdería el foco.
    input.addEventListener("change", () => alCambiar(Number(input.value)));
    return input;
  }

  /**
   * Cantidad de columnas de ráfaga a mostrar: la del proceso más largo, MÁS
   * UNA. Esa columna extra es la que le da lugar al botón "+" del proceso
   * más largo — si no se sumara, cuando todos los procesos tuvieran la
   * misma cantidad de ráfagas ningún de ellos podría agregar una más (la
   * tabla nunca llegaría a dibujar esa columna).
   */
  function maxCantidadRafagas(procesos) {
    return Math.max(1, ...procesos.map((p) => p.rafagas.length)) + 1;
  }

  /** Celda de la columna de ráfaga `indice` para un proceso dado. */
  function crearCeldaRafaga(proceso, indice, alCambiar) {
    const celda = document.createElement("td");
    celda.className = `celda-rafaga celda-${tipoRafagaEnIndice(indice).toLowerCase()}`;

    if (indice < proceso.rafagas.length) {
      const rafaga = proceso.rafagas[indice];
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.className = "input-duracion-rafaga";
      input.value = rafaga.duracion;
      input.addEventListener("change", () => {
        rafaga.duracion = Math.max(1, Number(input.value) || 1);
        alCambiar();
      });
      celda.appendChild(input);

      const esLaUltima = indice === proceso.rafagas.length - 1;
      if (esLaUltima && proceso.rafagas.length > 1) {
        const botonQuitar = document.createElement("button");
        botonQuitar.type = "button";
        botonQuitar.className = "boton-quitar-rafaga";
        botonQuitar.textContent = "×";
        botonQuitar.title = "Quitar esta ráfaga";
        botonQuitar.addEventListener("click", () => {
          proceso.rafagas.pop();
          alCambiar();
        });
        celda.appendChild(botonQuitar);
      }
    } else if (indice === proceso.rafagas.length) {
      const botonAgregar = document.createElement("button");
      botonAgregar.type = "button";
      botonAgregar.className = "boton-agregar-rafaga";
      botonAgregar.textContent = `+ ${tipoRafagaEnIndice(indice)}`;
      botonAgregar.addEventListener("click", () => {
        proceso.rafagas.push({ tipo: tipoRafagaEnIndice(indice), duracion: 1 });
        alCambiar();
      });
      celda.appendChild(botonAgregar);
    } else {
      celda.className += " celda-rafaga-vacia";
    }

    return celda;
  }

  /**
   * @param {HTMLElement} contenedor
   * @param {Array} procesos - estado mutable de procesos (se edita in-place)
   * @param {Object} opciones
   * @param {Function} opciones.onCambio - se llama con `procesos` cada vez que algo cambia
   */
  function renderizarTablaProcesos(contenedor, procesos, opciones) {
    const { onCambio } = opciones;
    const notificarCambio = () => renderizarTablaProcesos(contenedor, procesos, opciones);

    contenedor.innerHTML = "";
    const tabla = document.createElement("table");
    tabla.className = "tabla-procesos";

    const cantidadRafagas = maxCantidadRafagas(procesos);

    const filaEncabezado = document.createElement("tr");
    ["Proceso", "Arribo", "Prioridad"].forEach((texto) => {
      const th = document.createElement("th");
      th.textContent = texto;
      filaEncabezado.appendChild(th);
    });
    for (let i = 0; i < cantidadRafagas; i++) {
      const th = document.createElement("th");
      th.className = `encabezado-rafaga encabezado-${tipoRafagaEnIndice(i).toLowerCase()}`;
      th.textContent = tipoRafagaEnIndice(i);
      filaEncabezado.appendChild(th);
    }
    filaEncabezado.appendChild(document.createElement("th"));
    tabla.appendChild(filaEncabezado);

    procesos.forEach((proceso) => {
      const fila = document.createElement("tr");

      const tdId = document.createElement("td");
      const inputId = document.createElement("input");
      inputId.type = "text";
      inputId.className = "input-id-proceso";
      inputId.value = proceso.id;
      inputId.addEventListener("change", () => {
        proceso.id = inputId.value.trim() || proceso.id;
        onCambio(procesos);
        notificarCambio();
      });
      tdId.appendChild(inputId);
      fila.appendChild(tdId);

      const tdArribo = document.createElement("td");
      tdArribo.appendChild(
        crearInputNumero(proceso.arribo, (valor) => {
          proceso.arribo = Math.max(0, valor || 0);
          onCambio(procesos);
        })
      );
      fila.appendChild(tdArribo);

      const tdPrioridad = document.createElement("td");
      tdPrioridad.appendChild(
        crearInputNumero(proceso.prioridad, (valor) => {
          proceso.prioridad = valor || 0;
          onCambio(procesos);
        })
      );
      fila.appendChild(tdPrioridad);

      for (let i = 0; i < cantidadRafagas; i++) {
        fila.appendChild(
          crearCeldaRafaga(proceso, i, () => {
            onCambio(procesos);
            notificarCambio();
          })
        );
      }

      const tdAcciones = document.createElement("td");
      const botonEliminar = document.createElement("button");
      botonEliminar.type = "button";
      botonEliminar.className = "boton-eliminar-proceso";
      botonEliminar.textContent = "Eliminar";
      botonEliminar.addEventListener("click", () => {
        const indice = procesos.indexOf(proceso);
        procesos.splice(indice, 1);
        onCambio(procesos);
        notificarCambio();
      });
      tdAcciones.appendChild(botonEliminar);
      fila.appendChild(tdAcciones);

      tabla.appendChild(fila);
    });

    contenedor.appendChild(tabla);

    const botonAgregarProceso = document.createElement("button");
    botonAgregarProceso.type = "button";
    botonAgregarProceso.className = "boton-agregar-proceso";
    botonAgregarProceso.textContent = "+ Agregar proceso";
    botonAgregarProceso.addEventListener("click", () => {
      const siguienteIndice = procesos.length + 1;
      let idSugerido = `P${siguienteIndice}`;
      while (procesos.some((p) => p.id === idSugerido)) {
        idSugerido = `${idSugerido}_`;
      }
      procesos.push(crearProcesoVacio(idSugerido));
      onCambio(procesos);
      notificarCambio();
    });
    contenedor.appendChild(botonAgregarProceso);
  }

  return { crearProcesoVacio, estimacionEfectiva, renderizarTablaProcesos };
})();
