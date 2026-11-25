// Cálculo de turnos y sueldo. Funciones puras: sin React ni Supabase, para poder probarlas.
//
// Convenciones:
//  - Las horas se manejan como minutos desde las 00:00 del día de inicio del turno.
//  - Si un turno cruza la medianoche, los minutos pasan de 1440 (p. ej. 02:30 del día siguiente = 1590).
//  - Los importes se calculan en céntimos (enteros) para evitar errores de coma flotante.
//  - Los precios por hora se redondean al céntimo (igual que en una nómina) y después se multiplican
//    por las horas de cada tramo.

export const DEFAULT_SALARY_SETTINGS = Object.freeze({
  ordinaryRate: 10.24, // € brutos por hora ordinaria
  night1Pct: 10,       // recargo del primer tramo nocturno (%)
  night1Start: '22:00',
  night1End: '00:30',
  night2Pct: 20,       // recargo del segundo tramo nocturno (%)
  night2Start: '00:30',
  night2End: '06:00',
  ssPct: 6.5,          // Seguridad Social estimada (%)
  irpfPct: 0,          // IRPF estimado (%)
})

const DAY = 1440

// ── Tiempo ───────────────────────────────────────────────────────────────────

/** 'HH:MM' o 'HH:MM:SS' → minutos desde las 00:00. Devuelve null si no es válido. */
export function parseTime(value) {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Minutos → 'HH:MM' (da la vuelta cada 24 h). */
export function formatTime(totalMin) {
  const t = ((Math.round(totalMin) % DAY) + DAY) % DAY
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Duración 'HH:MM' → minutos. Vacío → 0. Inválido → null. */
export function parseDuration(value) {
  if (value === '' || value === null || value === undefined) return 0
  return parseTime(value)
}

// ── Parámetros ───────────────────────────────────────────────────────────────

/** Sanea unos parámetros (datos de la BD o del formulario) y devuelve siempre un objeto completo y válido. */
export function normalizeSettings(raw) {
  const d = DEFAULT_SALARY_SETTINGS
  const src = raw && typeof raw === 'object' ? raw : {}
  const num = (v, fallback) => {
    if (v === '' || v === null || v === undefined) return fallback
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const time = (v, fallback) => {
    const m = parseTime(v)
    return m === null ? fallback : formatTime(m)
  }
  return {
    ordinaryRate: num(src.ordinaryRate, d.ordinaryRate),
    night1Pct: num(src.night1Pct, d.night1Pct),
    night1Start: time(src.night1Start, d.night1Start),
    night1End: time(src.night1End, d.night1End),
    night2Pct: num(src.night2Pct, d.night2Pct),
    night2Start: time(src.night2Start, d.night2Start),
    night2End: time(src.night2End, d.night2End),
    ssPct: num(src.ssPct, d.ssPct),
    irpfPct: num(src.irpfPct, d.irpfPct),
  }
}

/** Precio bruto por hora de cada tipo, en céntimos. */
export function rateCents(rawSettings) {
  const s = normalizeSettings(rawSettings)
  const ordinary = Math.round(s.ordinaryRate * 100)
  return {
    ordinary,
    night1: Math.round((ordinary * (100 + s.night1Pct)) / 100),
    night2: Math.round((ordinary * (100 + s.night2Pct)) / 100),
  }
}

/** Neto estimado a partir de un bruto en céntimos: bruto × (1 − SS − IRPF). */
export function netFromGross(grossCents, rawSettings) {
  const s = normalizeSettings(rawSettings)
  const factor = Math.max(0, 100 - s.ssPct - s.irpfPct)
  return Math.round((grossCents * factor) / 100)
}

const pct = (n) => String(n).replace('.', ',')

/** Tabla de precios por hora (bruto y neto) para mostrar en la configuración. */
export function hourlyRates(rawSettings) {
  const s = normalizeSettings(rawSettings)
  const r = rateCents(s)
  return [
    { key: 'ordinary', label: 'Hora ordinaria', grossCents: r.ordinary, netCents: netFromGross(r.ordinary, s) },
    { key: 'night1', label: `Nocturna ${s.night1Start}–${s.night1End} (+${pct(s.night1Pct)} %)`, grossCents: r.night1, netCents: netFromGross(r.night1, s) },
    { key: 'night2', label: `Nocturna ${s.night2Start}–${s.night2End} (+${pct(s.night2Pct)} %)`, grossCents: r.night2, netCents: netFromGross(r.night2, s) },
  ]
}

// ── Turnos ───────────────────────────────────────────────────────────────────

/**
 * Resuelve la línea de tiempo de un turno.
 * hora real de salida = hora de finalización + horas complementarias.
 * Devuelve null si faltan datos o no son válidos.
 */
export function shiftTimes(start, end, extraMinutes = 0) {
  const s = parseTime(start)
  const e0 = parseTime(end)
  if (s === null || e0 === null) return null
  const extra = Number(extraMinutes) || 0
  const e = e0 <= s ? e0 + DAY : e0 // si termina "antes" de empezar, cruza la medianoche
  const realEnd = e + extra
  return {
    startMin: s,
    endMin: e,
    realEndMin: realEnd,
    realEndTime: formatTime(realEnd),
    endsNextDay: realEnd >= DAY,
  }
}

function inWindow(tod, start, end) {
  if (start === end) return false // tramo desactivado
  return start < end ? tod >= start && tod < end : tod >= start || tod < end
}

const lineCents = (minutes, rate) => Math.round((minutes * rate) / 60)

/** Desglose (líneas con horas, precio y total) a partir de los minutos de cada tramo y unos parámetros. */
export function buildLines(minutes, rawSettings) {
  const s = normalizeSettings(rawSettings)
  const r = rateCents(s)
  const ordinary = minutes.ordinary || 0
  const night1 = minutes.night1 || 0
  const night2 = minutes.night2 || 0
  return [
    { key: 'ordinary', label: 'Ordinarias', minutes: ordinary, rateCents: r.ordinary, totalCents: lineCents(ordinary, r.ordinary) },
    { key: 'night1', label: `Nocturnas ${pct(s.night1Pct)} %`, minutes: night1, rateCents: r.night1, totalCents: lineCents(night1, r.night1) },
    { key: 'night2', label: `Nocturnas ${pct(s.night2Pct)} %`, minutes: night2, rateCents: r.night2, totalCents: lineCents(night2, r.night2) },
  ]
}

/**
 * Calcula un turno completo.
 *  input: { start: 'HH:MM', end: 'HH:MM', extraMinutes: number }
 *  Devuelve { ok: true, ... } o { ok: false, incomplete?, error }.
 *  `incomplete` indica que aún faltan datos (no es un error que mostrar).
 */
export function calcShift({ start, end, extraMinutes = 0 } = {}, rawSettings = DEFAULT_SALARY_SETTINGS) {
  const snapshot = normalizeSettings(rawSettings)

  const s = parseTime(start)
  const e0 = parseTime(end)
  if (s === null || e0 === null) return { ok: false, incomplete: true, error: '' }

  const extra = typeof extraMinutes === 'number' ? Math.round(extraMinutes) : NaN
  if (!Number.isFinite(extra) || extra < 0) {
    return { ok: false, error: 'Las horas complementarias no son válidas.' }
  }
  if (e0 === s) {
    return { ok: false, error: 'La hora de finalización no puede ser igual a la de inicio.' }
  }

  const times = shiftTimes(start, end, extra)
  const total = times.realEndMin - times.startMin
  if (total > DAY) {
    return { ok: false, error: 'El turno no puede durar más de 24 horas.' }
  }

  // Clasificación minuto a minuto: simple y válida para cualquier configuración de tramos.
  const n1s = parseTime(snapshot.night1Start)
  const n1e = parseTime(snapshot.night1End)
  const n2s = parseTime(snapshot.night2Start)
  const n2e = parseTime(snapshot.night2End)
  const minutes = { ordinary: 0, night1: 0, night2: 0 }
  for (let m = times.startMin; m < times.realEndMin; m++) {
    const tod = m % DAY
    if (inWindow(tod, n1s, n1e)) minutes.night1++
    else if (inWindow(tod, n2s, n2e)) minutes.night2++
    else minutes.ordinary++
  }

  const lines = buildLines(minutes, snapshot)
  const grossCents = lines.reduce((sum, l) => sum + l.totalCents, 0)

  return {
    ok: true,
    startMin: times.startMin,
    endMin: times.endMin,
    realEndMin: times.realEndMin,
    realEndTime: times.realEndTime,
    endsNextDay: times.endsNextDay,
    minutes: { ...minutes, total, extra },
    lines,
    grossCents,
    netCents: netFromGross(grossCents, snapshot),
    snapshot, // copia de los parámetros usados: se guarda en cada registro
  }
}

// ── Resúmenes ────────────────────────────────────────────────────────────────

/** Suma una lista de turnos guardados (filas de la BD). */
export function summarizeShifts(rows) {
  return (rows || []).reduce(
    (a, r) => ({
      count: a.count + 1,
      totalMin: a.totalMin + (r.total_min || 0),
      ordinaryMin: a.ordinaryMin + (r.ordinary_min || 0),
      night1Min: a.night1Min + (r.night1_min || 0),
      night2Min: a.night2Min + (r.night2_min || 0),
      extraMin: a.extraMin + (r.extra_minutes || 0),
      grossCents: a.grossCents + (r.gross_cents || 0),
      netCents: a.netCents + (r.net_cents || 0),
    }),
    { count: 0, totalMin: 0, ordinaryMin: 0, night1Min: 0, night2Min: 0, extraMin: 0, grossCents: 0, netCents: 0 }
  )
}

/** Agrupa turnos por mes ('yyyy-MM', según la fecha de inicio) → { 'yyyy-MM': resumen }. */
export function groupByMonth(rows) {
  const groups = {}
  for (const r of rows || []) {
    const key = String(r.date).slice(0, 7)
    ;(groups[key] = groups[key] || []).push(r)
  }
  const out = {}
  for (const [key, list] of Object.entries(groups)) out[key] = summarizeShifts(list)
  return out
}
