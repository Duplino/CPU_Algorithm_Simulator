/**
 * grilla-gantt.js — Grilla de Gantt tipo "swimlane": una fila por proceso,
 * una columna por instante de tiempo. Cada celda tiene 3 estados posibles:
 * vacía (nada), "CPU" (el proceso está ejecutando) o "IO" (el proceso está
 * haciendo entrada/salida). Se usa tanto para que el alumno complete su
 * respuesta a mano como para mostrar la solución de referencia.
 *
 * Reglas de exclusión mutua (una sola CPU, un solo dispositivo de IO):
 * en una misma columna (mismo instante), a lo sumo UNA celda puede estar en
 * "CPU" y a lo sumo UNA puede estar en "IO" — pero sí pueden coexistir un
 * proceso en CPU y otro distinto en IO al mismo tiempo. Al marcar una celda
 * como CPU (o IO), cualquier otra celda de esa misma columna que ya tuviera
 * ese mismo estado se libera automáticamente.
 *
 * Interacción: cada click sobre una celda avanza un paso en el ciclo
 * vacío → CPU → IO → vacío → … Todos los clicks se tratan igual (no hay
 * click simple vs. doble click).
 *
 * La grilla del alumno (no la solución, que es de solo lectura y de
 * duración fija) además permite agregar columnas: el ejercicio puede
 * necesitar más instantes de los que el alumno anticipó al empezar.
 *
 * Esa misma grilla del alumno tiene, debajo del eje de instantes, una o más
 * filas de cola de listos armadas a mano ("+ Agregar cola", cada una con su
 * propio nombre editable — útil, por ejemplo, para separar colas por nivel
 * de prioridad). Por cada instante el alumno puede agregar procesos y
 * reordenarlos arrastrando un chip a otra posición — incluso a la
 * columna de OTRO instante o a OTRA cola — es un espacio de organización
 * libre, análogo a la fila de solo lectura que se ve debajo de las
 * soluciones de los algoritmos, pero editable.
 */
