import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BookingSource, Reservation } from '../types';
import { formatDisplayDate, getLocalDateString, normalizeDateForCompare } from '../utils/date';
import { isActiveReservation, isCanceledReservation } from '../utils/reservationStatus';

type ReportPeriod = '7d' | '30d' | 'month';
type OriginKey = 'bot' | 'manual' | 'walkin';

interface ReportsProps {
  reservations: Reservation[];
}

interface PeriodRange {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
}

const PERIOD_OPTIONS: Array<{ key: ReportPeriod; label: string }> = [
  { key: '7d', label: 'Ultimos 7 dias' },
  { key: '30d', label: 'Ultimos 30 dias' },
  { key: 'month', label: 'Este mes' },
];

const TICKET_STORAGE_KEY = 'manager_reports_average_ticket';
const DEFAULT_AVERAGE_TICKET = 35;
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const ORIGIN_LABELS: Record<OriginKey, string> = {
  bot: 'BOT',
  manual: 'MANUAL',
  walkin: 'WALK-IN',
};

function addDays(date: string, days: number) {
  const baseDate = new Date(`${date}T12:00:00`);
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().slice(0, 10);
}

function getMonthStart(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function getMonthEnd(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function getPeriodRange(period: ReportPeriod): PeriodRange {
  const today = getLocalDateString(new Date());
  const currentDate = new Date(`${today}T12:00:00`);

  if (period === 'month') {
    const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1, 12);

    return {
      start: getMonthStart(currentDate),
      end: today,
      previousStart: getMonthStart(previousMonth),
      previousEnd: getMonthEnd(previousMonth),
    };
  }

  const days = period === '7d' ? 7 : 30;

  return {
    start: addDays(today, -(days - 1)),
    end: today,
    previousStart: addDays(today, -(days * 2 - 1)),
    previousEnd: addDays(today, -days),
  };
}

function getDatesInRange(start: string, end: string) {
  const dates: string[] = [];
  let cursor = start;

  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function getOriginKey(source: BookingSource): OriginKey {
  if (source === 'WALKIN') {
    return 'walkin';
  }

  if (source === 'MANUAL') {
    return 'manual';
  }

  return 'bot';
}

function getLanguageKey(language = '') {
  const normalized = language.trim().toUpperCase();

  if (['ES', 'ESP', 'ESPANOL', 'SPANISH'].includes(normalized)) {
    return 'spanish';
  }

  if (['EN', 'ENG', 'INGLES', 'ENGLISH'].includes(normalized)) {
    return 'english';
  }

  return 'unknown';
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function getDeltaPercent(current: number, previous: number) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Math.round(((current - previous) / previous) * 100);
}

function getDeltaTone(delta: number) {
  if (delta > 0) {
    return 'is-up';
  }

  if (delta < 0) {
    return 'is-down';
  }

  return 'is-flat';
}

function getCancellationTone(rate: number) {
  if (rate < 10) {
    return 'is-good';
  }

  if (rate <= 20) {
    return 'is-warning';
  }

  return 'is-danger';
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function getTopEntry(counts: Record<string, number>) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0] ? { label: entries[0][0], count: entries[0][1] } : { label: '-', count: 0 };
}

function buildDailyChartData(reservations: Reservation[], range: PeriodRange, mode: 'reservations' | 'pax') {
  return getDatesInRange(range.start, range.end).map((date) => {
    const dayReservations = reservations.filter((reservation) => normalizeDateForCompare(reservation.date) === date);
    return {
      label: formatDisplayDate(date).slice(0, 5),
      value: mode === 'pax' ? dayReservations.reduce((total, reservation) => total + reservation.pax, 0) : dayReservations.length,
    };
  });
}

function buildHourChartData(reservations: Reservation[]) {
  const counts = reservations.reduce<Record<string, number>>((items, reservation) => {
    if (!reservation.time) {
      return items;
    }

    items[reservation.time] = (items[reservation.time] ?? 0) + 1;
    return items;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));
}

function getMostDemandedDay(reservations: Reservation[]) {
  const counts = reservations.reduce<Record<string, number>>((items, reservation) => {
    const date = normalizeDateForCompare(reservation.date);

    if (!date) {
      return items;
    }

    const dayName = DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
    items[dayName] = (items[dayName] ?? 0) + 1;
    return items;
  }, {});

  return getTopEntry(counts);
}

function buildReportStats(reservations: Reservation[], range: { start: string; end: string }) {
  const periodReservations = reservations.filter((reservation) => {
    const date = normalizeDateForCompare(reservation.date);
    return date >= range.start && date <= range.end;
  });
  const activeReservations = periodReservations.filter(isActiveReservation);
  const canceledReservations = periodReservations.filter(isCanceledReservation);
  const totalPax = activeReservations.reduce((total, reservation) => total + reservation.pax, 0);
  const botReservations = activeReservations.filter((reservation) => getOriginKey(reservation.source) === 'bot');
  const botPax = botReservations.reduce((total, reservation) => total + reservation.pax, 0);
  const originCounts = activeReservations.reduce<Record<OriginKey, number>>(
    (items, reservation) => {
      items[getOriginKey(reservation.source)] += 1;
      return items;
    },
    { bot: 0, manual: 0, walkin: 0 },
  );
  const languageCounts = activeReservations.reduce(
    (items, reservation) => {
      const key = getLanguageKey(reservation.language);
      if (key === 'spanish' || key === 'english') {
        items[key] += 1;
      }
      return items;
    },
    { spanish: 0, english: 0 },
  );

  return {
    activeReservations,
    totalReservations: periodReservations.length,
    confirmedReservations: activeReservations.length,
    canceledCount: canceledReservations.length,
    cancellationRate: percentage(canceledReservations.length, periodReservations.length),
    totalPax,
    averagePax: activeReservations.length > 0 ? totalPax / activeReservations.length : 0,
    botReservations: botReservations.length,
    botPax,
    originCounts,
    languageCounts,
    topTime: getTopEntry(
      activeReservations.reduce<Record<string, number>>((items, reservation) => {
        if (reservation.time) {
          items[reservation.time] = (items[reservation.time] ?? 0) + 1;
        }
        return items;
      }, {}),
    ),
    topDay: getMostDemandedDay(activeReservations),
  };
}

export function Reports({ reservations }: ReportsProps) {
  const [period, setPeriod] = useState<ReportPeriod>('7d');
  const [averageTicket, setAverageTicket] = useState(() => {
    const storedValue = localStorage.getItem(TICKET_STORAGE_KEY);
    const parsedValue = Number(storedValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_AVERAGE_TICKET;
  });
  const range = useMemo(() => getPeriodRange(period), [period]);
  const stats = useMemo(() => buildReportStats(reservations, range), [range, reservations]);
  const previousStats = useMemo(
    () => buildReportStats(reservations, { start: range.previousStart, end: range.previousEnd }),
    [range.previousEnd, range.previousStart, reservations],
  );
  const originTotal = stats.confirmedReservations;
  const languageTotal = stats.languageCounts.spanish + stats.languageCounts.english;
  const estimatedRevenue = stats.totalPax * averageTicket;
  const estimatedBotRevenue = stats.botPax * averageTicket;
  const botRevenueWeight = percentage(estimatedBotRevenue, estimatedRevenue);
  const dailyReservations = buildDailyChartData(stats.activeReservations, range, 'reservations');
  const dailyPax = buildDailyChartData(stats.activeReservations, range, 'pax');
  const originChart = (Object.keys(stats.originCounts) as OriginKey[]).map((key) => ({
    label: ORIGIN_LABELS[key],
    value: stats.originCounts[key],
    percent: percentage(stats.originCounts[key], originTotal),
  }));
  const hourChart = buildHourChartData(stats.activeReservations);
  const maxHourValue = Math.max(...hourChart.map((hour) => hour.value), 1);

  function updateAverageTicket(value: number) {
    const nextValue = Number.isFinite(value) && value > 0 ? value : DEFAULT_AVERAGE_TICKET;
    setAverageTicket(nextValue);
    localStorage.setItem(TICKET_STORAGE_KEY, String(nextValue));
  }

  return (
    <main className="app-shell">
      <PageHeader eyebrow="Estadisticas" title="INFORMES" />

      <section className="toolbar-card reports-toolbar">
        <label>
          Periodo
          <div className="segmented-control" aria-label="Periodo informes">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={period === option.key ? 'is-active' : ''}
                type="button"
                onClick={() => setPeriod(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </label>
        <div className="report-range">
          <span>Desde {formatDisplayDate(range.start)}</span>
          <strong>Hasta {formatDisplayDate(range.end)}</strong>
        </div>
      </section>

      <section className="reports-executive-grid">
        <ReportCard title="Reservas">
          <Metric label="Reservas totales" value={stats.totalReservations} delta={getDeltaPercent(stats.totalReservations, previousStats.totalReservations)} featured />
          <div className="report-inline-metrics">
            <Metric label="Confirmadas" value={stats.confirmedReservations} compact />
            <Metric label="Canceladas" value={stats.canceledCount} delta={getDeltaPercent(stats.canceledCount, previousStats.canceledCount)} compact />
          </div>
          <Metric label="Tasa de cancelacion" value={`${stats.cancellationRate}%`} tone={getCancellationTone(stats.cancellationRate)} compact />
          <VerticalBars data={dailyReservations} compact />
        </ReportCard>

        <ReportCard title="PAX / Clientes">
          <Metric label="PAX totales" value={stats.totalPax} delta={getDeltaPercent(stats.totalPax, previousStats.totalPax)} featured />
          <Metric label="PAX media por reserva" value={stats.averagePax.toFixed(1)} compact />
          <VerticalBars data={dailyPax} compact />
        </ReportCard>

        <ReportCard title="Origen de reservas">
          <Metric label="Reservas BOT" value={stats.botReservations} delta={getDeltaPercent(stats.botReservations, previousStats.botReservations)} compact />
          <HorizontalBars data={originChart} highlightLabel="BOT" />
        </ReportCard>

        <ReportCard title="Impacto estimado">
          <label className="report-ticket-input">
            Ticket medio estimado
            <input min="1" type="number" value={averageTicket} onChange={(event) => updateAverageTicket(Number(event.target.value))} />
          </label>
          <Metric label="Ingresos estimados" value={formatMoney(estimatedRevenue)} featured />
          <Metric label="Ingresos estimados via BOT" value={formatMoney(estimatedBotRevenue)} compact />
          <Metric label="Peso del BOT sobre el total" value={`${botRevenueWeight}%`} compact />
          <HorizontalBars data={[{ label: 'BOT', value: estimatedBotRevenue, percent: botRevenueWeight }]} highlightLabel="BOT" />
        </ReportCard>

        <ReportCard title="Actividad">
          <div className="report-inline-metrics">
            <Metric label="Hora mas demandada" value={stats.topTime.label} detail={`${stats.topTime.count} reservas`} compact />
            <Metric label="Dia mas demandado" value={stats.topDay.label} detail={`${stats.topDay.count} reservas`} compact />
          </div>
          <HorizontalBars data={hourChart.map((item) => ({ ...item, percent: percentage(item.value, maxHourValue) }))} />
        </ReportCard>

        <ReportCard title="Idiomas">
          <div className="report-inline-metrics">
            <Metric label="Espanol" value={stats.languageCounts.spanish} detail={`${percentage(stats.languageCounts.spanish, languageTotal)}%`} compact />
            <Metric label="Ingles" value={stats.languageCounts.english} detail={`${percentage(stats.languageCounts.english, languageTotal)}%`} compact />
          </div>
          <HorizontalBars
            data={[
              { label: 'Espanol', value: stats.languageCounts.spanish, percent: percentage(stats.languageCounts.spanish, languageTotal) },
              { label: 'Ingles', value: stats.languageCounts.english, percent: percentage(stats.languageCounts.english, languageTotal) },
            ]}
          />
        </ReportCard>
      </section>
    </main>
  );
}

function ReportCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="report-card">
      <p className="eyebrow">{title}</p>
      <div className="report-metrics">{children}</div>
    </article>
  );
}

function Metric({
  label,
  value,
  detail,
  delta,
  tone,
  compact = false,
  featured = false,
}: {
  label: string;
  value: number | string;
  detail?: string;
  delta?: number;
  tone?: string;
  compact?: boolean;
  featured?: boolean;
}) {
  const className = ['report-metric', tone ?? '', compact ? 'is-compact' : '', featured ? 'is-featured' : ''].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
      {delta !== undefined && (
        <small className={`report-delta ${getDeltaTone(delta)}`}>
          {delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'IGUAL'} {Math.abs(delta)}% vs periodo anterior
        </small>
      )}
      {detail && <small>{detail}</small>}
    </div>
  );
}

function VerticalBars({ data, compact = false }: { data: Array<{ label: string; value: number }>; compact?: boolean }) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <div className={`vertical-chart ${compact ? 'is-compact' : ''}`}>
      {data.map((item) => (
        <div className="vertical-bar-item" key={item.label}>
          <div className="vertical-bar-track">
            <span style={{ height: `${(item.value / maxValue) * 100}%` }} />
          </div>
          <strong>{item.value}</strong>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({
  data,
  highlightLabel,
}: {
  data: Array<{ label: string; value: number; percent?: number }>;
  highlightLabel?: string;
}) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <div className="horizontal-chart">
      {data.length === 0 ? (
        <p className="muted-cell">Sin datos</p>
      ) : (
        data.map((item) => {
          const width = item.percent ?? percentage(item.value, maxValue);
          const isHighlighted = highlightLabel === item.label;

          return (
            <div className={`horizontal-bar-item ${isHighlighted ? 'is-highlighted' : ''}`} key={item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>
                  {item.value}
                  {item.percent !== undefined ? ` · ${item.percent}%` : ''}
                </span>
              </div>
              <div className="horizontal-bar-track">
                <span style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <section className="top-bar">
      <div className="brand-lockup">
        <div className="logo-mark" aria-hidden="true">
          S
        </div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </div>
    </section>
  );
}
