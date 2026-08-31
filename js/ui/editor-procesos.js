/**
 * editor-procesos.js — Alta/baja/edición de procesos y sus hilos: id,
 * arribo, ráfagas (alternadas CPU/IO, una columna de tabla por ráfaga).
 *
 * La prioridad y la estimación inicial de ráfaga NO se editan acá: son
 * datos que solo le importan a ciertos algoritmos (Prioridad/Prioridad
 * expropiativa, y SJF/SRTF/HRRN respectivamente), así que viven en la
 * tarjeta de ESE algoritmo dentro de "Ver algoritmos" (ver main.js) — esta
 * tabla de procesos es genérica y no depende de qué algoritmos estén
 * agregados.
 *
 * Las ráfagas alternan CPU/IO siempre empezando en CPU, así que el tipo de
 * cada COLUMNA se deduce de su posición (índice par = CPU, impar = IO) y es
 * el mismo para todos los hilos — no hace falta que el usuario lo elija.
 * Como distintas filas pueden tener distinta cantidad de ráfagas, la tabla
 * tiene tantas columnas de ráfaga como la fila que más tiene; las más
 * cortas solo muestran el botón "+" para extenderse hasta ahí.
 *
 * Por simplicidad, solo se puede quitar la ÚLTIMA ráfaga de cada fila (como
 * una pila): así la alternancia nunca queda inconsistente sin tener que
 * recalcular tipos de las demás.
 *
 * Columnas: Proceso, Hilo, Arribo, ráfagas (CPU/IO alternadas), Acciones.
 *
 * Hilos: un proceso NO tiene ejecución propia — TODA su ejecución vive en
 * `proceso.hilos[]`, que arranca con un único hilo (nombrado "1") y puede
 * agrandarse. Ese primer hilo no tiene ningún trato especial: es un hilo
 * más, con su propio id (editable), tipo (KLT/ULT), arribo y ráfagas,
 * igual que cualquier otro que se agregue después — por eso todas las
 * filas de hilos de un proceso comparten el mismo look, y solo la celda de
 * "Proceso" (rowspan) los agrupa visualmente. La numeración de hilos se
 * reinicia en cada proceso (el "1" de A.1 no tiene relación con el "1" de
 * B.1). Si el proceso tiene algún hilo ULT, aparece además una fila propia,
 * debajo de todas, para elegir el algoritmo de biblioteca que resuelve sus
 * llamadas bloqueantes (Jacketing o Llamadas no bloqueantes) — es una
 * propiedad del PROCESO (de su biblioteca ULT), no de cada hilo individual.
 */
