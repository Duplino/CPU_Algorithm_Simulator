/**
 * multinivel.js — Colas multinivel, modo 100% manual.
 *
 * A diferencia de todos los demás algoritmos, Multinivel no tiene una única
 * política de planificación fija: el comportamiento depende de cómo el
 * alumno arme las colas (cuántas, con qué procesos, con qué prioridad entre
 * ellas), así que no existe una "solución correcta" única para simular ni
 * corregir automáticamente.
 *
 * Por eso este archivo NO expone una función de simulación: solo deja
 * documentado el modelo de datos que arma el alumno a mano en
 * ui/editor-colas.js (el mismo editor de colas que usan todos los bloques),
 * y que main.js usa para saber que este algoritmo
 * no tiene botón de "Corregir" ni solución de referencia.
 *
 * Modelo de datos de una configuración multinivel (armada por el alumno):
 *   {
 *     colas: [
 *       { nombre: "Cola alta", procesos: ["P1", "P3"] },
 *       { nombre: "Cola baja", procesos: ["P2"] },
 *     ]
 *   }
 */
const MULTINIVEL_SIN_SIMULACION_AUTOMATICA = true;
