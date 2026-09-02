/**
 * editor-procesos.js — Alta/baja/edición de procesos y sus hilos: id,
 * arribo, ráfagas (alternadas CPU/IO, una columna de tabla por ráfaga).
 * También expone `renderizarDispositivosIO`, el editor (aparte, del
 * ejercicio entero — no por proceso) de los dispositivos de E/S que se
 * pueden marcar celda por celda en "Tu Solución" (ver ui/grilla-gantt.js).
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
 * B.1). Si el proceso tiene algún hilo ULT, debajo del ID del proceso (en la
 * MISMA celda, no en una fila nueva — así agregar/sacar hilos ULT no hace
 * crecer la tabla y correr de lugar a los demás procesos) aparece un
 * selector para elegir cómo se manejan sus llamadas bloqueantes de E/S
 * (manejada por el SO, por la biblioteca, o con Jacketing) — es una
 * propiedad del PROCESO (de su biblioteca ULT), no de cada hilo individual.
 */
const EditorProcesos = (function () {
  "use strict";

  // Las tres formas de manejar una E/S bloqueante de un hilo ULT:
  //   - "so": sin ningún manejo especial, la llamada va directo al SO, que
  //     no distingue hilos — bloquea a TODO el proceso (y por lo tanto a
  //     todos sus hilos ULT hermanos) hasta que esa E/S puntual termina.
  //   - "biblioteca": la biblioteca ULT usa llamadas no bloqueantes y
  //     administra ella misma la espera, así que un hilo en E/S no bloquea
  //     a sus hermanos.
  //   - "jacketing": una capa que intercepta las llamadas bloqueantes y las
  //     traduce a no bloqueantes — mismo resultado que "biblioteca" (los
  //     hermanos no quedan bloqueados), pero por un mecanismo distinto.
  const OPCIONES_ALGORITMO_BIBLIOTECA = [
    { valor: "so", etiqueta: "Manejada por el SO" },
    { valor: "biblioteca", etiqueta: "Manejada por la biblioteca" },
    { valor: "jacketing", etiqueta: "Jacketing" },
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

  /**
   * Dropdown de "con qué dispositivo de E/S se hace esta ráfaga" — solo se
   * muestra (ver `crearCeldaRafaga`) cuando el ejercicio tiene 2 o más
   * dispositivos configurados; con uno solo no hay nada que elegir, la
   * ráfaga usa ESE por default (ver SimuladorCore.nombreDispositivoDe).
   * Autocorrige la ráfaga si su dispositivo ya no existe (fue renombrado o
   * eliminado desde que se guardó) reasignándola al primero disponible, en
   * vez de dejarla apuntando a un nombre fantasma.
   */
  function crearSelectorDispositivoRafaga(rafaga, dispositivosIO, alCambiar) {
    if (!dispositivosIO.some((d) => d.nombre === rafaga.dispositivoIO)) {
      rafaga.dispositivoIO = dispositivosIO[0].nombre;
    }

    const select = document.createElement("select");
    select.className = "selector-dispositivo-rafaga";
    select.title = "Dispositivo de E/S que usa esta ráfaga";
    dispositivosIO.forEach((dispositivo) => {
      const option = document.createElement("option");
      option.value = dispositivo.nombre;
      option.textContent = dispositivo.nombre;
      if (dispositivo.nombre === rafaga.dispositivoIO) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      rafaga.dispositivoIO = select.value;
      alCambiar();
    });
    return select;
  }

  /**
   * Celda de la columna de ráfaga `indice` para un hilo.
   * @param {Array} dispositivosIO - dispositivos de E/S del ejercicio (ver
   *        EditorProcesos.renderizarDispositivosIO) — con 2 o más, las
   *        ráfagas de E/S muestran además el dropdown de a cuál pertenecen.
   */
  function crearCeldaRafaga(hilo, indice, alCambiar, dispositivosIO) {
    const celda = document.createElement("td");
    celda.className = `celda-rafaga celda-${tipoRafagaEnIndice(indice).toLowerCase()}`;

    if (indice < hilo.rafagas.length) {
      const rafaga = hilo.rafagas[indice];
      const mostrarSelectorDispositivo = tipoRafagaEnIndice(indice) === "IO" && dispositivosIO.length > 1;

      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.className = "input-duracion-rafaga";
      input.value = rafaga.duracion;
      input.addEventListener("change", () => {
        rafaga.duracion = Math.max(1, Number(input.value) || 1);
        alCambiar();
      });

      if (mostrarSelectorDispositivo) {
        // "Input group": el dropdown de dispositivo pegado a la izquierda
        // del número de duración, como un único campo compuesto.
        const grupo = document.createElement("div");
        grupo.className = "grupo-rafaga-io";
        grupo.appendChild(crearSelectorDispositivoRafaga(rafaga, dispositivosIO, alCambiar));
        input.classList.add("input-duracion-rafaga-agrupada");
        grupo.appendChild(input);
        celda.appendChild(grupo);
      } else {
        celda.appendChild(input);
      }

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
        const nuevaRafaga = { tipo: tipoRafagaEnIndice(indice), duracion: 1 };
        if (nuevaRafaga.tipo === "IO") nuevaRafaga.dispositivoIO = dispositivosIO[0].nombre;
        hilo.rafagas.push(nuevaRafaga);
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
   * Selector de "Biblioteca ULT" (cómo se manejan las E/S bloqueantes de los
   * hilos ULT del proceso) — vive DENTRO de la celda del ID del proceso, no
   * en una fila propia: es compacto a propósito para no ensanchar de más esa
   * columna, ya que aparece/desaparece al alternar el tipo de un hilo entre
   * KLT y ULT (ver crearBotonTipoHilo) y no debería notarse como un cambio
   * brusco de layout.
   */
  function crearSelectorBibliotecaUlt(proceso, alCambiar) {
    const contenedor = document.createElement("div");
    contenedor.className = "selector-biblioteca-ult";

    const etiqueta = document.createElement("span");
    etiqueta.className = "etiqueta-biblioteca-ult";
    etiqueta.textContent = "Biblioteca ULT";
    contenedor.appendChild(etiqueta);

    const select = document.createElement("select");
    select.title = "Cómo se manejan las E/S bloqueantes de los hilos ULT de este proceso";
    OPCIONES_ALGORITMO_BIBLIOTECA.forEach((opcion) => {
      const option = document.createElement("option");
      option.value = opcion.valor;
      option.textContent = opcion.etiqueta;
      if (opcion.valor === proceso.algoritmoBiblioteca) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      proceso.algoritmoBiblioteca = select.value;
      alCambiar();
    });
    contenedor.appendChild(select);

    return contenedor;
  }

  /**
   * @param {HTMLElement} contenedor
   * @param {Array} procesos - estado mutable de procesos (se edita in-place)
   * @param {Object} opciones
   * @param {Function} opciones.onCambio - se llama con `procesos` cada vez que algo cambia
   * @param {Array} [opciones.dispositivosIO] - dispositivos de E/S del
   *        ejercicio (ver `renderizarDispositivosIO`); con 2 o más, las
   *        ráfagas de E/S muestran el dropdown de a cuál pertenecen.
   */
  function renderizarTablaProcesos(contenedor, procesos, opciones) {
    const { onCambio } = opciones;
    const dispositivosIO = opciones.dispositivosIO && opciones.dispositivosIO.length > 0 ? opciones.dispositivosIO : [{ nombre: "IO" }];
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
      if (tieneULT && !proceso.algoritmoBiblioteca) proceso.algoritmoBiblioteca = OPCIONES_ALGORITMO_BIBLIOTECA[0].valor;
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
          tdId.className = "celda-id-proceso";

          const inputId = document.createElement("input");
          inputId.type = "text";
          inputId.className = "input-id-proceso";
          inputId.value = proceso.id;
          inputId.addEventListener("change", () => {
            proceso.id = inputId.value.trim() || proceso.id;
            marcarCambio();
          });
          tdId.appendChild(inputId);

          // Debajo del ID, EN LA MISMA celda (no una fila nueva): así
          // aparecer/desaparecer al alternar un hilo entre KLT y ULT no
          // hace crecer la tabla entera ni corre de lugar a los procesos
          // de abajo — ver crearSelectorBibliotecaUlt.
          if (tieneULT) {
            tdId.appendChild(crearSelectorBibliotecaUlt(proceso, () => onCambio(procesos)));
          }

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
          fila.appendChild(crearCeldaRafaga(hilo, i, marcarCambio, dispositivosIO));
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

  const CANTIDAD_MAXIMA_DISPOSITIVOS_IO = 4;

  /**
   * Editor de los dispositivos de E/S del ejercicio — a diferencia de los
   * hilos, NO son por proceso: los comparten todos los procesos por igual
   * (los usa la fila de la grilla en "Tu Solución" — ver
   * ui/grilla-gantt.js). Por defecto hay uno solo, sin nombre editable (se
   * etiqueta simplemente "IO", como toda la vida); recién al agregar un
   * segundo aparecen los nombres editables (de hasta 3 letras, ej. "IO1",
   * "DSK") para poder distinguirlos: en "Tu Solución", un click en una
   * celda alterna entre CPU, cada dispositivo (por su nombre) y vacío.
   *
   * @param {HTMLElement} contenedor
   * @param {Array} dispositivosIO - estado mutable [{ nombre }], se edita in-place
   * @param {Object} opciones
   * @param {Function} opciones.onCambio - se llama con `dispositivosIO` cada vez que algo cambia
   */
  function renderizarDispositivosIO(contenedor, dispositivosIO, opciones) {
    const { onCambio } = opciones;
    const notificarCambio = () => renderizarDispositivosIO(contenedor, dispositivosIO, opciones);
    const marcarCambio = () => {
      onCambio(dispositivosIO);
      notificarCambio();
    };

    contenedor.innerHTML = "";

    // Con un único dispositivo no hace falta nombrarlo (es el "IO" genérico
    // de siempre) — el editor de nombres solo aparece a partir del segundo,
    // que es cuando realmente hace falta distinguirlos.
    if (dispositivosIO.length > 1) {
      dispositivosIO.forEach((dispositivo, indice) => {
        const chip = document.createElement("div");
        chip.className = "chip-dispositivo-io";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "input-nombre-dispositivo-io";
        input.maxLength = 3;
        input.value = dispositivo.nombre;
        input.title = "Nombre de este dispositivo de E/S (hasta 3 letras)";
        input.addEventListener("change", () => {
          dispositivo.nombre = input.value.trim().toUpperCase().slice(0, 3) || `IO${indice + 1}`;
          marcarCambio();
        });
        chip.appendChild(input);

        const botonQuitar = document.createElement("button");
        botonQuitar.type = "button";
        botonQuitar.className = "boton-quitar-dispositivo-io";
        botonQuitar.textContent = "×";
        botonQuitar.title = "Quitar este dispositivo de E/S";
        botonQuitar.addEventListener("click", () => {
          dispositivosIO.splice(indice, 1);
          // Si vuelve a quedar uno solo, recupera el nombre genérico — ya
          // no hay nada que distinguir, y el editor de nombres desaparece.
          if (dispositivosIO.length === 1) dispositivosIO[0].nombre = "IO";
          marcarCambio();
        });
        chip.appendChild(botonQuitar);

        contenedor.appendChild(chip);
      });
    }

    if (dispositivosIO.length < CANTIDAD_MAXIMA_DISPOSITIVOS_IO) {
      const botonAgregar = document.createElement("button");
      botonAgregar.type = "button";
      botonAgregar.className = "boton-agregar-dispositivo-io";
      botonAgregar.textContent = "+ Agregar dispositivo de E/S";
      botonAgregar.addEventListener("click", () => {
        // Al pasar de 1 a 2, el primero deja de ser el "IO" genérico y pasa
        // a llamarse "IO1" — recién ahí sus nombres importan.
        if (dispositivosIO.length === 1) dispositivosIO[0].nombre = "IO1";
        dispositivosIO.push({ nombre: `IO${dispositivosIO.length + 1}` });
        marcarCambio();
      });
      contenedor.appendChild(botonAgregar);
    }
  }

  return {
    crearProcesoVacio,
    crearHiloVacio,
    siguienteIdProceso,
    letraDesdeIndice,
    estimacionEfectiva,
    renderizarTablaProcesos,
    renderizarDispositivosIO,
  };
})();