const EditorProcesos = (function () {
  "use strict";

  const OPCIONES_ALGORITMO_BIBLIOTECA = [
    { valor: "jacketing", etiqueta: "Jacketing" },
    { valor: "no-bloqueante", etiqueta: "Llamadas no bloqueantes" },
  ];

  function tipoRafagaEnIndice(indice) {
    return indice % 2 === 0 ? "CPU" : "IO";
  }

  /** A, B, ..., Z, AA, AB, ... (como las columnas de una planilla). */
  function letraDesdeIndice(indice) {
    let n = indice;
    let letra = "";
    do {
      letra = String.fromCharCode(65 + (n % 26)) + letra;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letra;
  }

  function siguienteIdProceso(procesos) {
    let indice = procesos.length;
    let id = letraDesdeIndice(indice);
    while (procesos.some((p) => p.id === id)) {
      indice += 1;
      id = letraDesdeIndice(indice);
    }
    return id;
  }

  /** Un hilo puede arribar (crearse) en un instante distinto al de su proceso — ej. un hilo que se lanza recién cuando el proceso ya lleva un rato corriendo. */
  function crearHiloVacio(idSugerido, arribo) {
    return {
      id: idSugerido,
      tipo: "KLT",
      arribo: arribo || 0,
      rafagas: [{ tipo: "CPU", duracion: 1 }],
    };
  }

  /** Un proceso arranca con un único hilo ("1") — no tiene ejecución propia por fuera de sus hilos. */
  function crearProcesoVacio(idSugerido) {
    return {
      id: idSugerido,
      prioridad: 1,
      estimacionInicial: null,
      algoritmoBiblioteca: null,
      hilos: [crearHiloVacio("1", 0)],
    };
  }

  /** Numeración de hilos, reiniciada por proceso: "1", "2", "3", ... */
  function siguienteIdHilo(proceso) {
    let indice = proceso.hilos.length + 1;
    let id = String(indice);
    while (proceso.hilos.some((h) => h.id === id)) {
      indice += 1;
      id = String(indice);
    }
    return id;
  }

  /** Estimación inicial "efectiva": la que puso el usuario, o por defecto la primera ráfaga de CPU real del primer hilo. */
  function estimacionEfectiva(proceso) {
    if (proceso.estimacionInicial != null) return proceso.estimacionInicial;
    const primerHilo = proceso.hilos[0];
    const primeraCPU = primerHilo && primerHilo.rafagas.find((r) => r.tipo === "CPU");
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
   * Cantidad de columnas de ráfaga a mostrar: la del hilo más largo de TODA
   * la tabla, MÁS UNA. Esa columna extra es la que le da lugar al botón "+"
   * del hilo más largo — si no se sumara, cuando todos los hilos tuvieran
   * la misma cantidad de ráfagas ninguno podría agregar una más (la tabla
   * nunca llegaría a dibujar esa columna).
   */
  function maxCantidadRafagas(procesos) {
    let maximo = 1;
    procesos.forEach((proceso) => {
      proceso.hilos.forEach((hilo) => {
        maximo = Math.max(maximo, hilo.rafagas.length);
      });
    });
    return maximo + 1;
  }

  /** Celda de la columna de ráfaga `indice` para un hilo. */
  function crearCeldaRafaga(hilo, indice, alCambiar) {
    const celda = document.createElement("td");
    celda.className = `celda-rafaga celda-${tipoRafagaEnIndice(indice).toLowerCase()}`;

    if (indice < hilo.rafagas.length) {
      const rafaga = hilo.rafagas[indice];
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

      const esLaUltima = indice === hilo.rafagas.length - 1;
      if (esLaUltima && hilo.rafagas.length > 1) {
        const botonQuitar = document.createElement("button");
        botonQuitar.type = "button";
        botonQuitar.className = "boton-quitar-rafaga";
        botonQuitar.textContent = "×";
        botonQuitar.title = "Quitar esta ráfaga";
        botonQuitar.addEventListener("click", () => {
          hilo.rafagas.pop();
          alCambiar();
        });
        celda.appendChild(botonQuitar);
      }
    } else if (indice === hilo.rafagas.length) {
      const botonAgregar = document.createElement("button");
      botonAgregar.type = "button";
      botonAgregar.className = "boton-agregar-rafaga";
      botonAgregar.textContent = `+ ${tipoRafagaEnIndice(indice)}`;
      botonAgregar.addEventListener("click", () => {
        hilo.rafagas.push({ tipo: tipoRafagaEnIndice(indice), duracion: 1 });
        alCambiar();
      });
      celda.appendChild(botonAgregar);
    } else {
      celda.className += " celda-rafaga-vacia";
    }

    return celda;
  }

  /**
   * Botón único que alterna KLT ↔ ULT al tocarlo (en vez de dos botones
   * lado a lado): ahorra espacio, ya que solo hay dos valores posibles.
   */
  function crearBotonTipoHilo(obtenerTipo, establecerTipo, alCambiar) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.title = "Click para alternar entre KLT y ULT";
    const actualizar = () => {
      const tipo = obtenerTipo();
      boton.textContent = tipo;
      boton.className = `boton-tipo-hilo boton-tipo-hilo-${tipo.toLowerCase()}`;
    };
    actualizar();
    boton.addEventListener("click", () => {
      establecerTipo(obtenerTipo() === "KLT" ? "ULT" : "KLT");
      alCambiar();
    });
    return boton;
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
    const marcarCambio = () => {
      onCambio(procesos);
      notificarCambio();
    };

    contenedor.innerHTML = "";
    const tabla = document.createElement("table");
    tabla.className = "tabla-procesos";

    const cantidadRafagas = maxCantidadRafagas(procesos);

    const filaEncabezado = document.createElement("tr");
    ["Proceso", "Hilo", "Arribo"].forEach((texto) => {
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
      const tieneULT = proceso.hilos.some((h) => h.tipo === "ULT");
      const cantidadFilas = proceso.hilos.length;

      // --- Una fila por hilo: todas se construyen exactamente igual, no
      // hay ningún hilo "especial" — solo la celda de Proceso (rowspan) se
      // agrega una única vez, en la primera fila del grupo.
      proceso.hilos.forEach((hilo, indiceHilo) => {
        const fila = document.createElement("tr");
        fila.className = "fila-hilo";

        if (indiceHilo === 0) {
          const tdId = document.createElement("td");
          tdId.rowSpan = cantidadFilas;
          const inputId = document.createElement("input");
          inputId.type = "text";
          inputId.className = "input-id-proceso";
          inputId.value = proceso.id;
          inputId.addEventListener("change", () => {
            proceso.id = inputId.value.trim() || proceso.id;
            marcarCambio();
          });
          tdId.appendChild(inputId);
          fila.appendChild(tdId);
        }

        const tdTipo = document.createElement("td");
        tdTipo.className = "celda-tipo-hilo";

        const inputNombreHilo = document.createElement("input");
        inputNombreHilo.type = "text";
        inputNombreHilo.className = "input-id-hilo";
        inputNombreHilo.value = hilo.id;
        inputNombreHilo.addEventListener("change", () => {
          hilo.id = inputNombreHilo.value.trim() || hilo.id;
          marcarCambio();
        });
        tdTipo.appendChild(inputNombreHilo);

        tdTipo.appendChild(
          crearBotonTipoHilo(
            () => hilo.tipo,
            (valor) => {
              hilo.tipo = valor;
            },
            marcarCambio
          )
        );
        fila.appendChild(tdTipo);

        const tdArribo = document.createElement("td");
        tdArribo.appendChild(
          crearInputNumero(hilo.arribo || 0, (valor) => {
            hilo.arribo = Math.max(0, valor || 0);
            onCambio(procesos);
          })
        );
        fila.appendChild(tdArribo);

        for (let i = 0; i < cantidadRafagas; i++) {
          fila.appendChild(crearCeldaRafaga(hilo, i, marcarCambio));
        }

        const tdAcciones = document.createElement("td");
        tdAcciones.className = "celda-acciones-proceso";

        if (indiceHilo === 0) {
          const botonAgregarHilo = document.createElement("button");
          botonAgregarHilo.type = "button";
          botonAgregarHilo.className = "boton-agregar-hilo";
          botonAgregarHilo.textContent = "+ Hilo";
          botonAgregarHilo.title = "Agregar un hilo a este proceso";
          botonAgregarHilo.addEventListener("click", () => {
            proceso.hilos.push(crearHiloVacio(siguienteIdHilo(proceso), hilo.arribo));
            marcarCambio();
          });
          tdAcciones.appendChild(botonAgregarHilo);

          const botonEliminarProceso = document.createElement("button");
          botonEliminarProceso.type = "button";
          botonEliminarProceso.className = "boton-eliminar-proceso";
          botonEliminarProceso.textContent = "Eliminar";
          botonEliminarProceso.addEventListener("click", () => {
            const indice = procesos.indexOf(proceso);
            procesos.splice(indice, 1);
            marcarCambio();
          });
          tdAcciones.appendChild(botonEliminarProceso);
        }

        // Un proceso siempre necesita al menos un hilo — no se puede quitar
        // el único que le queda.
        if (proceso.hilos.length > 1) {
          const botonQuitarHilo = document.createElement("button");
          botonQuitarHilo.type = "button";
          botonQuitarHilo.className = "boton-eliminar-hilo";
          botonQuitarHilo.textContent = "Quitar hilo";
          botonQuitarHilo.addEventListener("click", () => {
            proceso.hilos = proceso.hilos.filter((h) => h !== hilo);
            marcarCambio();
          });
          tdAcciones.appendChild(botonQuitarHilo);
        }

        fila.appendChild(tdAcciones);
        tabla.appendChild(fila);
      });

      // --- Fila del algoritmo de biblioteca (solo si hay algún hilo ULT) ---
      // Va debajo de Proceso, Hilo y Arribo (colspan 3): es una propiedad
      // del proceso, no de cada hilo, así que ocupa su propia fila en vez
      // de repetirse en cada una.
      if (tieneULT) {
        if (!proceso.algoritmoBiblioteca) proceso.algoritmoBiblioteca = OPCIONES_ALGORITMO_BIBLIOTECA[0].valor;

        const filaBiblioteca = document.createElement("tr");
        filaBiblioteca.className = "fila-biblioteca-ult";

        const tdBiblioteca = document.createElement("td");
        tdBiblioteca.colSpan = 3; // debajo de "Proceso", "Hilo" y "Arribo"
        tdBiblioteca.className = "celda-biblioteca-ult";

        const etiqueta = document.createElement("span");
        etiqueta.textContent = "Biblioteca ULT:";
        tdBiblioteca.appendChild(etiqueta);

        const select = document.createElement("select");
        OPCIONES_ALGORITMO_BIBLIOTECA.forEach((opcion) => {
          const option = document.createElement("option");
          option.value = opcion.valor;
          option.textContent = opcion.etiqueta;
          if (opcion.valor === proceso.algoritmoBiblioteca) option.selected = true;
          select.appendChild(option);
        });
        select.addEventListener("change", () => {
          proceso.algoritmoBiblioteca = select.value;
          onCambio(procesos);
        });
        tdBiblioteca.appendChild(select);
        filaBiblioteca.appendChild(tdBiblioteca);

        // Relleno para el resto de la fila (ráfagas + Acciones), que en
        // esta fila no muestran nada.
        const tdRelleno = document.createElement("td");
        tdRelleno.colSpan = cantidadRafagas;
        filaBiblioteca.appendChild(tdRelleno);
        filaBiblioteca.appendChild(document.createElement("td"));
        tabla.appendChild(filaBiblioteca);
      }
    });

    contenedor.appendChild(tabla);

    const botonAgregarProceso = document.createElement("button");
    botonAgregarProceso.type = "button";
    botonAgregarProceso.className = "boton-agregar-proceso";
    botonAgregarProceso.textContent = "+ Agregar proceso";
    botonAgregarProceso.addEventListener("click", () => {
      procesos.push(crearProcesoVacio(siguienteIdProceso(procesos)));
      marcarCambio();
    });
    contenedor.appendChild(botonAgregarProceso);
  }

  return {
    crearProcesoVacio,
    crearHiloVacio,
    siguienteIdProceso,
    letraDesdeIndice,
    estimacionEfectiva,
    renderizarTablaProcesos,
  };
})();
