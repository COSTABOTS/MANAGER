import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { jsPDF } from 'jspdf';
import { RESTAURANT_LOGO } from '../config/branding';
import type { Feedback } from '../services/feedbacks';
import type { BookingSource, Reservation } from '../types';
import { formatDisplayDate, getLocalDateString, normalizeDateForCompare } from '../utils/date';
import { isActiveReservation, isCanceledReservation } from '../utils/reservationStatus';

type ReportPeriod = '7d' | '30d' | 'month';
type OriginKey = 'bot' | 'manual' | 'walkin';

interface ReportsProps {
  reservations: Reservation[];
  feedbacks: Feedback[];
  restaurantLogoUrl: string;
  restaurantName: string;
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

function getPeriodLabel(period: ReportPeriod) {
  return PERIOD_OPTIONS.find((option) => option.key === period)?.label ?? period;
}

async function loadImageAsDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('No canvas context'));
          return;
        }
        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('No se pudo cargar el logo'));
    image.src = url;
  });
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

export function Reports({ reservations, feedbacks, restaurantLogoUrl, restaurantName }: ReportsProps) {
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
  const validFeedbacks = feedbacks.filter((feedback) => feedback.rating > 0);
  const averageRating = validFeedbacks.length > 0
    ? validFeedbacks.reduce((total, feedback) => total + feedback.rating, 0) / validFeedbacks.length
    : 0;
  const negativeFeedbacks = feedbacks
    .filter((feedback) => feedback.rating > 0 && feedback.rating <= 2)
    .slice()
    .sort((a, b) => (b.timestamp || b.date).localeCompare(a.timestamp || a.date))
    .slice(0, 5);

  function updateAverageTicket(value: number) {
    const nextValue = Number.isFinite(value) && value > 0 ? value : DEFAULT_AVERAGE_TICKET;
    setAverageTicket(nextValue);
    localStorage.setItem(TICKET_STORAGE_KEY, String(nextValue));
  }

  async function exportPdf() {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 16;
    let cursorY = 18;

    const logoUrl = restaurantLogoUrl || RESTAURANT_LOGO;
    if (logoUrl) {
      try {
        const logoDataUrl = await loadImageAsDataUrl(logoUrl);
        doc.addImage(logoDataUrl, 'PNG', margin, cursorY - 4, 22, 22);
      } catch {
        // If the remote logo cannot be rendered because of CORS, the report still downloads.
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Safari Manager - Informe', logoUrl ? margin + 28 : margin, cursorY + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Periodo: ${getPeriodLabel(period)} (${formatDisplayDate(range.start)} - ${formatDisplayDate(range.end)})`, logoUrl ? margin + 28 : margin, cursorY + 11);
    cursorY += 34;

    const writeSection = (title: string) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(title, margin, cursorY);
      cursorY += 8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
    };

    const writeLine = (label: string, value: string | number) => {
      doc.text(`${label}: ${value}`, margin, cursorY);
      cursorY += 6;
    };

    writeSection('KPIs principales');
    writeLine('Reservas totales', stats.totalReservations);
    writeLine('Confirmadas', stats.confirmedReservations);
    writeLine('Canceladas', stats.canceledCount);
    writeLine('Tasa de cancelacion', `${stats.cancellationRate}%`);
    writeLine('PAX totales', stats.totalPax);
    writeLine('PAX media por reserva', stats.averagePax.toFixed(1));
    cursorY += 4;

    writeSection('Impacto economico');
    writeLine('Ticket medio estimado', formatMoney(averageTicket));
    writeLine('Ingresos estimados', formatMoney(estimatedRevenue));
    writeLine('Ingresos estimados via BOT', formatMoney(estimatedBotRevenue));
    writeLine('Peso del BOT sobre el total', `${botRevenueWeight}%`);
    cursorY += 4;

    writeSection('Origen reservas');
    originChart.forEach((origin) => writeLine(origin.label, `${origin.value} (${origin.percent}%)`));
    cursorY += 4;

    writeSection('Valoracion media');
    writeLine('Feedbacks recibidos', feedbacks.length);
    writeLine('Valoracion media', averageRating > 0 ? averageRating.toFixed(1) : 'Sin datos');
    cursorY += 4;

    writeSection('Ultimos comentarios negativos');
    if (negativeFeedbacks.length === 0) {
      writeLine('Comentarios', 'No hay comentarios negativos');
    } else {
      negativeFeedbacks.forEach((feedback) => {
        const text = `${feedback.date || '-'} · ${feedback.client || 'Cliente'} · ${feedback.rating}/5 · ${feedback.comment || '-'}`;
        const lines = doc.splitTextToSize(text, 175);
        doc.text(lines, margin, cursorY);
        cursorY += lines.length * 5 + 3;
        if (cursorY > 280) {
          doc.addPage();
          cursorY = 18;
        }
      });
    }

    doc.save(`Safari_Informe_${getLocalDateString(new Date())}.pdf`);
  }

  async function exportExecutivePdf() {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 16;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let cursorY = 18;

    const colors = {
      ink: [28, 39, 58] as const,
      muted: [93, 105, 126] as const,
      line: [220, 226, 235] as const,
      soft: [247, 249, 252] as const,
      blue: [79, 127, 209] as const,
      green: [51, 143, 96] as const,
      red: [194, 73, 73] as const,
      redSoft: [255, 239, 239] as const,
      amber: [214, 161, 38] as const,
    };

    const setText = (color: readonly [number, number, number]) => doc.setTextColor(color[0], color[1], color[2]);
    const setFill = (color: readonly [number, number, number]) => doc.setFillColor(color[0], color[1], color[2]);
    const setDraw = (color: readonly [number, number, number]) => doc.setDrawColor(color[0], color[1], color[2]);

    const addFooter = () => {
      setText(colors.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Generado por COSTABOTS Manager', margin, pageHeight - 10);
      doc.text(String(doc.getNumberOfPages()), pageWidth - margin, pageHeight - 10, { align: 'right' });
    };

    const ensureSpace = (height: number) => {
      if (cursorY + height <= pageHeight - 18) {
        return;
      }

      addFooter();
      doc.addPage();
      cursorY = 18;
    };

    const nextPage = () => {
      addFooter();
      doc.addPage();
      cursorY = 18;
    };

    const ensureSection = (height: number) => {
      ensureSpace(height);
    };

    const sectionTitle = (title: string) => {
      ensureSpace(14);
      setText(colors.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(title, margin, cursorY);
      cursorY += 8;
    };

    const drawCard = (
      x: number,
      y: number,
      width: number,
      height: number,
      label: string,
      value: string | number,
      accent: readonly [number, number, number],
      detail?: string,
    ) => {
      setFill(colors.soft);
      setDraw(colors.line);
      doc.roundedRect(x, y, width, height, 2, 2, 'FD');
      setFill(accent);
      doc.roundedRect(x, y, 3, height, 1.5, 1.5, 'F');
      setText(colors.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(label.toUpperCase(), x + 6, y + 7);
      setText(colors.ink);
      doc.setFontSize(14);
      doc.text(String(value), x + 6, y + 16);
      if (detail) {
        setText(colors.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(detail, x + 6, y + 23);
      }
    };

    const drawBar = (label: string, valueText: string, percent: number, color: readonly [number, number, number]) => {
      ensureSpace(9);
      setText(colors.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(label, margin, cursorY);
      setText(colors.muted);
      doc.text(valueText, pageWidth - margin, cursorY, { align: 'right' });
      setFill([232, 237, 245]);
      doc.roundedRect(margin + 34, cursorY - 3.5, 95, 4, 2, 2, 'F');
      setFill(color);
      doc.roundedRect(margin + 34, cursorY - 3.5, Math.max(2, Math.min(95, (percent / 100) * 95)), 4, 2, 2, 'F');
      cursorY += 8;
    };

    const generatedAt = new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date());
    const logoUrl = restaurantLogoUrl || RESTAURANT_LOGO;

    if (logoUrl) {
      try {
        const logoDataUrl = await loadImageAsDataUrl(logoUrl);
        doc.addImage(logoDataUrl, 'PNG', margin, cursorY - 3, 24, 24);
      } catch {
        // The PDF must still be generated if a remote logo fails.
      }
    }

    setFill([95, 104, 120]);
    doc.roundedRect(pageWidth - margin - 42, cursorY - 2, 42, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('COSTABOTS MANAGER', pageWidth - margin - 21, cursorY + 4.3, { align: 'center' });

    setText(colors.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(21);
    doc.text('Informe de actividad', logoUrl ? margin + 30 : margin, cursorY + 4);
    setText(colors.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`${restaurantName} · ${getPeriodLabel(period)} · ${formatDisplayDate(range.start)} - ${formatDisplayDate(range.end)}`, logoUrl ? margin + 30 : margin, cursorY + 12);
    doc.setFontSize(8.5);
    doc.text(`Generado: ${generatedAt}`, logoUrl ? margin + 30 : margin, cursorY + 18);
    cursorY += 34;

    ensureSection(78);
    sectionTitle('KPIs principales');
    const cardGap = 5;
    const cardWidth = (pageWidth - margin * 2 - cardGap * 2) / 3;
    drawCard(margin, cursorY, cardWidth, 26, 'Reservas totales', stats.totalReservations, colors.blue);
    drawCard(margin + cardWidth + cardGap, cursorY, cardWidth, 26, 'Confirmadas', stats.confirmedReservations, colors.green);
    drawCard(margin + (cardWidth + cardGap) * 2, cursorY, cardWidth, 26, 'Canceladas', stats.canceledCount, colors.red);
    cursorY += 31;
    drawCard(margin, cursorY, cardWidth, 26, 'Tasa cancelacion', `${stats.cancellationRate}%`, stats.cancellationRate > 20 ? colors.red : stats.cancellationRate >= 10 ? colors.amber : colors.green);
    drawCard(margin + cardWidth + cardGap, cursorY, cardWidth, 26, 'PAX totales', stats.totalPax, colors.blue);
    drawCard(margin + (cardWidth + cardGap) * 2, cursorY, cardWidth, 26, 'PAX media', stats.averagePax.toFixed(1), colors.blue);
    cursorY += 35;

    ensureSection(64);
    sectionTitle('Impacto economico estimado');
    setFill([246, 249, 255]);
    setDraw([204, 216, 239]);
    doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 36, 3, 3, 'FD');
    drawCard(margin + 5, cursorY + 6, 41, 22, 'Ticket medio', formatMoney(averageTicket), colors.blue);
    drawCard(margin + 50, cursorY + 6, 45, 22, 'Ingresos', formatMoney(estimatedRevenue), colors.green);
    drawCard(margin + 99, cursorY + 6, 45, 22, 'Via BOT', formatMoney(estimatedBotRevenue), colors.blue);
    drawCard(margin + 148, cursorY + 6, 30, 22, 'Peso BOT', `${botRevenueWeight}%`, colors.blue);
    cursorY += 43;
    drawBar('BOT vs total', `${botRevenueWeight}%`, botRevenueWeight, colors.blue);
    cursorY += 4;

    ensureSection(38);
    sectionTitle('Origen de reservas');
    originChart.forEach((origin) => {
      const color = origin.label === 'BOT' ? colors.blue : origin.label === 'MANUAL' ? colors.amber : colors.green;
      drawBar(origin.label, `${origin.value} · ${origin.percent}%`, origin.percent, color);
    });
    cursorY += 4;

    nextPage();

    ensureSection(80);
    sectionTitle('Valoracion de clientes');
    const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => {
      const count = validFeedbacks.filter((feedback) => feedback.rating === rating).length;
      return { rating, count, percent: percentage(count, validFeedbacks.length) };
    });
    drawCard(margin, cursorY, cardWidth, 24, 'Feedbacks recibidos', feedbacks.length, colors.blue);
    drawCard(margin + cardWidth + cardGap, cursorY, cardWidth, 24, 'Valoracion media', averageRating > 0 ? `${averageRating.toFixed(1)} / 5` : 'Sin datos', colors.amber);
    cursorY += 31;
    ratingDistribution.forEach((item) => {
      drawBar(`${item.rating} estrellas`, `${item.count}`, item.percent, item.rating <= 2 ? colors.red : colors.amber);
    });
    cursorY += 4;

    ensureSection(negativeFeedbacks.length === 0 ? 22 : 12 + negativeFeedbacks.length * 24);
    sectionTitle('Alertas de clientes');
    if (negativeFeedbacks.length === 0) {
      setText(colors.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('No hay comentarios negativos', margin, cursorY);
      cursorY += 7;
    } else {
      negativeFeedbacks.forEach((feedback) => {
        ensureSpace(24);
        setFill(colors.redSoft);
        setDraw([246, 199, 199]);
        doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 20, 2, 2, 'FD');
        setText(colors.red);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(`${feedback.date || '-'} · ${feedback.client || 'Cliente'} · ${feedback.rating}/5`, margin + 4, cursorY + 6);
        setText(colors.ink);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.8);
        const lines = doc.splitTextToSize(`"${feedback.comment || '-'}"`, pageWidth - margin * 2 - 8);
        doc.text(lines.slice(0, 2), margin + 4, cursorY + 13);
        cursorY += 24;
      });
    }

    addFooter();
    const safeRestaurantName = (restaurantName || 'Safari').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
    doc.save(`${safeRestaurantName}_Informe_${getLocalDateString(new Date())}.pdf`);
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
        <button className="secondary-button" type="button" onClick={() => void exportExecutivePdf()}>
          Exportar PDF
        </button>
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
