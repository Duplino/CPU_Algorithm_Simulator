/**
 * main.js — Orquestador de la aplicación y UI genérica.
 *
 * Cada algoritmo cumple el mismo contrato: recibe (procesos, opciones) y
 * devuelve { gantt, franjasIO, colaListosPorInstante, metricas }. Gracias a
 * eso, este archivo puede tratarlos de forma genérica a través de
 * REGISTRO_ALGORITMOS — no hay switches gigantes por algoritmo acá ni en
 * ningún otro lado de la capa de UI. Agregar un algoritmo nuevo es agregar
 * una entrada a este registro.
 *
 * La UI tiene dos secciones separadas a propósito:
 *   - "Tu Solución": UNA sola grilla interactiva, independiente de cualquier
 *     algoritmo — es donde el alumno arma su respuesta a mano.
 *   - "Ver algoritmos": tarjetas, una por algoritmo agregado, cada una con
 *     su propio dropdown + parámetros y su solución de referencia SIEMPRE
 *     visible (no hay ninguna grilla interactiva acá). El botón "Corregir"
 *     de cada tarjeta compara la grilla compartida de "Tu Solución" contra
 *     la solución de ESE algoritmo.
 */
(function () {
  "use strict";

  /**
   * Definición de cada parámetro configurable en el header de una tarjeta
   * de algoritmo. `tipo: "booleano"` se dibuja como checkbox; el resto
   * (implícito) como input numérico.
   */
  const DEFINICION_PARAMETROS = {
    quantum: { etiqueta: "Quantum", valorPorDefecto: 2, min: 1, step: 1 },
    alfa: { etiqueta: "Alfa", valorPorDefecto: 0.5, min: 0, max: 1, step: 0.1 },
    estimacion: { tipo: "booleano", etiqueta: "Usar estimaciones", valorPorDefecto: false },
  };

  /** Dos líneas de tooltip: la fórmula simbólica arriba, la misma con los números de este proceso abajo. */
  function armarTooltip(formulaSimbolica, formulaSustituida) {
    return (
      `<div class="tooltip-formula-simbolica">${formulaSimbolica}</div>` +
      `<div class="tooltip-formula-sustituida">${formulaSustituida}</div>`
    );
  }

  /**
   * Tooltips que se ven al pasar el mouse por un proceso en la fila
   * "Listos" de la solución (con Tippy.js — ver ui/grilla-gantt.js): la
   * fórmula que arma el desempate, y debajo la misma fórmula con los
   * números de ESE proceso en ESE instante (`info` es lo que devuelve
   * `capturarInfoListos` en cada algoritmo). Solo aparecen cuando el
   * algoritmo realmente está usando una estimación (si no, no hay nada que
   * explicar: el criterio es directamente la ráfaga real).
   */
  function formatearTooltipSJF(info) {
    return armarTooltip("criterio = estimación de la ráfaga", `criterio = ${info.estimacion}`);
  }

  function formatearTooltipSRTF(info) {
    return armarTooltip(
      "restante_estimado = estimación − ejecutado",
      `restante_estimado = ${info.estimacion} − ${info.tiempoEjecutado} = ${info.restanteEstimado}`
    );
  }

  function formatearTooltipHRRN(info) {
    const ratio = info.ratio.toFixed(2);
    const variable = info.esEstimada ? "estimación" : "duración real";
    return armarTooltip(
      `ratio = (espera + ${variable}) / ${variable}`,
      `ratio = (${info.espera} + ${info.estimacion}) / ${info.estimacion} = ${ratio}`
    );
  }

  /**
   * Algoritmo -> { etiqueta, simular, parametros[], tieneCorreccion, modoColaListos }.
   *
   * `modoColaListos` decide qué fila(s) de cola de espera se agregan debajo
   * de la solución de ese algoritmo (ver ui/grilla-gantt.js):
   *   - "simple": una única fila de cola de listos.
   *   - "rrv": dos filas separadas (reingreso con quantum restante, y normal).
   */
  const REGISTRO_ALGORITMOS = {
    fifo: { etiqueta: "FIFO", simular: simularFIFO, parametros: [], tieneCorreccion: true, modoColaListos: "simple" },
    sjf: {
      etiqueta: "SJF (apropiativo)",
      simular: simularSJF,
      parametros: ["estimacion", "alfa"],
      tieneCorreccion: true,
      modoColaListos: "simple",
      formatearTooltipListos: formatearTooltipSJF,
    },
    srtf: {
      etiqueta: "SRTF (SJF expropiativo)",
      simular: simularSRTF,
      parametros: ["estimacion", "alfa"],
      tieneCorreccion: true,
      modoColaListos: "simple",
      formatearTooltipListos: formatearTooltipSRTF,
      // Mismo formato para la cola de espera y para las celdas de CPU: en
      // ambos casos `info` trae { estimacion, tiempoEjecutado, restanteEstimado }.
      formatearTooltipEjecucion: formatearTooltipSRTF,
    },
    hrrn: {
      etiqueta: "HRRN",
      simular: simularHRRN,
      parametros: ["estimacion", "alfa"],
      tieneCorreccion: true,
      modoColaListos: "simple",
      formatearTooltipListos: formatearTooltipHRRN,
    },
    prioridad: {
      etiqueta: "Prioridad (apropiativa)",
      simular: simularPrioridad,
      parametros: [],
      tieneCorreccion: true,
      modoColaListos: "simple",
    },
    "prioridad-expropiativa": {
      etiqueta: "Prioridad expropiativa",
      simular: simularPrioridadExpropiativa,
      parametros: [],
      tieneCorreccion: true,
      modoColaListos: "simple",
    },
    "round-robin": {
      etiqueta: "Round Robin",
      simular: simularRoundRobin,
      parametros: ["quantum"],
      tieneCorreccion: true,
      modoColaListos: "simple",
    },
    "round-robin-virtual": {
      etiqueta: "Round Robin Virtual",
      simular: simularRoundRobinVirtual,
      parametros: ["quantum"],
      tieneCorreccion: true,
      modoColaListos: "rrv",
    },
  };

  const estado = {
    procesos: [],
    bloques: [],
    grillaSolucion: null, // controlador de la única grilla interactiva de "Tu Solución" (incluye la fila de cola)
  };

  let contadorBloques = 0;

  // ----------------------------------------------------------------------
  // Procesos
  // ----------------------------------------------------------------------

  function renderizarProcesos() {
    const contenedor = document.getElementById("contenedor-procesos");
    EditorProcesos.renderizarTablaProcesos(contenedor, estado.procesos, {
      onCambio: () => {
        // Cambiar los procesos redefine el ejercicio entero: se reconstruye
        // "Tu Solución" desde cero (las filas dependen de qué procesos hay)
        // y se recalculan todos los algoritmos agregados.
        renderizarSeccionSolucion();
        recalcularTodosLosBloques();
      },
    });
  }

  // ----------------------------------------------------------------------
  // "Tu Solución": la única grilla interactiva, independiente del algoritmo
  // ----------------------------------------------------------------------

  /** Duración inicial razonable: el trabajo total del hilo más largo, sin esperas. */
  function calcularDuracionInicialSugerida(procesos) {
    if (procesos.length === 0) return 1;
    const finesHilos = [];
    procesos.forEach((p) => {
      p.hilos.forEach((h) => {
        finesHilos.push(h.arribo + h.rafagas.reduce((acc, r) => acc + r.duracion, 0));
      });
    });
    return Math.max(1, ...finesHilos);
  }

  function renderizarSeccionSolucion() {
    const contenedorGrilla = document.getElementById("contenedor-grilla-solucion");
    const colores = GrillaGantt.asignarColoresProcesos(estado.procesos);
    const duracionInicial = calcularDuracionInicialSugerida(estado.procesos);
    estado.grillaSolucion = GrillaGantt.crearGrillaInteractiva(contenedorGrilla, estado.procesos, duracionInicial, colores);
  }

  // ----------------------------------------------------------------------
  // "Ver algoritmos": tarjetas, una por algoritmo agregado
  // ----------------------------------------------------------------------

  function crearBloque(algoritmoInicial) {
    contadorBloques += 1;
    return {
      id: `bloque-${contadorBloques}`,
      algoritmo: algoritmoInicial,
      parametros: valoresPorDefectoParametros(algoritmoInicial),
      resultadoActual: null,
    };
  }

  function valoresPorDefectoParametros(algoritmo) {
    const parametros = {};
    REGISTRO_ALGORITMOS[algoritmo].parametros.forEach((clave) => {
      parametros[clave] = DEFINICION_PARAMETROS[clave].valorPorDefecto;
    });
    // HRRN es, por definición, "el algoritmo que trabaja con estimaciones"
    // — arranca con el toggle activado, a diferencia de SJF/SRTF (que por
    // default usan la ráfaga real, su definición clásica).
    if (algoritmo === "hrrn") parametros.estimacion = true;
    return parametros;
  }

  /** @param {string} [algoritmoInicial] - clave de REGISTRO_ALGORITMOS; "fifo" si no se especifica (ej. el botón "+ Agregar algoritmo"). */
  function agregarBloque(algoritmoInicial) {
    const bloque = crearBloque(algoritmoInicial || "fifo");
    estado.bloques.push(bloque);
    bloque.elementoDOM = construirElementoBloque(bloque);
    document.getElementById("contenedor-bloques").appendChild(bloque.elementoDOM);
  }

  function eliminarBloque(bloque) {
    estado.bloques = estado.bloques.filter((b) => b.id !== bloque.id);
    bloque.elementoDOM.remove();
    limpiarDialogoMetricas(bloque);
  }

  /**
   * Reconstruye SOLO la tarjeta indicada y la reemplaza en su lugar. Nunca
   * toca "Tu Solución" ni las demás tarjetas: cambiar el algoritmo o los
   * parámetros de UNA tarjeta no debería afectar nada más.
   */
  function rerenderizarBloque(bloque) {
    const nuevoElemento = construirElementoBloque(bloque);
    bloque.elementoDOM.replaceWith(nuevoElemento);
    bloque.elementoDOM = nuevoElemento;
  }

  /**
   * El modal de métricas de cada tarjeta (ver construirContenidoAlgoritmoSimulado)
   * se agrega directamente a <body> (no dentro de la tarjeta) para que el
   * <dialog> se centre en la ventana sin quedar recortado por el overflow de
   * ningún contenedor — por eso hay que quitarlo a mano tanto al eliminar la
   * tarjeta como antes de reconstruirla (si no, cada rerenderizarBloque
   * dejaría un <dialog> viejo huérfano flotando en <body>).
   */
  function limpiarDialogoMetricas(bloque) {
    if (bloque._dialogoMetricas) {
      bloque._dialogoMetricas.remove();
      bloque._dialogoMetricas = null;
    }
  }

  function construirElementoBloque(bloque) {
    limpiarDialogoMetricas(bloque);

    const seccion = document.createElement("section");
    seccion.className = "bloque-algoritmo";

    seccion.appendChild(construirHeaderBloque(bloque));

    const contenidoBloque = document.createElement("div");
    contenidoBloque.className = "contenido-bloque";
    seccion.appendChild(contenidoBloque);

    construirContenidoAlgoritmoSimulado(contenidoBloque, bloque);

    return seccion;
  }

  function construirHeaderBloque(bloque) {
    const header = document.createElement("div");
    header.className = "header-bloque";

    const selectAlgoritmo = document.createElement("select");
    selectAlgoritmo.className = "select-algoritmo";
    Object.keys(REGISTRO_ALGORITMOS).forEach((clave) => {
      const opcion = document.createElement("option");
      opcion.value = clave;
      opcion.textContent = REGISTRO_ALGORITMOS[clave].etiqueta;
      if (clave === bloque.algoritmo) opcion.selected = true;
      selectAlgoritmo.appendChild(opcion);
    });
    selectAlgoritmo.addEventListener("change", () => {
      bloque.algoritmo = selectAlgoritmo.value;
      bloque.parametros = valoresPorDefectoParametros(bloque.algoritmo);
      rerenderizarBloque(bloque);
    });
    header.appendChild(selectAlgoritmo);

    const contenedorParametros = document.createElement("div");
    contenedorParametros.className = "parametros-bloque";
    // Los parámetros que requiere cada algoritmo salen del registro — no hay
    // casos hardcodeados acá: si un algoritmo declara ["quantum"], aparece
    // el input de quantum; si declara [], no aparece ningún parámetro extra.
    REGISTRO_ALGORITMOS[bloque.algoritmo].parametros.forEach((clave) => {
      // "alfa" solo importa si además se están usando estimaciones — si el
      // toggle está apagado no se usa para nada, así que no se muestra.
      if (clave === "alfa" && !bloque.parametros.estimacion) return;
      contenedorParametros.appendChild(construirInputParametro(bloque, clave));
    });
    header.appendChild(contenedorParametros);

    // Agrupados en un contenedor propio (en vez de "margin-left: auto" en
    // cada botón) para que ambos queden pegados entre sí a la derecha del header.
    const contenedorAcciones = document.createElement("div");
    contenedorAcciones.className = "acciones-header-bloque";

    const botonInfo = document.createElement("button");
    botonInfo.type = "button";
    botonInfo.className = "boton-info-metricas";
    botonInfo.textContent = "ⓘ";
    botonInfo.title = "Ver tabla de espera, retorno y respuesta";
    botonInfo.addEventListener("click", () => {
      if (bloque._dialogoMetricas) bloque._dialogoMetricas.showModal();
    });
    contenedorAcciones.appendChild(botonInfo);

    const botonEliminar = document.createElement("button");
    botonEliminar.type = "button";
    botonEliminar.className = "boton-eliminar-bloque";
    botonEliminar.textContent = "Quitar";
    botonEliminar.addEventListener("click", () => eliminarBloque(bloque));
    contenedorAcciones.appendChild(botonEliminar);

    header.appendChild(contenedorAcciones);

    return header;
  }

  function construirInputParametro(bloque, clave) {
    const definicion = DEFINICION_PARAMETROS[clave];
    const contenedor = document.createElement("label");
    contenedor.className = "campo-parametro";

    if (definicion.tipo === "booleano") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!bloque.parametros[clave];
      input.addEventListener("change", () => {
        bloque.parametros[clave] = input.checked;
        // Prender/apagar el toggle cambia qué otros parámetros se ven
        // (ej. "alfa") y si aparece la columna de estimación inicial en la
        // grilla — hace falta reconstruir toda la tarjeta, no solo
        // recalcular.
        rerenderizarBloque(bloque);
      });
      contenedor.appendChild(input);

      const texto = document.createElement("span");
      texto.textContent = definicion.etiqueta;
      contenedor.appendChild(texto);

      return contenedor;
    }

    const texto = document.createElement("span");
    texto.textContent = definicion.etiqueta;
    contenedor.appendChild(texto);

    const input = document.createElement("input");
    input.type = "number";
    input.min = String(definicion.min);
    if (definicion.max != null) input.max = String(definicion.max);
    if (definicion.step != null) input.step = String(definicion.step);
    input.value = bloque.parametros[clave];
    input.addEventListener("change", () => {
      bloque.parametros[clave] = Number(input.value);
      ejecutarYRenderizarBloque(bloque);
    });
    contenedor.appendChild(input);

    return contenedor;
  }

  /**
   * Config de la columna extra de estimación inicial (ver
   * ui/grilla-gantt.js): se agrega DENTRO de la misma grilla de la
   * solución, entre la etiqueta del proceso y sus celdas de instantes — no
   * es una tabla aparte, es una columna más de la grilla que ya existe.
   * La usan SJF, SRTF y HRRN, cada vez que su toggle "Usar estimaciones"
   * está activado.
   */
  function construirColumnaExtraEstimacion() {
    return {
      encabezado: "Est.",
      obtenerValor: (procesoId) => {
        const proceso = estado.procesos.find((p) => p.id === procesoId);
        return EditorProcesos.estimacionEfectiva(proceso);
      },
      onCambio: (procesoId, nuevoValor) => {
        const proceso = estado.procesos.find((p) => p.id === procesoId);
        proceso.estimacionInicial = nuevoValor || 0;
        // Recalcula todas las tarjetas (no solo esta): la estimación
        // inicial es por proceso, no por bloque — si hay más de un bloque
        // con estimaciones activadas (sea SJF, SRTF o HRRN), todos
        // comparten el mismo valor y deben quedar sincronizados.
        recalcularTodosLosBloques();
      },
    };
  }

  /**
   * Config de la columna extra de prioridad (mismo mecanismo que la
   * estimación de arriba): la prioridad ya no se edita en la tabla de
   * "Procesos" — solo la usan Prioridad y Prioridad expropiativa, así que
   * vive en SUS tarjetas. A diferencia de la estimación, siempre está
   * presente en esas dos tarjetas (no hay toggle: esos algoritmos no
   * funcionan sin prioridad).
   */
  function construirColumnaExtraPrioridad() {
    return {
      encabezado: "Prior.",
      obtenerValor: (procesoId) => {
        const proceso = estado.procesos.find((p) => p.id === procesoId);
        return proceso.prioridad;
      },
      onCambio: (procesoId, nuevoValor) => {
        const proceso = estado.procesos.find((p) => p.id === procesoId);
        proceso.prioridad = nuevoValor || 0;
        // Igual que con la estimación: la prioridad es por proceso, así que
        // sincroniza ambas tarjetas (Prioridad y Prioridad expropiativa) si
        // las dos están agregadas.
        recalcularTodosLosBloques();
      },
    };
  }

  function construirContenidoAlgoritmoSimulado(contenedor, bloque) {
    const areaGrillaSolucion = document.createElement("div");
    areaGrillaSolucion.className = "area-grilla-solucion";
    contenedor.appendChild(areaGrillaSolucion);

    const areaAcciones = document.createElement("div");
    areaAcciones.className = "area-acciones";
    const botonCorregir = document.createElement("button");
    botonCorregir.type = "button";
    botonCorregir.className = "boton-corregir";
    botonCorregir.textContent = "Corregir mi solución";
    areaAcciones.appendChild(botonCorregir);

    const mensajeResultado = document.createElement("span");
    mensajeResultado.className = "mensaje-resultado";
    areaAcciones.appendChild(mensajeResultado);
    contenedor.appendChild(areaAcciones);

    // La tabla de espera/retorno/respuesta ya no va inline en la tarjeta:
    // vive en un <dialog> aparte (ver el botón "ⓘ" del header, junto a
    // "Quitar" — construirHeaderBloque) que se abre a pedido. El <dialog> se
    // agrega a <body> (no a `contenedor`) para que se centre en la ventana
    // sin quedar recortado — limpiarDialogoMetricas se ocupa de sacarlo de
    // ahí cuando la tarjeta se elimina o se reconstruye.
    const dialogoMetricas = document.createElement("dialog");
    dialogoMetricas.className = "modal-metricas";
    const areaMetricas = document.createElement("div");
    areaMetricas.className = "area-metricas";
    dialogoMetricas.appendChild(areaMetricas);
    const botonCerrarModal = document.createElement("button");
    botonCerrarModal.type = "button";
    botonCerrarModal.className = "boton-cerrar-modal";
    botonCerrarModal.textContent = "Cerrar";
    botonCerrarModal.addEventListener("click", () => dialogoMetricas.close());
    dialogoMetricas.appendChild(botonCerrarModal);
    document.body.appendChild(dialogoMetricas);
    bloque._dialogoMetricas = dialogoMetricas;

    botonCorregir.addEventListener("click", () => {
      if (!estado.grillaSolucion || !bloque.resultadoActual) return;
      const respuesta = estado.grillaSolucion.obtenerRespuesta();
      estado.grillaSolucion.limpiarMarcas();
      const { correcto, celdasIncorrectas } = Corrector.corregir(respuesta, estado.procesos, bloque.resultadoActual);
      celdasIncorrectas.forEach(({ procesoId, instante }) =>
        estado.grillaSolucion.marcarCelda(procesoId, instante, "celda-incorrecta")
      );
      mensajeResultado.textContent = correcto
        ? "¡Correcto!"
        : "Incorrecto — revisá las celdas marcadas en Tu Solución.";
      mensajeResultado.className = `mensaje-resultado ${correcto ? "mensaje-correcto" : "mensaje-incorrecto"}`;
    });

    bloque._refs = { areaGrillaSolucion, areaMetricas, mensajeResultado };
    ejecutarYRenderizarBloque(bloque);
  }

  const ALGORITMOS_CON_PRIORIDAD = new Set(["prioridad", "prioridad-expropiativa"]);

  function ejecutarYRenderizarBloque(bloque) {
    if (estado.procesos.length === 0 || !bloque._refs) return;

    const definicion = REGISTRO_ALGORITMOS[bloque.algoritmo];
    bloque.resultadoActual = definicion.simular(estado.procesos, bloque.parametros);

    let columnaExtra = null;
    if (bloque.parametros.estimacion) columnaExtra = construirColumnaExtraEstimacion();
    else if (ALGORITMOS_CON_PRIORIDAD.has(bloque.algoritmo)) columnaExtra = construirColumnaExtraPrioridad();

    const colores = GrillaGantt.asignarColoresProcesos(estado.procesos);
    GrillaGantt.renderizarGrillaSolucion(bloque._refs.areaGrillaSolucion, estado.procesos, bloque.resultadoActual, colores, {
      modo: definicion.modoColaListos,
      columnaExtra,
      formatearTooltipListos: definicion.formatearTooltipListos,
      formatearTooltipEjecucion: definicion.formatearTooltipEjecucion,
    });
    Metricas.renderizarMetricas(bloque._refs.areaMetricas, bloque.resultadoActual.metricas);

    bloque._refs.mensajeResultado.textContent = "";
    bloque._refs.mensajeResultado.className = "mensaje-resultado";

    // Si esta solución necesita más instantes de los que "Tu Solución" tiene
    // hoy, se le agregan columnas de más (sin borrar lo que el alumno ya
    // completó) para que siempre haya lugar suficiente para responder.
    if (estado.grillaSolucion) {
      const { duracionTotal } = GrillaGantt.construirDatosPorProceso(estado.procesos, bloque.resultadoActual);
      estado.grillaSolucion.asegurarDuracionMinima(duracionTotal);
    }
  }

  function recalcularTodosLosBloques() {
    estado.bloques.forEach((bloque) => ejecutarYRenderizarBloque(bloque));
  }

  // ----------------------------------------------------------------------
  // Carga de datos (importar / exportar / aleatorio)
  // ----------------------------------------------------------------------

  function cargarProcesos(nuevosProcesos) {
    estado.procesos = nuevosProcesos;
    renderizarProcesos();
    renderizarSeccionSolucion();
    recalcularTodosLosBloques();
  }

  /**
   * Normaliza un proceso "crudo" (leído de un .json importado, que puede
   * venir incompleto o con tipos distintos) al formato interno completo —
   * para no romper el resto de la app si falta algún campo opcional.
   */
  function normalizarProcesoImportado(p, indice) {
    const id = p && p.id != null ? String(p.id) : EditorProcesos.letraDesdeIndice(indice);
    const hilosCrudos = p && Array.isArray(p.hilos) && p.hilos.length > 0 ? p.hilos : [{}];
    const hilos = hilosCrudos.map((h, i) => ({
      id: h && h.id != null ? String(h.id) : String(i + 1),
      tipo: h && h.tipo === "ULT" ? "ULT" : "KLT",
      arribo: h && h.arribo != null ? Math.max(0, Number(h.arribo) || 0) : 0,
      rafagas:
        h && Array.isArray(h.rafagas) && h.rafagas.length > 0
          ? h.rafagas.map((r) => ({ tipo: r && r.tipo === "IO" ? "IO" : "CPU", duracion: Math.max(1, Number(r && r.duracion) || 1) }))
          : [{ tipo: "CPU", duracion: 1 }],
    }));
    return {
      id,
      prioridad: p && p.prioridad != null ? Number(p.prioridad) : 1,
      estimacionInicial: p && p.estimacionInicial != null ? Number(p.estimacionInicial) : null,
      algoritmoBiblioteca: p && p.algoritmoBiblioteca ? p.algoritmoBiblioteca : null,
      hilos,
    };
  }

  function importarDatos(datos) {
    if (!datos || !Array.isArray(datos.procesos) || datos.procesos.length === 0) {
      throw new Error("El archivo no tiene un array de \"procesos\" válido.");
    }
    cargarProcesos(datos.procesos.map(normalizarProcesoImportado));
  }

  function importarProcesosDesdeArchivo(archivo) {
    const lector = new FileReader();
    lector.onload = () => {
      try {
        importarDatos(JSON.parse(lector.result));
      } catch (error) {
        alert(`No se pudo importar el archivo: ${error.message}`);
      }
    };
    lector.onerror = () => alert("No se pudo leer el archivo.");
    lector.readAsText(archivo);
  }

  async function importarProcesosDesdeUrl() {
    const url = prompt("URL del archivo .json de consignas a importar:");
    if (!url) return;
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      importarDatos(await respuesta.json());
    } catch (error) {
      alert(`No se pudo importar desde esa URL: ${error.message}`);
    }
  }

  /** Arma un blob JSON con `datos` y dispara su descarga como `<nombreSugerido>.json`. */
  function descargarJSON(datos, nombreSugerido) {
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `${nombreSugerido.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "descarga"}.json`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
  }

  /** Descarga las consignas (los procesos) actuales como .json, en el mismo formato que se puede volver a importar. */
  function exportarProcesos() {
    if (estado.procesos.length === 0) {
      alert("No hay procesos para exportar.");
      return;
    }
    const nombre = prompt("Nombre del ejercicio:", "Mi ejercicio") || "ejercicio";
    descargarJSON({ nombre, procesos: estado.procesos }, nombre);
  }

  // ----------------------------------------------------------------------
  // Importar/exportar SOLUCIÓN (la respuesta armada a mano en "Tu Solución":
  // las celdas CPU/IO de cada carril + las colas). A diferencia de las
  // consignas, una solución solo tiene sentido aplicada sobre el ejercicio
  // que ya está cargado — no trae sus propios procesos, así que IDs de
  // carril o de proceso que no existen en el ejercicio actual se ignoran en
  // silencio (ver GrillaGantt.cargarRespuesta/cargarColas).
  // ----------------------------------------------------------------------

  /** Descarga la solución actual (lo completado en "Tu Solución") como .json. */
  function exportarSolucion() {
    if (!estado.grillaSolucion) {
      alert("Todavía no hay una grilla en \"Tu Solución\" para exportar.");
      return;
    }
    const nombre = prompt("Nombre para este archivo de solución:", "Mi solución") || "solucion";
    descargarJSON(
      {
        nombre,
        respuesta: estado.grillaSolucion.obtenerRespuesta(),
        colas: estado.grillaSolucion.obtenerColas(),
      },
      nombre
    );
  }

  function aplicarDatosSolucion(datos) {
    if (!estado.grillaSolucion) {
      throw new Error("Todavía no hay procesos cargados para aplicar una solución.");
    }
    if (!datos || (typeof datos !== "object")) {
      throw new Error("El archivo no tiene datos de solución válidos.");
    }
    if (datos.respuesta) estado.grillaSolucion.cargarRespuesta(datos.respuesta);
    if (datos.colas) estado.grillaSolucion.cargarColas(datos.colas);
  }

  function importarSolucionDesdeArchivo(archivo) {
    const lector = new FileReader();
    lector.onload = () => {
      try {
        aplicarDatosSolucion(JSON.parse(lector.result));
      } catch (error) {
        alert(`No se pudo importar la solución: ${error.message}`);
      }
    };
    lector.onerror = () => alert("No se pudo leer el archivo.");
    lector.readAsText(archivo);
  }

  async function importarSolucionDesdeUrl() {
    const url = prompt("URL del archivo .json de la solución a importar:");
    if (!url) return;
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      aplicarDatosSolucion(await respuesta.json());
    } catch (error) {
      alert(`No se pudo importar la solución desde esa URL: ${error.message}`);
    }
  }

  function generarAleatorio() {
    const cantidad = 3 + Math.floor(Math.random() * 2); // entre 3 y 4 procesos
    // La cantidad de pares CPU/IO se sortea UNA vez y se aplica a todos los
    // procesos por igual (no cada uno la suya), para que sean comparables
    // entre sí a simple vista.
    const cantidadPares = 2 + Math.floor(Math.random() * 3); // entre 2 y 4 pares
    const procesos = [];
    for (let i = 0; i < cantidad; i++) {
      const rafagas = [];
      for (let par = 0; par < cantidadPares; par++) {
        rafagas.push({ tipo: "CPU", duracion: 1 + Math.floor(Math.random() * 6) });
        rafagas.push({ tipo: "IO", duracion: 1 + Math.floor(Math.random() * 4) });
      }
      procesos.push({
        id: EditorProcesos.letraDesdeIndice(i),
        prioridad: 1 + Math.floor(Math.random() * 5),
        estimacionInicial: null,
        algoritmoBiblioteca: null,
        hilos: [{ id: "1", tipo: "KLT", arribo: 1 + Math.floor(Math.random() * 4), rafagas }],
      });
    }
    cargarProcesos(procesos);
  }

  // ----------------------------------------------------------------------
  // Modo claro/oscuro
  // ----------------------------------------------------------------------

  /** Tema visual efectivo ahora mismo: el explícito guardado, o si no hay, el del sistema. */
  function temaActual() {
    return (
      document.documentElement.dataset.theme ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  }

  function actualizarBotonTema(boton) {
    const esOscuro = temaActual() === "dark";
    boton.textContent = esOscuro ? "☀️" : "🌙";
    boton.setAttribute("aria-label", esOscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
  }

  function inicializarTema() {
    const boton = document.getElementById("boton-tema");
    actualizarBotonTema(boton);
    boton.addEventListener("click", () => {
      const nuevoTema = temaActual() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = nuevoTema;
      try {
        localStorage.setItem("tema", nuevoTema);
      } catch (error) {
        // Sin localStorage disponible, el tema elegido no persiste entre recargas — no es grave.
      }
      actualizarBotonTema(boton);
    });
  }

  // ----------------------------------------------------------------------
  // Arranque
  // ----------------------------------------------------------------------

  function inicializar() {
    inicializarTema();

    const inputProcesosArchivo = document.getElementById("input-cargar-procesos-archivo");
    document.getElementById("boton-cargar-procesos-archivo").addEventListener("click", () => inputProcesosArchivo.click());
    inputProcesosArchivo.addEventListener("change", (ev) => {
      const archivo = ev.target.files[0];
      if (archivo) importarProcesosDesdeArchivo(archivo);
      ev.target.value = ""; // permite volver a importar el mismo archivo después
    });
    document.getElementById("boton-cargar-procesos-link").addEventListener("click", importarProcesosDesdeUrl);
    document.getElementById("boton-descargar-procesos").addEventListener("click", exportarProcesos);
    document.getElementById("boton-generar-aleatorio").addEventListener("click", generarAleatorio);

    const inputSolucionArchivo = document.getElementById("input-cargar-solucion-archivo");
    document.getElementById("boton-cargar-solucion-archivo").addEventListener("click", () => inputSolucionArchivo.click());
    inputSolucionArchivo.addEventListener("change", (ev) => {
      const archivo = ev.target.files[0];
      if (archivo) importarSolucionDesdeArchivo(archivo);
      ev.target.value = "";
    });
    document.getElementById("boton-cargar-solucion-link").addEventListener("click", importarSolucionDesdeUrl);
    document.getElementById("boton-descargar-solucion").addEventListener("click", exportarSolucion);

    document.getElementById("boton-agregar-bloque").addEventListener("click", () => agregarBloque());

    inicializarDesdeQuery();
  }

  /** Carga los dos procesos de ejemplo (A, B) con los que arranca la app cuando no hay "?procesos=" en la URL. */
  function cargarEjercicioPorDefecto() {
    const b = EditorProcesos.crearProcesoVacio("B");
    b.hilos[0].arribo = 1;
    cargarProcesos([EditorProcesos.crearProcesoVacio("A"), b]);
  }

  /**
   * Estado inicial del ejercicio y de "Ver algoritmos" — por defecto el
   * ejercicio de ejemplo (A, B) y una única tarjeta FIFO, salvo que la URL
   * traiga parámetros que los reemplacen (útil para compartir un link que
   * abra la app ya armada, ej. desde un campus virtual):
   *
   *   - "?procesos=<url>": importa las consignas desde ese link al arrancar
   *     (en vez del ejercicio de ejemplo) — mismo formato que "Descargar" en
   *     Procesos.
   *   - "?solucion=<url>": importa además una solución desde ese link,
   *     aplicada SOBRE las consignas ya cargadas (sean las del ejercicio de
   *     ejemplo o las de "?procesos=") — mismo formato que "Descargar" en
   *     Tu Solución. Sin "?procesos=" se aplica sobre el ejercicio de
   *     ejemplo, así que solo tiene sentido combinado con "?procesos=" de
   *     ese mismo ejercicio.
   *   - "?algoritmos=fifo,srtf,...": agrega esas tarjetas en "Ver
   *     algoritmos" en vez de la única tarjeta FIFO por defecto — claves
   *     separadas por comas, tal cual las de REGISTRO_ALGORITMOS (las que no
   *     coinciden con ninguna se ignoran).
   */
  async function inicializarDesdeQuery() {
    const parametros = new URLSearchParams(window.location.search);
    const procesosUrl = parametros.get("procesos");

    if (procesosUrl) {
      try {
        const respuesta = await fetch(procesosUrl);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        importarDatos(await respuesta.json());
      } catch (error) {
        alert(`No se pudo cargar el ejercicio desde el link del parámetro "procesos": ${error.message}`);
        cargarEjercicioPorDefecto();
      }
    } else {
      cargarEjercicioPorDefecto();
    }

    const solucionUrl = parametros.get("solucion");
    if (solucionUrl) {
      try {
        const respuesta = await fetch(solucionUrl);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        aplicarDatosSolucion(await respuesta.json());
      } catch (error) {
        alert(`No se pudo cargar la solución desde el link del parámetro "solucion": ${error.message}`);
      }
    }

    const clavesAlgoritmos = (parametros.get("algoritmos") || "")
      .split(",")
      .map((clave) => clave.trim())
      .filter((clave) => REGISTRO_ALGORITMOS[clave]);

    if (clavesAlgoritmos.length > 0) clavesAlgoritmos.forEach((clave) => agregarBloque(clave));
    else agregarBloque();
  }

  document.addEventListener("DOMContentLoaded", inicializar);
})();
