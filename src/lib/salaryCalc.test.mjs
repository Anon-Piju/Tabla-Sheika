// Pruebas de salaryCalc.js. Se ejecutan con:  node src/lib/salaryCalc.test.mjs
// (no necesitan ninguna librería de tests).
import assert from 'node:assert/strict'
import {
  DEFAULT_SALARY_SETTINGS as D,
  parseTime, formatTime, parseDuration,
  normalizeSettings, rateCents, netFromGross, hourlyRates,
  shiftTimes, buildLines, calcShift, summarizeShifts, groupByMonth,
} from './salaryCalc.js'

let passed = 0
let failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`) }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`) }
}
const h = (hours, mins = 0) => hours * 60 + mins
const mins = (r) => [r.minutes.ordinary, r.minutes.night1, r.minutes.night2, r.minutes.total]

console.log('Utilidades de tiempo')
test('parseTime acepta HH:MM y HH:MM:SS', () => {
  assert.equal(parseTime('20:00'), 1200)
  assert.equal(parseTime('00:30'), 30)
  assert.equal(parseTime('06:00:00'), 360)
})
test('parseTime rechaza valores inválidos', () => {
  for (const bad of ['', '24:00', '12:60', 'abc', null, undefined, 5]) assert.equal(parseTime(bad), null)
})
test('formatTime da la vuelta a las 24 h', () => {
  assert.equal(formatTime(1590), '02:30')
  assert.equal(formatTime(0), '00:00')
  assert.equal(formatTime(1440), '00:00')
})
test('parseDuration: vacío = 0, inválido = null', () => {
  assert.equal(parseDuration(''), 0)
  assert.equal(parseDuration('02:00'), 120)
  assert.equal(parseDuration('xx'), null)
})

console.log('Precios por hora (tabla de la especificación)')
test('precios brutos por hora', () => {
  assert.deepEqual(rateCents(D), { ordinary: 1024, night1: 1126, night2: 1229 })
})
test('precios netos por hora (6,5 % SS, 0 % IRPF)', () => {
  const r = hourlyRates(D)
  assert.deepEqual(r.map((x) => x.netCents), [957, 1053, 1149])
})

console.log('Ejemplo de la especificación: 20:00–00:30 + 02:00 complementarias')
const example = calcShift({ start: '20:00', end: '00:30', extraMinutes: h(2) }, D)
test('hora real de salida 02:30 (día siguiente)', () => {
  assert.equal(example.ok, true)
  assert.equal(example.realEndTime, '02:30')
  assert.equal(example.endsNextDay, true)
})
test('desglose 2 h ordinarias + 2,5 h nocturnas 10 % + 2 h nocturnas 20 % = 6,5 h', () => {
  assert.deepEqual(mins(example), [h(2), h(2, 30), h(2), h(6, 30)])
})
test('importes: 20,48 + 28,15 + 24,58 = 73,21 € bruto', () => {
  assert.deepEqual(example.lines.map((l) => l.totalCents), [2048, 2815, 2458])
  assert.equal(example.grossCents, 7321)
})
test('neto estimado = bruto × 93,5 %', () => {
  assert.equal(example.netCents, 6845)
})
test('las complementarias se contabilizan en el resumen', () => {
  assert.equal(example.minutes.extra, 120)
})

console.log('Introducir la hora real de salida directamente da el mismo resultado')
test('20:00–02:30 sin complementarias == 20:00–00:30 + 02:00', () => {
  const direct = calcShift({ start: '20:00', end: '02:30', extraMinutes: 0 }, D)
  assert.deepEqual(mins(direct), mins(example))
  assert.equal(direct.grossCents, example.grossCents)
  assert.equal(direct.netCents, example.netCents)
  assert.equal(direct.realEndTime, example.realEndTime)
})
test('18:00–23:00 + 03:00 == 18:00–02:00 (complementarias que cruzan medianoche)', () => {
  const a = calcShift({ start: '18:00', end: '23:00', extraMinutes: h(3) }, D)
  const b = calcShift({ start: '18:00', end: '02:00', extraMinutes: 0 }, D)
  assert.deepEqual(mins(a), mins(b))
  assert.deepEqual(mins(a), [h(4), h(2, 30), h(1, 30), h(8)])
})