const GrillaGantt = (function () {
  "use strict";

  const CANTIDAD_COLORES = 8;
  const ORDEN_ESTADOS = ["", "CPU", "IO"];
  // Dos columnas de etiqueta: la primera es el proceso (se agranda con
  // rowspan para cubrir las filas de sus hilos), la segunda es el hilo
  // puntual (solo tiene contenido en filas de hilos agregados).
  const ANCHO_COLUMNA_PROCESO = "64px";
  const ANCHO_COLUMNA_HILO = "52px";
  const ANCHO_COLUMNA_EXTRA = "56px";
  // Ancho FIJO (no "1fr") de cada columna de instante: así las celdas de
  // ejecución quedan siempre cuadradas y de tamaño estable, sin importar
  // cuántos instantes tenga la grilla — antes usaban minmax(., 1fr), que las
  // hacía más angostas a medida que se agregaban columnas. Ver
  // `.celda-proceso` en css/styles.css (aspect-ratio: 1) para el otro lado
  // del cuadrado.
  const ANCHO_COLUMNA_INSTANTE = "36px";

  /** Asigna a cada proceso una clase de color estable, en orden de creación. */
  function asignarColoresProcesos(procesos) {
    const colores = {};
    procesos.forEach((p, indice) => {
      const clase = `proceso-color-${(indice % CANTIDAD_COLORES) + 1}`;
      colores[p.id] = clase;
      // Los hilos de un proceso comparten el color de su proceso — son
      // parte de la misma "familia", no procesos independientes.
      p.hilos.forEach((hilo) => {
        colores[`${p.id}.${hilo.id}`] = clase;
      });
    });
    return colores;
  }

  /**
   * Convierte la lista de procesos en la lista plana de "carriles" que
   * realmente dibuja la grilla: uno por cada hilo de `proceso.hilos[]`.
   * Ningún hilo tiene trato especial — un proceso siempre tiene al menos
   * uno, y todos se recorren de la misma manera. `esPrimerHiloDelProceso`
   * marca únicamente al primero de cada proceso, que es el único dato que
   * todavía hace falta distinguir (para la columna extra de estimación o
   * prioridad, que es por proceso y se muestra una sola vez — ver más abajo).
   */
  function construirCarriles(procesos) {
    const carriles = [];
    procesos.forEach((proceso) => {
      proceso.hilos.forEach((hilo, indice) => {
        carriles.push({
          id: `${proceso.id}.${hilo.id}`,
          procesoId: proceso.id,
          rafagas: hilo.rafagas,
          etiqueta: hilo.id,
          esPrimerHiloDelProceso: indice === 0,
        });
      });
    });
    return carriles;
  }

  /**
   * Reconstruye, para cada CARRIL (proceso o hilo — ver `construirCarriles`),
   * un array con su estado ("CPU" | "IO" | null) en cada instante, a partir
   * de lo que devuelve un algoritmo (`gantt` para los tramos de CPU,
   * `franjasIO` para los de IO). Ningún algoritmo simula hilos todavía, así
   * que sus datos siempre quedan en null (fila vacía, editable a mano nomás
   * en "Tu Solución") — solo el carril principal de cada proceso tiene
   * datos reales, porque es el único que el motor conoce.
   */
  function construirDatosPorProceso(procesos, resultado) {
    const finesGantt = resultado.gantt.map((b) => b.fin);
    const finesIO = (resultado.franjasIO || []).map((f) => f.fin);
    const duracionTotal = Math.max(0, ...finesGantt, ...finesIO);

    const datos = {};
    construirCarriles(procesos).forEach((carril) => {
      datos[carril.id] = new Array(duracionTotal).fill(null);
    });

    resultado.gantt.forEach((bloque) => {
      if (bloque.tipo !== "CPU") return;
      for (let t = bloque.inicio; t < bloque.fin; t++) datos[bloque.proceso][t] = "CPU";
    });
    (resultado.franjasIO || []).forEach((franja) => {
      for (let t = franja.inicio; t < franja.fin; t++) datos[franja.proceso][t] = "IO";
    });

    return { datos, duracionTotal };
  }

  /**
   * Para cada tramo de CPU consolidado, decide CÓMO terminó y guarda esa
   * razón en la ÚLTIMA celda de ese tramo (solo se usa en las grillas de
   * solución, de solo lectura — mostrarlo en la del alumno le regalaría la
   * respuesta). Las tres razones son mutuamente excluyentes y agotan todos
   * los casos posibles en los que un tramo de CPU puede terminar:
   *
   *   - "terminado": esa ráfaga era la última del proceso (deriva del
   *     instante de retorno en `resultado.metricas`).
   *   - "io": inmediatamente después arranca una ráfaga de IO (hay una
   *     franja en `resultado.franjasIO` que empieza justo ahí).
   *   - "desalojado": ninguna de las dos anteriores — el proceso todavía
   *     tenía ráfaga por delante y perdió la CPU sin haber terminado (por
   *     quantum, o porque otro proceso lo desplazó).
   */
  function construirMarcadoresTransicion(procesos, resultado) {
    const marcadores = {};
    construirCarriles(procesos).forEach((c) => (marcadores[c.id] = {}));

    // "Terminado" se deriva de la propia actividad de CADA carril (no de
    // `resultado.metricas`, que solo trae una fila por proceso): es el
    // tramo de CPU cuyo fin coincide con la ÚLTIMA vez que ese carril tuvo
    // actividad (CPU o IO) en toda la solución — así funciona igual para
    // un proceso, un hilo KLT independiente o un hilo ULT dentro de un
    // grupo, sin que este archivo necesite saber nada de esa distinción.
    const ultimaActividad = {};
    const anotarUltimaActividad = (id, fin) => {
      ultimaActividad[id] = Math.max(ultimaActividad[id] || 0, fin);
    };
    resultado.gantt.forEach((bloque) => {
      if (bloque.tipo === "CPU") anotarUltimaActividad(bloque.proceso, bloque.fin);
    });

    const iniciosDeIOPorProceso = {};
    (resultado.franjasIO || []).forEach((franja) => {
      if (!iniciosDeIOPorProceso[franja.proceso]) iniciosDeIOPorProceso[franja.proceso] = new Set();
      iniciosDeIOPorProceso[franja.proceso].add(franja.inicio);
      anotarUltimaActividad(franja.proceso, franja.fin);
    });

    resultado.gantt.forEach((bloque) => {
      if (bloque.tipo !== "CPU") return;
      let razon;
      if (iniciosDeIOPorProceso[bloque.proceso] && iniciosDeIOPorProceso[bloque.proceso].has(bloque.fin)) razon = "io";
      else if (ultimaActividad[bloque.proceso] === bloque.fin) razon = "terminado";
      else razon = "desalojado";
      if (!marcadores[bloque.proceso]) marcadores[bloque.proceso] = {};
      marcadores[bloque.proceso][bloque.fin - 1] = razon;
    });

    return marcadores;
  }

  /**
   * Dibuja en `celda` la marca visual correspondiente a cómo terminó ese
   * tramo de CPU (ver `construirMarcadoresTransicion`):
   *   - "terminado": bordecito rojo alrededor de la celda.
   *   - "io": crucecita sobre el borde derecho.
   *   - "desalojado": puntito (por quantum o porque lo desplazó otro proceso).
   */
  function aplicarMarcadorTransicion(celda, razon) {
    if (razon === "terminado") {
      celda.classList.add("celda-terminada");
      return;
    }
    const marca = document.createElement("span");
    if (razon === "io") {
      marca.className = "marcador-transicion marcador-io";
      marca.textContent = "×";
    } else {
      marca.className = "marcador-transicion marcador-desalojado";
    }
    celda.appendChild(marca);
  }

  function aplicarEstadoCelda(celda, estado, coloresProcesos) {
    celda.classList.remove("celda-vacia", "celda-cpu", "celda-io");
    Array.from(celda.classList)
      .filter((c) => c.startsWith("proceso-color-"))
      .forEach((c) => celda.classList.remove(c));

    celda.dataset.estado = estado;
    celda.textContent = estado || "";

    if (estado === "CPU") {
      celda.classList.add("celda-cpu");
      if (coloresProcesos) celda.classList.add(coloresProcesos[celda.dataset.proceso]);
    } else if (estado === "IO") {
      celda.classList.add("celda-io");
    } else {
      celda.classList.add("celda-vacia");
    }
  }

  /** Aplica `nuevoEstado` a `celda`, liberando primero cualquier otra celda
   * de la misma columna que tuviera ese mismo estado (exclusión mutua). */
  function aplicarEstadoConExclusion(celda, nuevoEstado, celdasDeLaColumna, coloresProcesos) {
    if (nuevoEstado === "CPU" || nuevoEstado === "IO") {
      celdasDeLaColumna.forEach((otra) => {
        if (otra !== celda && otra.dataset.estado === nuevoEstado) aplicarEstadoCelda(otra, "", coloresProcesos);
      });
    }
    aplicarEstadoCelda(celda, nuevoEstado, coloresProcesos);
  }

  function habilitarInteraccion(celda, celdasDeLaColumna, coloresProcesos) {
    celda.addEventListener("click", () => {
      const indiceActual = ORDEN_ESTADOS.indexOf(celda.dataset.estado || "");
      const nuevoEstado = ORDEN_ESTADOS[(indiceActual + 1) % ORDEN_ESTADOS.length];
      aplicarEstadoConExclusion(celda, nuevoEstado, celdasDeLaColumna, coloresProcesos);
    });
  }

  /**
   * Construye la grilla swimlane completa: una fila por CARRIL (el hilo
   * principal de cada proceso, más una fila extra por cada hilo que se le
   * haya agregado — ver `construirCarriles`) + una fila final con el eje de
   * instantes, cuyos números quedan sobre las líneas divisorias de columna
   * (no centrados en la celda).
   *
   * Todas las celdas se ubican con `grid-row`/`grid-column` explícitos (en
   * vez de dejar que el orden del DOM las acomode solas) para poder agregar
   * columnas nuevas después sin tener que reconstruir toda la grilla.
   */
  function crearGrillaSwimlane(contenedor, opciones) {
    const {
      procesos,
      duracionInicial,
      editable,
      datosPorProceso,
      coloresProcesos,
      columnaExtra,
      tooltipsPorProceso,
      marcadoresPorProceso,
    } = opciones;
    contenedor.innerHTML = "";

    if (duracionInicial <= 0 || procesos.length === 0) return null;

    const carriles = construirCarriles(procesos);

    const grilla = document.createElement("div");
    grilla.className = "grilla-swimlane";

    // Etiquetas de proceso e hilo van en dos columnas separadas (1 y 2): la
    // del proceso se agranda (grid-row en span) para cubrir también las
    // filas de sus hilos, y la columna extra (si hay) va pegada a la
    // derecha de esas dos — todo lo demás (instantes, eje, cola) se corre
    // en consecuencia.
    const offsetColumnas = columnaExtra ? 1 : 0;
    const columnaInicioInstantes = 3 + offsetColumnas;

    let duracionActual = 0;
    const celdasPorInstante = [];
    const celdasPorProceso = {};
    carriles.forEach((c) => (celdasPorProceso[c.id] = []));

    // Columna 1: una etiqueta por PROCESO (no por carril), que ocupa con su
    // propio grid-row en span todas las filas de sus hilos — así "crece"
    // para cubrirlas a todas por igual (ninguna es "la principal").
    let filaAcumulada = 0;
    procesos.forEach((proceso) => {
      const cantidadFilasProceso = proceso.hilos.length;
      const etiquetaProceso = document.createElement("div");
      etiquetaProceso.className = "etiqueta-proceso";
      etiquetaProceso.textContent = proceso.id;
      etiquetaProceso.style.gridRow =
        cantidadFilasProceso > 1 ? `${filaAcumulada + 1} / span ${cantidadFilasProceso}` : String(filaAcumulada + 1);
      etiquetaProceso.style.gridColumn = "1";
      grilla.appendChild(etiquetaProceso);
      filaAcumulada += cantidadFilasProceso;
    });

    carriles.forEach((carril, indiceCarril) => {
      // Columna 2: TODOS los hilos muestran acá su propio nombre — ninguno
      // tiene trato especial.
      const etiquetaHilo = document.createElement("div");
      etiquetaHilo.className = "etiqueta-hilo";
      etiquetaHilo.textContent = carril.etiqueta;
      etiquetaHilo.style.gridRow = String(indiceCarril + 1);
      etiquetaHilo.style.gridColumn = "2";
      grilla.appendChild(etiquetaHilo);

      // La columna extra (estimación inicial, prioridad) es una propiedad
      // del PROCESO, no de cada hilo — se muestra una sola vez, en la fila
      // del primer hilo, no repetida en cada uno.
      if (columnaExtra && carril.esPrimerHiloDelProceso) {
        const celdaExtra = document.createElement("div");
        celdaExtra.className = "celda-extra-grilla";
        celdaExtra.style.gridRow = String(indiceCarril + 1);
        celdaExtra.style.gridColumn = "3";

        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.value = columnaExtra.obtenerValor(carril.procesoId);
        input.addEventListener("change", () => {
          columnaExtra.onCambio(carril.procesoId, Number(input.value) || 0);
        });
        celdaExtra.appendChild(input);
        grilla.appendChild(celdaExtra);
      }
    });

    // Las filas de "cola armada a mano" solo existen en la grilla editable —
    // es donde vive el editor de colas por instante (ver más abajo). Puede
    // haber VARIAS colas (ej. una por nivel de prioridad), cada una con
    // su propio nombre editable — el alumno las agrega y les
    // pone nombre con `agregarCola`/el botón "+ Agregar cola" más abajo.
    // `colas[i]` = { nombre }; `datosColas[i][t]` = array de ids de proceso en
    // esa cola en ese instante; `celdasColas[i][t]` = la celda DOM
    // correspondiente. Los tres quedan siempre alineados por índice de cola.
    const colas = [];
    const datosColas = [];
    const celdasColas = [];
    const etiquetasColas = [];
    let contadorColasCreadas = 0;

    function filaDeCola(indiceCola) {
      return carriles.length + 2 + indiceCola;
    }

    /**
     * Mueve una entrada de la cola de un instante (y una cola) a otro/a — o
     * la reordena dentro de la misma celda — únicamente por drag&drop (sin
     * botones de mover: se arrastra el chip directamente). Si el proceso ya
     * está en la cola destino, no hace nada (no tiene sentido que un mismo
     * proceso aparezca dos veces en la misma cola/instante).
     */
    function moverEntradaCola(colaOrigen, instanteOrigen, indiceOrigen, colaDestino, instanteDestino, indiceDestinoDeseado) {
      const listaOrigen = datosColas[colaOrigen][instanteOrigen];
      const listaDestino = datosColas[colaDestino][instanteDestino];
      const [procesoId] = listaOrigen.splice(indiceOrigen, 1);

      if (listaDestino.includes(procesoId)) {
        listaOrigen.splice(indiceOrigen, 0, procesoId); // deshacer: ya estaba en destino
        return;
      }

      let destino = indiceDestinoDeseado;
      if (colaOrigen === colaDestino && instanteOrigen === instanteDestino && indiceOrigen < destino) destino -= 1;
      destino = Math.max(0, Math.min(destino, listaDestino.length));
      listaDestino.splice(destino, 0, procesoId);

      renderizarCeldaCola(colaOrigen, instanteOrigen);
      if (colaDestino !== colaOrigen || instanteDestino !== instanteOrigen) renderizarCeldaCola(colaDestino, instanteDestino);
    }

    function renderizarCeldaCola(colaIndex, t) {
      const celda = celdasColas[colaIndex][t];
      celda.innerHTML = "";

      const lista = document.createElement("div");
      lista.className = "lista-cola-instante";
      lista.addEventListener("dragover", (ev) => ev.preventDefault());
      lista.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const datos = JSON.parse(ev.dataTransfer.getData("text/plain"));
        moverEntradaCola(datos.cola, datos.instante, datos.indice, colaIndex, t, datosColas[colaIndex][t].length);
      });

      datosColas[colaIndex][t].forEach((procesoId, indice) => {
        const chip = document.createElement("div");
        chip.className = "chip-cola-instante";
        if (coloresProcesos && coloresProcesos[procesoId]) {
          chip.style.background = `color-mix(in srgb, var(--${coloresProcesos[procesoId]}) 20%, var(--superficie))`;
        }
        chip.draggable = true;
        chip.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", JSON.stringify({ cola: colaIndex, instante: t, indice }));
          chip.classList.add("arrastrando");
        });
        chip.addEventListener("dragend", () => chip.classList.remove("arrastrando"));
        // Soltar sobre un chip puntual inserta ANTES de ese chip (permite
        // reordenar con precisión, no solo mandar al final de la lista).
        chip.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        });
        chip.addEventListener("drop", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const datos = JSON.parse(ev.dataTransfer.getData("text/plain"));
          moverEntradaCola(datos.cola, datos.instante, datos.indice, colaIndex, t, indice);
        });

        const etiquetaChip = document.createElement("span");
        etiquetaChip.className = "etiqueta-chip-cola";
        etiquetaChip.textContent = procesoId;
        chip.appendChild(etiquetaChip);

        const botonQuitar = document.createElement("button");
        botonQuitar.type = "button";
        botonQuitar.className = "boton-quitar-cola";
        botonQuitar.textContent = "×";
        botonQuitar.title = "Quitar de la cola";
        botonQuitar.addEventListener("click", () => {
          datosColas[colaIndex][t].splice(indice, 1);
          renderizarCeldaCola(colaIndex, t);
        });
        chip.appendChild(botonQuitar);

        lista.appendChild(chip);
      });
      celda.appendChild(lista);

      // Un proceso puede aparecer en varios instantes/colas distintos con el
      // tiempo, así que acá solo se excluye a quien YA está en ESTA cola en
      // ESTE instante, no en otros.
      const disponibles = procesos.map((p) => p.id).filter((id) => !datosColas[colaIndex][t].includes(id));
      if (disponibles.length > 0) {
        const select = document.createElement("select");
        select.className = "select-agregar-cola-instante";
        const opcionVacia = document.createElement("option");
        opcionVacia.value = "";
        opcionVacia.textContent = "+ Agregar…";
        select.appendChild(opcionVacia);
        disponibles.forEach((id) => {
          const opcion = document.createElement("option");
          opcion.value = id;
          opcion.textContent = id;
          select.appendChild(opcion);
        });
        select.addEventListener("change", () => {
          if (select.value) {
            datosColas[colaIndex][t].push(select.value);
            renderizarCeldaCola(colaIndex, t);
          }
        });
        celda.appendChild(select);
      }
    }

    /** Etiqueta (nombre editable + botón de quitar) de UNA fila de cola — no depende del instante. */
    function crearEtiquetaCola(colaIndex) {
      const contenedor = document.createElement("div");
      contenedor.className = "etiqueta-cola-listos etiqueta-cola-nombrable";
      contenedor.style.gridRow = String(filaDeCola(colaIndex));
      contenedor.style.gridColumn = "1 / span 2";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "input-nombre-cola";
      input.value = colas[colaIndex].nombre;
      input.title = "Nombre de esta cola";
      input.addEventListener("change", () => {
        colas[colaIndex].nombre = input.value.trim() || "Cola";
      });
      contenedor.appendChild(input);

      const botonQuitarCola = document.createElement("button");
      botonQuitarCola.type = "button";
      botonQuitarCola.className = "boton-quitar-cola-fila";
      botonQuitarCola.title = "Quitar esta cola";
      botonQuitarCola.textContent = "×";
      botonQuitarCola.addEventListener("click", () => eliminarCola(colaIndex));
      contenedor.appendChild(botonQuitarCola);

      grilla.appendChild(contenedor);
      etiquetasColas[colaIndex] = contenedor;
    }

    /**
     * Reconstruye TODAS las filas de cola (etiquetas + celdas de cada
     * instante) desde `colas`/`datosColas`. Se llama entera cada vez que la
     * cantidad de colas cambia (agregar/quitar una) — es más simple que
     * reindexar en el lugar las filas que quedan debajo de la que se quitó,
     * y acá el volumen de DOM es chico.
     */
    function reconstruirFilasColas() {
      etiquetasColas.forEach((el) => el && el.remove());
      etiquetasColas.length = 0;
      celdasColas.forEach((fila) => fila.forEach((c) => c && c.remove()));
      celdasColas.length = 0;

      colas.forEach((_cola, colaIndex) => {
        crearEtiquetaCola(colaIndex);
        celdasColas[colaIndex] = [];
        for (let t = 0; t < duracionActual; t++) {
          const celda = document.createElement("div");
          celda.className = "celda-cola-listos celda-cola-editable";
          celda.style.gridRow = String(filaDeCola(colaIndex));
          celda.style.gridColumn = String(columnaInicioInstantes + t);
          // El drop se acepta en TODA la celda (no solo en la listita interna
          // de chips): si el instante está vacío, la lista mide casi nada y
          // la mayor parte del área visible es el <select> de abajo — sin
          // esto, soltar ahí no movería nada.
          celda.addEventListener("dragover", (ev) => ev.preventDefault());
          celda.addEventListener("drop", (ev) => {
            ev.preventDefault();
            const datos = JSON.parse(ev.dataTransfer.getData("text/plain"));
            moverEntradaCola(datos.cola, datos.instante, datos.indice, colaIndex, t, datosColas[colaIndex][t].length);
          });
          grilla.appendChild(celda);
          celdasColas[colaIndex].push(celda);
          renderizarCeldaCola(colaIndex, t);
        }
      });
    }

    /** Agrega una cola nueva (fila propia, nombrable) al final. */
    function agregarCola(nombreInicial) {
      contadorColasCreadas += 1;
      datosColas.push(
        new Array(duracionActual).fill(null).map(() => [])
      );
      colas.push({ nombre: nombreInicial || (contadorColasCreadas === 1 ? "Cola" : `Cola ${contadorColasCreadas}`) });
      reconstruirFilasColas();
    }

    function eliminarCola(colaIndex) {
      colas.splice(colaIndex, 1);
      datosColas.splice(colaIndex, 1);
      reconstruirFilasColas();
    }

    let eje = null;
    let etiquetaColumnaExtra = null;

    function actualizarPlantillaColumnas() {
      const columnasEtiqueta = `${ANCHO_COLUMNA_PROCESO} ${ANCHO_COLUMNA_HILO}`;
      const columnaEtiqueta = columnaExtra ? `${columnasEtiqueta} ${ANCHO_COLUMNA_EXTRA}` : columnasEtiqueta;
      grilla.style.gridTemplateColumns = `${columnaEtiqueta} repeat(${duracionActual}, ${ANCHO_COLUMNA_INSTANTE})`;
    }

    function reconstruirEje() {
      if (eje) eje.remove();
      eje = document.createElement("div");
      eje.className = "fila-eje-instantes";
      eje.style.gridRow = String(carriles.length + 1);
      eje.style.gridColumn = `${columnaInicioInstantes} / span ${duracionActual}`;
      for (let t = 0; t <= duracionActual; t++) {
        const marca = document.createElement("span");
        marca.className = "marca-instante";
        marca.textContent = t;
        marca.style.left = `${(t / duracionActual) * 100}%`;
        if (t === 0) marca.style.transform = "translateX(0)";
        else if (t === duracionActual) marca.style.transform = "translateX(-100%)";
        eje.appendChild(marca);
      }
      grilla.appendChild(eje);

      // El encabezado de la columna extra vive en la misma fila que el eje
      // de instantes, para no tener que agregar una fila más solo para eso.
      if (columnaExtra) {
        if (etiquetaColumnaExtra) etiquetaColumnaExtra.remove();
        etiquetaColumnaExtra = document.createElement("div");
        etiquetaColumnaExtra.className = "etiqueta-columna-extra";
        etiquetaColumnaExtra.textContent = columnaExtra.encabezado;
        etiquetaColumnaExtra.style.gridRow = String(carriles.length + 1);
        etiquetaColumnaExtra.style.gridColumn = "3";
        grilla.appendChild(etiquetaColumnaExtra);
      }
    }

    /** Agrega una columna (instante) nueva al final, dejando el resto de la grilla intacto. */
    function agregarColumna() {
      const t = duracionActual;
      duracionActual += 1;
      actualizarPlantillaColumnas();

      const celdasDeLaColumna = [];
      celdasPorInstante.push(celdasDeLaColumna);

      carriles.forEach((carril, indiceCarril) => {
        const celda = document.createElement("div");
        celda.className = "celda-proceso celda-vacia";
        celda.dataset.estado = "";
        celda.dataset.proceso = carril.id;
        celda.dataset.instante = String(t);
        celda.style.gridRow = String(indiceCarril + 1);
        celda.style.gridColumn = String(columnaInicioInstantes + t);

        const valorInicial = datosPorProceso ? datosPorProceso[carril.id][t] : null;
        if (valorInicial) aplicarEstadoCelda(celda, valorInicial, coloresProcesos);

        // Solo en grillas de solo lectura: si el algoritmo expone una
        // "razón" para esta celda de ejecución puntual (hoy solo SRTF, con
        // el restante estimado que se comparó contra la cola en ESE tick),
        // se lo mostramos como tooltip al pasar el mouse. Ningún algoritmo
        // conoce hilos todavía, así que esto nunca aplica a filas de hilo.
        const tooltip = tooltipsPorProceso && tooltipsPorProceso[carril.id] && tooltipsPorProceso[carril.id][t];
        if (tooltip) aplicarTooltip(celda, tooltip);

        // También solo en grillas de solo lectura: marca en la ÚLTIMA celda
        // de cada tramo de CPU por qué terminó (ver construirMarcadoresTransicion).
        const razonTransicion = marcadoresPorProceso && marcadoresPorProceso[carril.id] && marcadoresPorProceso[carril.id][t];
        if (razonTransicion) aplicarMarcadorTransicion(celda, razonTransicion);

        if (editable) habilitarInteraccion(celda, celdasDeLaColumna, coloresProcesos);

        grilla.appendChild(celda);
        celdasDeLaColumna.push(celda);
        celdasPorProceso[carril.id].push(celda);
      });

      if (editable) {
        // Cada cola existente suma una columna nueva (vacía) en este
        // instante — reconstruirFilasColas se encarga de crear la celda
        // correspondiente para todas ellas de una vez.
        datosColas.forEach((porInstante) => porInstante.push([]));
        reconstruirFilasColas();
      }

      reconstruirEje();
    }

    if (editable) agregarCola(); // arranca con una única cola "Cola", como antes

    for (let t = 0; t < duracionInicial; t++) agregarColumna();

    contenedor.appendChild(grilla);

    if (editable) {
      const botonAgregarInstante = document.createElement("button");
      botonAgregarInstante.type = "button";
      botonAgregarInstante.className = "boton-agregar-instante";
      botonAgregarInstante.textContent = "+ Agregar instante";
      botonAgregarInstante.addEventListener("click", agregarColumna);
      contenedor.appendChild(botonAgregarInstante);

      const botonAgregarCola = document.createElement("button");
      botonAgregarCola.type = "button";
      botonAgregarCola.className = "boton-agregar-cola-fila";
      botonAgregarCola.textContent = "+ Agregar cola";
      botonAgregarCola.title = "Agregar otra fila de cola, con su propio nombre";
      botonAgregarCola.addEventListener("click", () => agregarCola());
      contenedor.appendChild(botonAgregarCola);
    }

    return {
      elemento: grilla,
      obtenerRespuesta: () => {
        const respuesta = {};
        // Se devuelve una entrada por CARRIL (incluye hilos), pero el
        // corrector solo mira las claves que coinciden con `proceso.id` —
        // las de hilos quedan ahí para que el alumno las use como espacio
        // libre, sin que nada las exija ni las corrija.
        carriles.forEach((carril) => {
          respuesta[carril.id] = celdasPorProceso[carril.id].map((c) => c.dataset.estado || null);
        });
        return respuesta;
      },
      marcarCelda: (procesoId, instante, clase) => {
        const celda = celdasPorProceso[procesoId] && celdasPorProceso[procesoId][instante];
        if (celda) celda.classList.add(clase);
      },
      limpiarMarcas: () => {
        Object.values(celdasPorProceso)
          .flat()
          .forEach((c) => c.classList.remove("celda-incorrecta"));
      },
      /**
       * Extiende la grilla (si hace falta) para que tenga al menos
       * `minimo` columnas, sin tocar lo que el alumno ya completó. La usa
       * "Tu Solución" para asegurarse de tener espacio suficiente cada vez
       * que se agrega o recalcula un algoritmo con una solución más larga.
       */
      asegurarDuracionMinima: (minimo) => {
        while (duracionActual < minimo) agregarColumna();
      },
      /**
       * Vuelca `respuesta` (misma forma que devuelve `obtenerRespuesta`,
       * `{ [carrilId]: Array<'CPU'|'IO'|null> }`) sobre la grilla — la usa
       * "Importar solución" (ver main.js). Agranda la grilla si la
       * respuesta trae más instantes de los que hay hoy; los carriles que
       * no aparecen en `respuesta` quedan sin tocar.
       */
      cargarRespuesta: (respuesta) => {
        if (!respuesta) return;
        let maximaDuracion = 0;
        Object.values(respuesta).forEach((valores) => {
          if (Array.isArray(valores)) maximaDuracion = Math.max(maximaDuracion, valores.length);
        });
        while (duracionActual < maximaDuracion) agregarColumna();

        carriles.forEach((carril) => {
          const valores = respuesta[carril.id];
          if (!valores) return;
          celdasPorProceso[carril.id].forEach((celda, t) => {
            aplicarEstadoCelda(celda, valores[t] || "", coloresProcesos);
          });
        });
      },
      /** Snapshot de las colas armadas a mano — { nombre, porInstante: [[id,...], ...] } por cola. */
      obtenerColas: () =>
        colas.map((cola, indiceCola) => ({
          nombre: cola.nombre,
          porInstante: datosColas[indiceCola].map((lista) => lista.slice()),
        })),
      /**
       * Reemplaza TODAS las colas actuales por `colasGuardadas` (misma forma
       * que devuelve `obtenerColas`) — la usa "Importar solución". IDs de
       * proceso que ya no existen en el ejercicio actual se descartan en
       * silencio, para no romper la carga si la solución es de otro
       * ejercicio con procesos distintos.
       */
      cargarColas: (colasGuardadas) => {
        colas.length = 0;
        datosColas.length = 0;
        const idsValidos = new Set(procesos.map((p) => p.id));
        (colasGuardadas || []).forEach((colaGuardada) => {
          colas.push({ nombre: (colaGuardada && colaGuardada.nombre) || "Cola" });
          const porInstante = new Array(duracionActual).fill(null).map(() => []);
          ((colaGuardada && colaGuardada.porInstante) || []).forEach((lista, t) => {
            if (t < duracionActual) porInstante[t] = (lista || []).filter((id) => idsValidos.has(id));
          });
          datosColas.push(porInstante);
        });
        if (colas.length === 0) agregarCola();
        else reconstruirFilasColas();
      },
      /** Cantidad de filas (carriles) que tiene la grilla — la usa `renderizarGrillaSolucion`
       * para saber en qué fila arrancar las filas extra de cola de listos. */
      cantidadCarriles: carriles.length,
    };
  }

  /** Grilla en blanco para que la complete el alumno (con botón para agregar instantes). */
  function crearGrillaInteractiva(contenedor, procesos, duracionInicial, coloresProcesos) {
    return crearGrillaSwimlane(contenedor, {
      procesos,
      duracionInicial,
      editable: true,
      datosPorProceso: null,
      coloresProcesos,
    });
  }

  function crearCeldaEtiquetaFilaExtra(texto, fila) {
    const celda = document.createElement("div");
    celda.className = "etiqueta-cola-listos";
    celda.textContent = texto;
    celda.style.gridRow = String(fila);
    celda.style.gridColumn = "1 / span 2";
    return celda;
  }

  /**
   * Le agrega a `elemento` un tooltip con Tippy.js
   * (https://atomiks.github.io/tippyjs/) mostrando `contenidoHTML` (puede
   * traer varias líneas). Si Tippy no llegó a cargar por algún motivo, cae
   * de vuelta al `title` nativo del navegador para no perder la
   * información. La usan tanto las celdas de la cola de listos como las de
   * ejecución (hoy solo SRTF, para el restante estimado).
   */
  function aplicarTooltip(elemento, contenidoHTML) {
    elemento.classList.add("item-con-tooltip");
    if (typeof tippy === "function") {
      tippy(elemento, {
        content: contenidoHTML,
        allowHTML: true,
        theme: "simulador",
        placement: "top",
      });
    } else {
      elemento.title = contenidoHTML.replace(/<[^>]+>/g, "");
    }
  }

  /**
   * Cada item puede ser un string simple, o { texto, tooltip } cuando el
   * algoritmo expone la cuenta detrás del orden (SJF/SRTF/HRRN con
   * estimaciones activadas) — ver `aplicarTooltip`.
   */
  function crearCeldaColaListos(items, fila, columna) {
    const celda = document.createElement("div");
    celda.className = "celda-cola-listos";
    celda.style.gridRow = String(fila);
    celda.style.gridColumn = String(columna);
    items.forEach((item) => {
      const linea = document.createElement("div");
      if (typeof item === "string") {
        linea.textContent = item;
      } else {
        linea.textContent = item.texto;
        if (item.tooltip) aplicarTooltip(linea, item.tooltip);
      }
      celda.appendChild(linea);
    });
    return celda;
  }

  function agregarFilaColaListos(grilla, fila, etiqueta, itemsPorInstante, duracionTotal, columnaInicioInstantes) {
    grilla.appendChild(crearCeldaEtiquetaFilaExtra(etiqueta, fila));
    for (let t = 0; t < duracionTotal; t++) {
      grilla.appendChild(crearCeldaColaListos(itemsPorInstante[t] || [], fila, columnaInicioInstantes + t));
    }
  }

  /**
   * Grilla de solo lectura con la solución de un algoritmo.
   *
   * @param {Object} [opciones]
   * @param {"simple"|"rrv"} [opciones.modo] - controla si (y cómo) se
   *        agrega, debajo del eje de instantes, la fila con quién espera
   *        en la cola de listos en cada instante (el que ejecuta o está en
   *        IO nunca aparece ahí). "simple"
   *        agrega una única fila desde `resultado.colaListosPorInstante`;
   *        "rrv" agrega dos filas (cola de reingreso con el quantum
   *        restante entre paréntesis, y cola normal) desde
   *        `resultado.colasPorInstante`.
   * @param {Object} [opciones.columnaExtra] - agrega una columna editable
   *        más entre la etiqueta del proceso y sus celdas de instantes (la
   *        usan SJF/SRTF/HRRN para la estimación inicial de ráfaga, cuando
   *        el toggle de estimaciones está activado). Forma:
   *        `{ encabezado, obtenerValor(procesoId), onCambio(procesoId, valor) }`.
   * @param {?Function} [opciones.formatearTooltipListos] - (info) => string
   *        (puede traer HTML). Solo tiene efecto con modo "simple". Si se
   *        pasa, cada proceso de la fila "Listos" muestra ese contenido en
   *        un tooltip (Tippy.js) al pasar el mouse, usando
   *        `resultado.infoListosPorInstante[t][procesoId]` (lo que haya
   *        capturado `capturarInfoListos` en el algoritmo — hoy lo proveen
   *        SJF/SRTF/HRRN con estimaciones activadas).
   * @param {?Function} [opciones.formatearTooltipEjecucion] - (info) => string
   *        (puede traer HTML). Igual que `formatearTooltipListos`, pero para
   *        las celdas de CPU: usa `resultado.infoEjecucionPorInstante[t][procesoId]`
   *        (lo que haya capturado `capturarInfoEjecucion` — hoy solo SRTF,
   *        para mostrar el restante estimado en ESE instante puntual, que es
   *        justo lo que el motor compara contra la cola en cada tick).
   */
  function renderizarGrillaSolucion(contenedor, procesos, resultado, coloresProcesos, opciones) {
    const { datos, duracionTotal } = construirDatosPorProceso(procesos, resultado);
    const columnaExtra = opciones && opciones.columnaExtra;

    const formatearTooltipEjecucion = opciones && opciones.formatearTooltipEjecucion;
    let tooltipsPorProceso = null;
    if (formatearTooltipEjecucion && resultado.infoEjecucionPorInstante) {
      tooltipsPorProceso = {};
      // Ojo: se indexa por CARRIL (no por proceso.id) porque, con hilos, la
      // celda que efectivamente ejecuta puede ser la de un hilo puntual
      // (ver simulador-core.js/idEjecutable) — si solo se pre-inicializara
      // para `procesos`, asignarle un tooltip a la fila de un hilo tiraría
      // error (no existiría ese array todavía).
      construirCarriles(procesos).forEach((c) => (tooltipsPorProceso[c.id] = new Array(duracionTotal).fill(null)));
      for (let t = 0; t < duracionTotal; t++) {
        const infoDelInstante = resultado.infoEjecucionPorInstante[t];
        if (!infoDelInstante) continue;
        Object.keys(infoDelInstante).forEach((procesoId) => {
          tooltipsPorProceso[procesoId][t] = formatearTooltipEjecucion(infoDelInstante[procesoId]);
        });
      }
    }

    // A diferencia de las tooltips/columnaExtra (que dependen de si el
    // algoritmo usa estimaciones), los marcadores de transición aplican
    // siempre en toda solución: no hay motivo para ocultarlos.
    const marcadoresPorProceso = construirMarcadoresTransicion(procesos, resultado);

    const controlador = crearGrillaSwimlane(contenedor, {
      procesos,
      duracionInicial: duracionTotal,
      editable: false,
      datosPorProceso: datos,
      coloresProcesos,
      columnaExtra,
      tooltipsPorProceso,
      marcadoresPorProceso,
    });

    const modo = opciones && opciones.modo;
    if (!controlador || !modo || modo === "ninguno") return;

    const grilla = controlador.elemento;
    const filaBase = controlador.cantidadCarriles + 2; // fila 1..N = carriles (procesos + hilos), N+1 = eje de instantes
    const columnaInicioInstantes = columnaExtra ? 4 : 3;

    if (modo === "simple") {
      const formatearTooltip = opciones && opciones.formatearTooltipListos;
      const items = [];
      for (let t = 0; t < duracionTotal; t++) {
        const idsListos = resultado.colaListosPorInstante[t] || [];
        if (formatearTooltip) {
          items.push(
            idsListos.map((id) => {
              const info = resultado.infoListosPorInstante && resultado.infoListosPorInstante[t] && resultado.infoListosPorInstante[t][id];
              return info ? { texto: id, tooltip: formatearTooltip(info) } : id;
            })
          );
        } else {
          items.push(idsListos);
        }
      }
      agregarFilaColaListos(grilla, filaBase, "Listos", items, duracionTotal, columnaInicioInstantes);
    } else if (modo === "rrv") {
      const itemsReingreso = [];
      const itemsNormal = [];
      for (let t = 0; t < duracionTotal; t++) {
        const colas = (resultado.colasPorInstante && resultado.colasPorInstante[t]) || { reingreso: [], normal: [] };
        itemsReingreso.push(colas.reingreso.map((p) => `${p.id} (${p.restante})`));
        itemsNormal.push(colas.normal);
      }
      agregarFilaColaListos(grilla, filaBase, "Prioritaria", itemsReingreso, duracionTotal, columnaInicioInstantes);
      agregarFilaColaListos(grilla, filaBase + 1, "Normal", itemsNormal, duracionTotal, columnaInicioInstantes);
    }
  }

  return {
    asignarColoresProcesos,
    construirCarriles,
    construirDatosPorProceso,
    crearGrillaInteractiva,
    renderizarGrillaSolucion,
  };
})();
