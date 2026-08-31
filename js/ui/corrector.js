/**
 * corrector.js — Comparación de la respuesta del alumno contra la solución.
 *
 * La corrección es todo-o-nada: o la grilla completa (todos los procesos,
 * todos los instantes) coincide con la solución, o se considera incorrecta
 * (no hay puntaje parcial). Esto NO impide resaltar visualmente qué celdas
 * puntuales están mal — eso es solo una ayuda para que el alumno vea dónde
 * se equivocó, no una nota parcial.
 *
 * Multinivel no usa este módulo: no tiene solución de referencia.
 */
const Corrector = (function () {
  "use strict";

  /**
   * @param {Object} respuestaAlumno - { [carrilId]: Array<'CPU'|'IO'|null> },
   *        tal como devuelve GrillaGantt.crearGrillaInteractiva().obtenerRespuesta()
   *        (una entrada por CARRIL: el proceso y cada uno de sus hilos, si tiene)
   * @param {Array} procesos - procesos del ejercicio
   * @param {Object} resultado - resultado del algoritmo (con `gantt` y `franjasIO`)
   * @returns {{correcto: boolean, celdasIncorrectas: Array<{procesoId: string, instante: number}>}}
   */
  function corregir(respuestaAlumno, procesos, resultado) {
    const { datos, duracionTotal: duracionSolucion } = GrillaGantt.construirDatosPorProceso(procesos, resultado);
    const carriles = GrillaGantt.construirCarriles(procesos);

    // El alumno puede haber agregado instantes de más con "+ Agregar
    // instante" (ver ui/grilla-gantt.js). Esos instantes extra no existen
    // en la solución (el proceso ya terminó antes), así que se comparan
    // igual: cualquier marca ahí es tan incorrecta como una celda mal
    // puesta dentro del rango de la solución.
    const duracionAlumno = Math.max(0, ...carriles.map((c) => (respuestaAlumno[c.id] || []).length));
    const duracionTotal = Math.max(duracionSolucion, duracionAlumno);

    const celdasIncorrectas = [];
    carriles.forEach((carril) => {
      const respuestaCarril = respuestaAlumno[carril.id] || [];
      for (let t = 0; t < duracionTotal; t++) {
        const valorAlumno = respuestaCarril[t] || null;
        const valorSolucion = t < duracionSolucion ? datos[carril.id][t] : null;
        if (valorAlumno !== valorSolucion) celdasIncorrectas.push({ procesoId: carril.id, instante: t });
      }
    });

    return { correcto: celdasIncorrectas.length === 0, celdasIncorrectas };
  }

  return { corregir };
})();
