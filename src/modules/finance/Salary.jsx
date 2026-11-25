import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Edit2, ChevronLeft, ChevronRight, ChevronDown, Settings, X, Check, RotateCcw } from 'lucide-react'
import { format, addMonths, subMonths, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import {
  DEFAULT_SALARY_SETTINGS, normalizeSettings, hourlyRates, calcShift, buildLines,
  parseDuration, shiftTimes, summarizeShifts, groupByMonth,
} from '../../lib/salaryCalc'

// ── Formato ───────────────────────────────────────────────────
const eur = (cents) => ((cents || 0) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
const hours = (min) => `${((min || 0) / 60).toLocaleString('es-ES', { maximumFractionDigits: 2 })} h`
const hhmm = (v) => (v || '').slice(0, 5)
const pct = (n) => String(n).replace('.', ',')
const durationLabel = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const scrollTop = () => document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })

// Fila de la BD a partir del resultado de calcShift
function rowFromResult({ date, start, end }, result) {
  return {
    date,
    start_time: start,
    end_time: end,
    extra_minutes: result.minutes.extra,
    ordinary_min: result.minutes.ordinary,
    night1_min: result.minutes.night1,
    night2_min: result.minutes.night2,
    total_min: result.minutes.total,
    gross_cents: result.grossCents,
    net_cents: result.netCents,
    rates_snapshot: result.snapshot,
    updated_at: new Date().toISOString(),
  }
}

// ── Desglose (tabla) ──────────────────────────────────────────
function Breakdown({ lines, grossCents, netCents, snapshot }) {
  const s = normalizeSettings(snapshot)
  const shown = lines.filter((l) => l.minutes > 0)
  const totalMin = lines.reduce((sum, l) => sum + l.minutes, 0)
  return (
    <div className="space-y-2">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th className="text-left font-medium pb-1">Concepto</th>
            <th className="text-right font-medium pb-1">Horas</th>
            <th className="text-right font-medium pb-1">Precio bruto</th>
            <th className="text-right font-medium pb-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => (
            <tr key={l.key} className="text-zinc-300">
              <td className="py-0.5">{l.label}</td>
              <td className="py-0.5 text-right">{hours(l.minutes)}</td>
              <td className="py-0.5 text-right">{eur(l.rateCents)}</td>
              <td className="py-0.5 text-right">{eur(l.totalCents)}</td>
            </tr>
          ))}
          <tr className="text-white font-semibold" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <td className="pt-1.5">Total bruto</td>
            <td className="pt-1.5 text-right">{hours(totalMin)}</td>
            <td />
            <td className="pt-1.5 text-right">{eur(grossCents)}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--jade) 10%, transparent)' }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Neto estimado (−{pct(s.ssPct)} % SS, −{pct(s.irpfPct)} % IRPF)
        </span>
        <span className="text-sm font-bold" style={{ color: 'var(--jade)' }}>{eur(netCents)}</span>
      </div>
    </div>
  )
}