console.log('Casos de franjas horarias')
test('turno diurno sin nocturnidad (08:00–16:00)', () => {
  const r = calcShift({ start: '08:00', end: '16:00' }, D)
  assert.deepEqual(mins(r), [h(8), 0, 0, h(8)])
  assert.equal(r.grossCents, 8192)
  assert.equal(r.endsNextDay, false)
})
test('termina justo a las 22:00: todo ordinario', () => {
  assert.deepEqual(mins(calcShift({ start: '14:00', end: '22:00' }, D)), [h(8), 0, 0, h(8)])
})
test('empieza a las 22:00 y termina a las 00:30: solo nocturna 1', () => {
  assert.deepEqual(mins(calcShift({ start: '22:00', end: '00:30' }, D)), [0, h(2, 30), 0, h(2, 30)])
})
test('turno 23:00–07:00 atraviesa ambas franjas y vuelve a ordinario tras las 06:00', () => {
  assert.deepEqual(mins(calcShift({ start: '23:00', end: '07:00' }, D)), [h(1), h(1, 30), h(5, 30), h(8)])
})
test('turno 20:00–08:00: 4 h ordinarias, 2,5 nocturnas 1, 5,5 nocturnas 2', () => {
  assert.deepEqual(mins(calcShift({ start: '20:00', end: '08:00' }, D)), [h(4), h(2, 30), h(5, 30), h(12)])
})
test('empieza pasada la medianoche: 01:00–05:00 todo nocturna 2', () => {
  assert.deepEqual(mins(calcShift({ start: '01:00', end: '05:00' }, D)), [0, 0, h(4), h(4)])
})
test('empieza antes de las 00:30: 00:10–00:40 = 20 min tramo 1 + 10 min tramo 2', () => {
  assert.deepEqual(mins(calcShift({ start: '00:10', end: '00:40' }, D)), [0, 20, 10, 30])
})
test('turno que acaba justo a las 06:00 no cuenta nada de ordinario después', () => {
  assert.deepEqual(mins(calcShift({ start: '00:30', end: '06:00' }, D)), [0, 0, h(5, 30), h(5, 30)])
})
test('las complementarias después de las 06:00 se pagan como ordinarias', () => {
  const r = calcShift({ start: '22:00', end: '06:00', extraMinutes: h(2) }, D)
  assert.deepEqual(mins(r), [h(2), h(2, 30), h(5, 30), h(10)])
})

console.log('Datos incorrectos o incompletos')
test('faltan datos → incompleto, sin mensaje de error', () => {
  const r = calcShift({ start: '', end: '10:00' }, D)
  assert.equal(r.ok, false)
  assert.equal(r.incomplete, true)
  assert.equal(calcShift({}, D).incomplete, true)
})
test('inicio igual a fin → error', () => {
  const r = calcShift({ start: '10:00', end: '10:00' }, D)
  assert.equal(r.ok, false)
  assert.ok(r.error.length > 0)
})
test('más de 24 horas → error', () => {
  const r = calcShift({ start: '10:00', end: '09:00', extraMinutes: h(3) }, D)
  assert.equal(r.ok, false)
})
test('complementarias negativas o inválidas → error', () => {
  assert.equal(calcShift({ start: '10:00', end: '12:00', extraMinutes: -5 }, D).ok, false)
  assert.equal(calcShift({ start: '10:00', end: '12:00', extraMinutes: NaN }, D).ok, false)
})

