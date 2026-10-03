const s = require("./solver.js");

function approx(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(label + ": " + actual + " != " + expected);
  }
}

function check(result, node, env, expected, label) {
  if (!result.ok) throw new Error(label + " failed: " + result.error);
  const rat = result.ratios && result.ratios[node] ? result.ratios[node].rat : result.voltages[node].rat;
  const value = s.evalRat(rat, env);
  approx(value, expected, label + " (" + (result.ratios[node] ? result.ratios[node].text : result.voltages[node].text) + ")");
  console.log(label + ": " + (result.ratios[node] ? result.ratios[node].text : result.voltages[node].text));
}

const divider = s.solveNetlist([
  { type: "V", name: "Vin", value: "vin", pins: { p: "in", n: "0" } },
  { type: "R", name: "R1", value: "R1", pins: { a: "in", b: "out" } },
  { type: "R", name: "R2", value: "R2", pins: { a: "out", b: "0" } },
]);
check(divider, "out", { vin: 1, R1: 3, R2: 2 }, 2 / 5, "Teiler");
if (divider.ratios.in.text !== "1") throw new Error("Eingang sollte 1 sein: " + divider.ratios.in.text);

const lowpass = s.solveNetlist([
  { type: "V", name: "Vin", value: "vin", pins: { p: "in", n: "0" } },
  { type: "R", name: "R1", value: "R", pins: { a: "in", b: "out" } },
  { type: "C", name: "C1", value: "C", pins: { a: "out", b: "0" } },
]);
check(lowpass, "out", { vin: 1, R: 2, C: 4, s: 5 }, 1 / (1 + 5 * 2 * 4), "Tiefpass");

const highpass = s.solveNetlist([
  { type: "V", name: "Vin", value: "vin", pins: { p: "in", n: "0" } },
  { type: "C", name: "C1", value: "C", pins: { a: "in", b: "out" } },
  { type: "R", name: "R1", value: "R", pins: { a: "out", b: "0" } },
]);
check(highpass, "out", { vin: 1, R: 2, C: 4, s: 5 }, (5 * 4 * 2) / (1 + 5 * 4 * 2), "Hochpass");

const rl = s.solveNetlist([
  { type: "V", name: "Vin", value: "vin", pins: { p: "in", n: "0" } },
  { type: "L", name: "L1", value: "L", pins: { a: "in", b: "out" } },
  { type: "R", name: "R1", value: "R", pins: { a: "out", b: "0" } },
]);
check(rl, "out", { vin: 1, R: 3, L: 4, s: 2 }, 3 / (3 + 2 * 4), "RL");

const gm = s.solveNetlist([
  { type: "V", name: "Vin", value: "vin", pins: { p: "in", n: "0" } },
  { type: "G", name: "Gm", value: "gm", pins: { p: "out", n: "0", cp: "in", cn: "0" } },
  { type: "R", name: "RL", value: "RL", pins: { a: "out", b: "0" } },
]);
check(gm, "out", { vin: 1, gm: 2, RL: 5 }, -10, "gm");

const inverter = s.solveNetlist([
  { type: "V", name: "Vin", value: "vin", pins: { p: "in", n: "0" } },
  { type: "R", name: "Rin", value: "Rin", pins: { a: "in", b: "inv" } },
  { type: "R", name: "Rf", value: "Rf", pins: { a: "inv", b: "out" } },
  { type: "O", name: "Op", value: "1", pins: { inp: "0", inn: "inv", out: "out" } },
]);
check(inverter, "out", { vin: 1, Rin: 2, Rf: 6 }, -3, "Inverter");

const current = s.solveNetlist([
  { type: "I", name: "I1", value: "iin", pins: { p: "0", n: "out" } },
  { type: "R", name: "R1", value: "R", pins: { a: "out", b: "0" } },
]);
if (!current.ok) throw new Error(current.error);
approx(s.evalRat(current.voltages.out.rat, { iin: 4, R: 3 }), 12, "Stromquelle");
console.log("Stromquelle: " + current.voltages.out.text);

const open = s.solveNetlist([{ type: "R", name: "R1", value: "R", pins: { a: "a", b: "b" } }]);
if (open.ok) throw new Error("offene Schaltung hätte scheitern müssen");
console.log("ohne Masse: " + open.error);

const parallel = s.solveNetlist([
  { type: "V", name: "Vin", value: "vin", pins: { p: "in", n: "0" } },
  { type: "R", name: "R1", value: "R1", pins: { a: "in", b: "out" } },
  { type: "C", name: "C1", value: "C", pins: { a: "in", b: "out" } },
  { type: "R", name: "R2", value: "R2", pins: { a: "out", b: "0" } },
]);
check(
  parallel,
  "out",
  { vin: 1, R1: 2, R2: 4, C: 3, s: 5 },
  (4 * (1 + 5 * 3 * 2)) / (2 + 4 * (1 + 5 * 3 * 2)),
  "Parallel"
);

const drawn = s.solveSchematic({
  components: [
    { id: "v", type: "V", name: "Vin", value: "vin", x: 2, y: 4, rot: 0 },
    { id: "r1", type: "R", name: "R1", value: "R1", x: 6, y: 2, rot: 0 },
    { id: "r2", type: "R", name: "R2", value: "R2", x: 8, y: 4, rot: 90 },
    { id: "g1", type: "GND", name: "GND1", value: "", x: 2, y: 6, rot: 0 },
    { id: "g2", type: "GND", name: "GND2", value: "", x: 8, y: 6, rot: 0 },
  ],
  wires: [
    { points: [{ x: 2, y: 2 }, { x: 4, y: 2 }] },
    { points: [{ x: 2, y: 6 }, { x: 2, y: 6 }] },
  ],
  labels: [{ x: 8, y: 2, text: "out" }],
});
check(drawn, "out", { vin: 1, R1: 3, R2: 2 }, 2 / 5, "Gezeichneter Teiler");

const examples = s.examples();
check(s.solveSchematic(examples.teiler), "out", { vin: 1, R1: 3, R2: 2 }, 2 / 5, "Beispiel Teiler");
check(s.solveSchematic(examples.tiefpass), "out", { vin: 1, R: 2, C: 4, s: 5 }, 1 / (1 + 40), "Beispiel Tiefpass");
check(s.solveSchematic(examples.inverter), "out", { vin: 1, Rin: 2, Rf: 6 }, -3, "Beispiel Inverter");

const joined = s.solveSchematic({
  components: [
    { id: "v", type: "V", name: "Vin", value: "vin", x: 2, y: 4, rot: 0 },
    { id: "r1", type: "R", name: "R1", value: "R1", x: 8, y: 2, rot: 0 },
    { id: "r2", type: "R", name: "R2", value: "R2", x: 10, y: 4, rot: 90 },
    { id: "g1", type: "GND", name: "GND1", value: "", x: 2, y: 6, rot: 0 },
    { id: "g2", type: "GND", name: "GND2", value: "", x: 10, y: 6, rot: 0 },
  ],
  wires: [
    { points: [{ x: 2, y: 2 }, { x: 4, y: 2 }] },
    { points: [{ x: 4, y: 2 }, { x: 4, y: 4 }, { x: 6, y: 4 }] },
    { points: [{ x: 6, y: 4 }, { x: 6, y: 2 }] },
  ],
  labels: [{ x: 10, y: 2, text: "out" }],
});
check(joined, "out", { vin: 1, R1: 3, R2: 2 }, 2 / 5, "Drähte an der Ecke");

console.log("alle Prüfungen grün");