// ── Formulario de turno ───────────────────────────────────────
function ShiftForm({ initial, settings, defaults, onSave, onCancel }) {
  const [date, setDate]   = useState(initial?.date || defaults.date)
  const [start, setStart] = useState(hhmm(initial?.start_time) || defaults.start)
  const [end, setEnd]     = useState(hhmm(initial?.end_time) || defaults.end)
  const [extra, setExtra] = useState(initial?.extra_minutes ? durationLabel(initial.extra_minutes) : '')
  const [saving, setSaving] = useState(false)

  // Al editar se conservan las tarifas con las que se registró el turno.
  const rates = initial?.rates_snapshot || settings
  const extraMin = parseDuration(extra)
  const result = useMemo(
    () => calcShift({ start, end, extraMinutes: extraMin === null ? NaN : extraMin }, rates),
    [start, end, extraMin, rates]
  )
  const usingOldRates = initial && JSON.stringify(normalizeSettings(initial.rates_snapshot)) !== JSON.stringify(normalizeSettings(settings))

  async function submit() {
    if (!result.ok || !date || saving) return
    setSaving(true)
    await onSave({ date, start, end }, result)
    setSaving(false)
  }

  return (
    <div className="card space-y-3" style={{ borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{initial ? 'Editar turno' : 'Nuevo turno'}</h3>
        <button onClick={onCancel} className="text-zinc-500 hover:text-white"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="col-span-2 sm:col-span-1">
          <label className="label">Fecha</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Inicio</label>
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">Finalización</label>
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <label className="label">H. complementarias</label>
          <input className="input" type="time" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </div>
      </div>

      {result.ok && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Salida real <span className="text-white font-medium">{result.realEndTime}</span>
            {result.endsNextDay && ' (día siguiente)'} · {hours(result.minutes.total)} trabajadas
          </p>
          <Breakdown lines={result.lines} grossCents={result.grossCents} netCents={result.netCents} snapshot={result.snapshot} />
        </div>
      )}
      {!result.ok && !result.incomplete && <p className="text-xs" style={{ color: 'var(--rose)' }}>{result.error}</p>}
      {usingOldRates && (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Este turno conserva las tarifas con las que se registró. Para usar las actuales, pulsa «Recalcular con tarifas actuales» en su detalle.
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={submit} disabled={!result.ok || !date || saving} className="btn-primary disabled:opacity-40">
          <Check size={15} /> {initial ? 'Guardar cambios' : 'Añadir turno'}
        </button>
        <button onClick={onCancel} className="btn-ghost">Cancelar</button>
      </div>
    </div>
  )
}

// ── Fila de turno (con desglose desplegable) ──────────────────
function ShiftRow({ shift, expanded, onToggle, onEdit, onDelete, onRecalc, currentSettings }) {
  const day = new Date(shift.date + 'T12:00:00')
  const lines = buildLines(
    { ordinary: shift.ordinary_min, night1: shift.night1_min, night2: shift.night2_min },
    shift.rates_snapshot
  )
  const times = shiftTimes(shift.start_time, shift.end_time, shift.extra_minutes)
  const outdated = JSON.stringify(normalizeSettings(shift.rates_snapshot)) !== JSON.stringify(normalizeSettings(currentSettings))

  return (
    <div className="rounded-2xl" style={{ background: 'var(--surface1)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div role="button" tabIndex={0} onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}
        className="flex items-center gap-3 px-3 py-3 cursor-pointer">
        <div className="w-11 text-center flex-shrink-0">
          <p className="text-lg font-bold text-white leading-none">{format(day, 'd')}</p>
          <p className="text-[10px] uppercase mt-0.5" style={{ color: 'var(--text-muted)' }}>{format(day, 'EEE', { locale: es })}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white">
            {hhmm(shift.start_time)} → {hhmm(shift.end_time)}
            {shift.extra_minutes > 0 && (
              <span className="text-xs ml-1.5" style={{ color: 'var(--amber)' }}>+{durationLabel(shift.extra_minutes)} compl.</span>
            )}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hours(shift.total_min)} · bruto {eur(shift.gross_cents)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold" style={{ color: 'var(--jade)' }}>{eur(shift.net_cents)}</p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>neto est.</p>
        </div>
        <ChevronDown size={14} className="flex-shrink-0" style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-3 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {times && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Salida real <span className="text-white font-medium">{times.realEndTime}</span>{times.endsNextDay && ' (día siguiente)'}
            </p>
          )}
          <Breakdown lines={lines} grossCents={shift.gross_cents} netCents={shift.net_cents} snapshot={shift.rates_snapshot} />
          <div className="flex flex-wrap gap-2">
            <button onClick={onEdit} className="btn-ghost text-xs py-1 gap-1"><Edit2 size={12} /> Editar</button>
            {outdated && (
              <button onClick={onRecalc} className="btn-ghost text-xs py-1 gap-1"><RotateCcw size={12} /> Recalcular con tarifas actuales</button>
            )}
            <button onClick={onDelete} className="btn-ghost text-xs py-1 gap-1 hover:text-rose"><Trash2 size={12} /> Eliminar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Configuración salarial ────────────────────────────────────
function SettingsPanel({ settings, onSave, onClose }) {
  const [draft, setDraft] = useState(() => ({ ...normalizeSettings(settings) }))
  const [saving, setSaving] = useState(false)
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }))
  const rates = hourlyRates(draft)
  const valid = Number(draft.ordinaryRate) > 0

  async function submit() {
    if (!valid || saving) return
    setSaving(true)
    await onSave(normalizeSettings(draft))
    setSaving(false)
  }

  const numField = (label, key, step = '0.01') => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" min="0" step={step} value={draft[key]} onChange={(e) => set(key, e.target.value)} />
    </div>
  )
  const timeField = (label, key) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="time" value={draft[key]} onChange={(e) => set(key, e.target.value)} />
    </div>
  )

  return (
    <div className="card space-y-4" style={{ borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Configuración salarial</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {numField('Tarifa bruta hora ordinaria (€)', 'ordinaryRate')}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Primer tramo nocturno</p>
        <div className="grid grid-cols-3 gap-2">
          {numField('Recargo (%)', 'night1Pct', '0.1')}
          {timeField('Desde', 'night1Start')}
          {timeField('Hasta', 'night1End')}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Segundo tramo nocturno</p>
        <div className="grid grid-cols-3 gap-2">
          {numField('Recargo (%)', 'night2Pct', '0.1')}
          {timeField('Desde', 'night2Start')}
          {timeField('Hasta', 'night2End')}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Deducciones estimadas</p>
        <div className="grid grid-cols-2 gap-2">
          {numField('Seguridad Social (%)', 'ssPct', '0.1')}
          {numField('IRPF (%)', 'irpfPct', '0.1')}
        </div>
      </div>

      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left font-medium pb-1">Concepto</th>
              <th className="text-right font-medium pb-1">Bruto/hora</th>
              <th className="text-right font-medium pb-1">Neto est./hora</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.key} className="text-zinc-300">
                <td className="py-0.5">{r.label}</td>
                <td className="py-0.5 text-right">{eur(r.grossCents)}</td>
                <td className="py-0.5 text-right">{eur(r.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Los cambios se aplican a los turnos nuevos. Los ya registrados conservan las tarifas con las que se calcularon.
      </p>

      <div className="flex flex-wrap gap-2">
        <button onClick={submit} disabled={!valid || saving} className="btn-primary disabled:opacity-40"><Check size={15} /> Guardar</button>
        <button onClick={() => setDraft({ ...DEFAULT_SALARY_SETTINGS })} className="btn-ghost text-xs gap-1"><RotateCcw size={12} /> Valores iniciales</button>
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
      </div>
    </div>
  )
}

// ── Sección principal ─────────────────────────────────────────
export default function Salary() {
  const [shifts, setShifts]     = useState([])
  const [settings, setSettings] = useState(() => normalizeSettings(DEFAULT_SALARY_SETTINGS))
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [month, setMonth]       = useState(startOfMonth(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [shiftsRes, settingsRes] = await Promise.all([
      supabase.from('salary_shifts').select('*').order('date', { ascending: false }).order('start_time', { ascending: false }),
      supabase.from('salary_settings').select('settings').eq('id', 1).maybeSingle(),
    ])
    if (shiftsRes.error) {
      console.error('load salary_shifts error:', shiftsRes.error)
      setLoadError(shiftsRes.error.message)
    } else {
      setLoadError(null)
      setShifts(shiftsRes.data || [])
    }
    if (settingsRes.error) console.error('load salary_settings error:', settingsRes.error)
    else if (settingsRes.data?.settings) setSettings(normalizeSettings(settingsRes.data.settings))
    setLoading(false)
  }

  const monthKey = format(month, 'yyyy-MM')
  const monthShifts = shifts.filter((s) => String(s.date).startsWith(monthKey))
  const summary = summarizeShifts(monthShifts)
  const history = Object.entries(groupByMonth(shifts)).sort((a, b) => b[0].localeCompare(a[0]))

  // Valores por defecto del formulario: hoy (o el día 1 del mes que se está viendo) y el último horario usado
  const isCurrentMonth = monthKey === format(new Date(), 'yyyy-MM')
  const last = shifts[0]
  const formDefaults = {
    date: isCurrentMonth ? format(new Date(), 'yyyy-MM-dd') : `${monthKey}-01`,
    start: last ? hhmm(last.start_time) : '',
    end: last ? hhmm(last.end_time) : '',
  }

  async function saveShift(form, result) {
    const row = rowFromResult(form, result)
    if (editing) {
      const { data, error } = await supabase.from('salary_shifts').update(row).eq('id', editing.id).select().single()
      if (error) { console.error('update shift error:', error); alert('No se pudo guardar el turno: ' + error.message); return }
      setShifts((prev) => prev.map((s) => (s.id === editing.id ? data : s)))
    } else {
      const { data, error } = await supabase.from('salary_shifts').insert([row]).select().single()
      if (error) { console.error('insert shift error:', error); alert('No se pudo guardar el turno: ' + error.message); return }
      setShifts((prev) => [data, ...prev].sort((a, b) => b.date.localeCompare(a.date) || String(b.start_time).localeCompare(String(a.start_time))))
      setMonth(startOfMonth(new Date(form.date + 'T12:00:00'))) // ir al mes del turno recién añadido
    }
    setEditing(null)
    setShowForm(false)
  }

  async function deleteShift(shift) {
    if (!window.confirm('¿Eliminar este turno? No se puede deshacer.')) return
    const { error } = await supabase.from('salary_shifts').delete().eq('id', shift.id)
    if (error) { console.error('delete shift error:', error); alert('No se pudo eliminar: ' + error.message); return }
    setShifts((prev) => prev.filter((s) => s.id !== shift.id))
  }

  async function recalcShift(shift) {
    const result = calcShift(
      { start: hhmm(shift.start_time), end: hhmm(shift.end_time), extraMinutes: shift.extra_minutes },
      settings
    )
    if (!result.ok) { alert(result.error || 'No se pudo recalcular el turno.'); return }
    const row = rowFromResult({ date: shift.date, start: hhmm(shift.start_time), end: hhmm(shift.end_time) }, result)
    const { data, error } = await supabase.from('salary_shifts').update(row).eq('id', shift.id).select().single()
    if (error) { console.error('recalc shift error:', error); alert('No se pudo recalcular: ' + error.message); return }
    setShifts((prev) => prev.map((s) => (s.id === shift.id ? data : s)))
  }

  async function saveSettings(next) {
    const { error } = await supabase.from('salary_settings').upsert({ id: 1, settings: next, updated_at: new Date().toISOString() })
    if (error) { console.error('save settings error:', error); alert('No se pudo guardar la configuración: ' + error.message); return }
    setSettings(next)
    setShowSettings(false)
  }

  function openNew() {
    setEditing(null); setShowSettings(false); setShowForm(true); scrollTop()
  }
  function openEdit(shift) {
    setEditing(shift); setShowSettings(false); setShowForm(true); scrollTop()
  }
  function openSettings() {
    setShowForm(false); setEditing(null); setShowSettings(true); scrollTop()
  }

  const labelN1 = `Nocturnas ${pct(settings.night1Pct)} %`
  const labelN2 = `Nocturnas ${pct(settings.night2Pct)} %`
  const stats = [
    { label: 'Horas totales', value: hours(summary.totalMin) },
    { label: 'Ordinarias', value: hours(summary.ordinaryMin) },
    { label: labelN1, value: hours(summary.night1Min) },
    { label: labelN2, value: hours(summary.night2Min) },
    { label: 'Complementarias', value: hours(summary.extraMin) },
  ]

  return (
    <div className="space-y-4">
      {/* Cabecera: mes + acciones */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth((m) => subMonths(m, 1))} className="btn-ghost px-2"><ChevronLeft size={16} /></button>
          <p className="text-sm font-medium text-white capitalize min-w-[110px] text-center">{format(month, 'MMMM yyyy', { locale: es })}</p>
          <button onClick={() => setMonth((m) => addMonths(m, 1))} className="btn-ghost px-2"><ChevronRight size={16} /></button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openSettings} className="btn-ghost px-2" title="Configuración salarial"><Settings size={16} /></button>
          <button onClick={openNew} className="btn-primary"><Plus size={15} /> Turno</button>
        </div>
      </div>

      {loadError && (
        <div className="card text-xs space-y-1" style={{ borderColor: 'color-mix(in srgb, var(--rose) 40%, transparent)' }}>
          <p style={{ color: 'var(--rose)' }}>No se pudieron cargar los turnos: {loadError}</p>
          <p style={{ color: 'var(--text-muted)' }}>¿Has ejecutado salary.sql en Supabase?</p>
        </div>
      )}

      {showSettings && <SettingsPanel settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />}
      {showForm && (
        <ShiftForm
          key={editing?.id || 'new'}
          initial={editing}
          settings={settings}
          defaults={formDefaults}
          onSave={saveShift}
          onCancel={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {/* Resumen del mes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center space-y-1" style={{ borderColor: 'color-mix(in srgb, var(--jade) 30%, transparent)' }}>
          <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Neto estimado</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--jade)' }}>{eur(summary.netCents)}</p>
        </div>
        <div className="card text-center space-y-1">
          <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Bruto</p>
          <p className="text-2xl font-bold text-white">{eur(summary.grossCents)}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="card-sm text-center space-y-0.5">
            <p className="text-sm font-semibold text-white">{s.value}</p>
            <p className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Turnos del mes */}
      {loading ? (
        <p className="muted text-center py-8">Cargando...</p>
      ) : monthShifts.length === 0 ? (
        <div className="text-center py-8 space-y-1">
          <p className="text-3xl">🕐</p>
          <p className="muted">Sin turnos registrados este mes.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {monthShifts.map((s) => (
            <ShiftRow
              key={s.id}
              shift={s}
              currentSettings={settings}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
              onEdit={() => openEdit(s)}
              onDelete={() => deleteShift(s)}
              onRecalc={() => recalcShift(s)}
            />
          ))}
        </div>
      )}

      {/* Historial de meses */}
      {history.length > 0 && (
        <div className="card space-y-2">
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Historial</p>
          {history.map(([key, g]) => (
            <button key={key} onClick={() => setMonth(startOfMonth(new Date(key + '-01T12:00:00')))}
              className="w-full flex items-center gap-3 py-1.5 text-left rounded-lg hover:bg-white/5 transition-colors"
              style={{ background: key === monthKey ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
              <span className="flex-1 text-sm text-white capitalize px-1">{format(new Date(key + '-01T12:00:00'), 'MMMM yyyy', { locale: es })}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{hours(g.totalMin)}</span>
              <span className="text-xs w-20 text-right" style={{ color: 'var(--text-muted)' }}>{eur(g.grossCents)}</span>
              <span className="text-sm font-semibold w-24 text-right pr-1" style={{ color: 'var(--jade)' }}>{eur(g.netCents)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