console.log('Parámetros editables y copia por registro')
test('cambiar la tarifa cambia el cálculo', () => {
  const r = calcShift({ start: '08:00', end: '16:00' }, { ...D, ordinaryRate: 12 })
  assert.equal(r.grossCents, 8 * 1200)
})
test('cambiar los tramos nocturnos (p. ej. 21:00–00:00 al 15 %)', () => {
  const cfg = { ...D, night1Start: '21:00', night1End: '00:00', night1Pct: 15 }
  const r = calcShift({ start: '20:00', end: '00:00' }, cfg)
  assert.deepEqual(mins(r), [h(1), h(3), 0, h(4)])
  assert.equal(rateCents(cfg).night1, 1178) // 10,24 × 1,15 = 11,776 → 11,78
})
test('IRPF y Seguridad Social se restan del bruto', () => {
  assert.equal(netFromGross(10000, { ...D, ssPct: 6.5, irpfPct: 2 }), 9150)
  assert.equal(netFromGross(10000, { ...D, ssPct: 0, irpfPct: 0 }), 10000)
})
test('la copia de parámetros reproduce exactamente el desglose original', () => {
  const original = calcShift({ start: '20:00', end: '00:30', extraMinutes: h(2) }, D)
  // Más tarde cambian las tarifas…
  const newSettings = { ...D, ordinaryRate: 20, ssPct: 10 }
  const rebuilt = buildLines(original.minutes, original.snapshot)
  assert.deepEqual(rebuilt.map((l) => l.totalCents), original.lines.map((l) => l.totalCents))
  // …pero un cálculo nuevo con los parámetros nuevos es distinto
  const fresh = calcShift({ start: '20:00', end: '00:30', extraMinutes: h(2) }, newSettings)
  assert.notEqual(fresh.grossCents, original.grossCents)
})
test('normalizeSettings corrige valores basura y rellena los que faltan', () => {
  const s = normalizeSettings({ ordinaryRate: 'abc', night1Start: '99:99', ssPct: -3 })
  assert.equal(s.ordinaryRate, D.ordinaryRate)
  assert.equal(s.night1Start, D.night1Start)
  assert.equal(s.ssPct, D.ssPct)
  assert.deepEqual(normalizeSettings(undefined), { ...D })
})
test('shiftTimes devuelve null con datos inválidos', () => {
  assert.equal(shiftTimes('', '10:00'), null)
  assert.equal(shiftTimes('20:00', '00:30', 120).realEndTime, '02:30')
})

console.log('Resúmenes')
test('summarizeShifts y groupByMonth suman por mes', () => {
  const rows = [
    { date: '2026-11-24', total_min: 390, ordinary_min: 120, night1_min: 150, night2_min: 120, extra_minutes: 120, gross_cents: 7321, net_cents: 6845 },
    { date: '2026-11-25', total_min: 480, ordinary_min: 480, night1_min: 0, night2_min: 0, extra_minutes: 0, gross_cents: 8192, net_cents: 7660 },
    { date: '2026-12-01', total_min: 60, ordinary_min: 60, night1_min: 0, night2_min: 0, extra_minutes: 0, gross_cents: 1024, net_cents: 957 },
  ]
  const nov = summarizeShifts(rows.slice(0, 2))
  assert.equal(nov.count, 2)
  assert.equal(nov.totalMin, 870)
  assert.equal(nov.extraMin, 120)
  assert.equal(nov.grossCents, 15513)
  assert.equal(nov.netCents, 14505)
  const g = groupByMonth(rows)
  assert.deepEqual(Object.keys(g).sort(), ['2026-11', '2026-12'])
  assert.equal(g['2026-12'].netCents, 957)
  assert.deepEqual(summarizeShifts([]), { count: 0, totalMin: 0, ordinaryMin: 0, night1Min: 0, night2Min: 0, extraMin: 0, grossCents: 0, netCents: 0 })
})

console.log(`\n${passed} correctas, ${failed} fallidas`)
process.exit(failed ? 1 : 0)
