import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { jsPDF } from 'jspdf';
import type { Reservation } from '../types';
import type { Feedback } from '../services/feedbacks';
import { getLocalDateString, normalizeDateForCompare } from '../utils/date';
import { isActiveReservation, isCanceledReservation } from '../utils/reservationStatus';

type ReportPeriod = '7d' | '30d' | 'month';
type OriginKey = 'bot' | 'manual' | 'walkin';

interface ReportsProps {
  reservations: Reservation[];
  feedbacks: Feedback[];
  restaurantLogoUrl: string;
  restaurantName: string;
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const DEFAULT_AVERAGE_TICKET = 35;
const TICKET_STORAGE_KEY = 'costabots_average_ticket';
const REPORT_COLORS = {
  blue: '#355f9d',
  blueSoft: '#78a6e8',
  green: '#1f9d62',
  red: '#d6453d',
  amber: '#d8a511',
  turquoise: '#22a6b3',
  slate: '#667085',
  breakfast: '#f4b6aa',
  lunch: '#f0d789',
  dinner: '#355f9d',
  balinese: '#22a6b3',
  unknown: '#98a2b3',
};

const SERVICE_LABELS: Record<string, string> = {
  DESAYUNO: 'Desayuno',
  ALMUERZO: 'Almuerzo',
  CENA: 'Cena',
  BALINESA: 'Balinesas',
  UNCLASSIFIED: 'Sin clasificar',
};

const SERVICE_COLORS: Record<string, string> = {
  DESAYUNO: REPORT_COLORS.breakfast,
  ALMUERZO: REPORT_COLORS.lunch,
  CENA: REPORT_COLORS.dinner,
  BALINESA: REPORT_COLORS.balinese,
  UNCLASSIFIED: REPORT_COLORS.unknown,
};

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percentage(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

const percent = percentage;

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(safeNumber(value));
}

function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(safeNumber(minutes)));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;

  if (hours > 0 && rest > 0) {
    return `${hours} h ${rest} min`;
  }

  if (hours > 0) {
    return `${hours} h`;
  }

  return `${rest} min`;
}

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatDisplayDate(value: string) {
  const normalized = normalizeDateForCompare(value);
  if (!normalized) {
    return value || '-';
  }

  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
}

function parseComparableDate(value: string) {
  const normalized = normalizeDateForCompare(value);
  return normalized || '0000-00-00';
}

function getPeriodRange(period: ReportPeriod) {
  const today = getLocalDateString(new Date());
  const endDate = new Date(`${today}T12:00:00`);
  const startDate = new Date(endDate);

  if (period === '7d') {
    startDate.setDate(endDate.getDate() - 6);
  } else if (period === '30d') {
    startDate.setDate(endDate.getDate() - 29);
  } else {
    startDate.setDate(1);
  }

  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
  const previousEnd = new Date(startDate);
  previousEnd.setDate(startDate.getDate() - 1);
  const previousStart = new Date(previousEnd);

  if (period === 'month') {
    previousStart.setDate(1);
  } else {
    previousStart.setDate(previousEnd.getDate() - days + 1);
  }

  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
    previousStart: previousStart.toISOString().slice(0, 10),
    previousEnd: previousEnd.toISOString().slice(0, 10),
  };
}

function getOriginKey(source: unknown): OriginKey {
  const value = normalizeText(source);

  if (value.includes('walk')) {
    return 'walkin';
  }

  if (value.includes('manual')) {
    return 'manual';
  }

  return 'bot';
}

function getLanguageKey(language: unknown) {
  const value = normalizeText(language);

  if (value.startsWith('en') || value.includes('ingles') || value.includes('english')) {
    return 'english';
  }

  if (value.startsWith('es') || value.includes('spanish') || value.includes('espanol')) {
    return 'spanish';
  }

  return 'unknown';
}

function detectService(reservation: Reservation) {
  const directService = normalizeText(reservation.service);

  if (directService.includes('desayuno') || directService.includes('breakfast')) {
    return 'DESAYUNO';
  }

  if (directService.includes('almuerzo') || directService.includes('comida') || directService.includes('lunch')) {
    return 'ALMUERZO';
  }

  if (directService.includes('balinesa') || directService.includes('balinese') || directService.includes('bali')) {
    return 'BALINESA';
  }

  if (directService.includes('cena') || directService.includes('dinner')) {
    return 'CENA';
  }

  const searchable = normalizeText([
    reservation.specialRequest,
    reservation.source,
    reservation.balinesePackage,
    reservation.resource,
  ].join(' '));

  if (searchable.includes('balinesa') || searchable.includes('balinese') || searchable.includes('bali bed') || searchable.includes('day bed') || searchable.includes('hamaca')) {
    return 'BALINESA';
  }

  if (searchable.includes('desayuno') || searchable.includes('breakfast')) {
    return 'DESAYUNO';
  }

  if (searchable.includes('almuerzo') || searchable.includes('comida') || searchable.includes('lunch')) {
    return 'ALMUERZO';
  }

  if (searchable.includes('cena') || searchable.includes('dinner')) {
    return 'CENA';
  }

  return 'CENA';
}

function getBalineseResource(reservation: Reservation) {
  const value = String(reservation.resource || reservation.table || reservation.specialRequest || '').toUpperCase();
  const direct = value.match(/\bB(?:ALINESA)?[_\s-]?([12])\b/);

  if (direct) {
    return `B${direct[1]}`;
  }

  return value.includes('BALINESA 1') ? 'B1' : value.includes('BALINESA 2') ? 'B2' : '-';
}

function getServiceStats(reservations: Reservation[], averageTicket: number) {
  const rows = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA', 'UNCLASSIFIED'].map((key) => ({
    key,
    label: SERVICE_LABELS[key],
    reservations: 0,
    pax: 0,
    revenue: 0,
    color: SERVICE_COLORS[key],
  }));
  const rowMap = new Map(rows.map((row) => [row.key, row]));
  const balineseResources: Record<string, number> = {};

  reservations.forEach((reservation) => {
    const service = detectService(reservation);
    const row = rowMap.get(service) ?? rowMap.get('UNCLASSIFIED');

    if (!row) {
      return;
    }

    row.reservations += 1;
    row.pax += safeNumber(reservation.pax);
    row.revenue += safeNumber(reservation.pax) * averageTicket;

    if (service === 'BALINESA') {
      const resource = getBalineseResource(reservation);
      if (resource !== '-') {
        balineseResources[resource] = (balineseResources[resource] ?? 0) + 1;
      }
    }
  });

  const visibleRows = rows.filter((row) => row.reservations > 0 || row.key !== 'UNCLASSIFIED');
  const totalReservations = visibleRows.reduce((total, row) => total + row.reservations, 0);
  const totalPax = visibleRows.reduce((total, row) => total + row.pax, 0);
  const totalRevenue = visibleRows.reduce((total, row) => total + row.revenue, 0);
  const dominantByReservations = [...visibleRows].sort((a, b) => b.reservations - a.reservations)[0];
  const dominantByPax = [...visibleRows].sort((a, b) => b.pax - a.pax)[0];
  const balinese = rowMap.get('BALINESA') ?? rows[3];
  const mostUsedBalinese = Object.entries(balineseResources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';

  return {
    rows: visibleRows,
    totalReservations,
    totalPax,
    totalRevenue,
    dominantByReservations,
    dominantByPax,
    balinese,
    mostUsedBalinese,
  };
}

function buildDailyChartData(reservations: Reservation[], range: { start: string; end: string }, mode: 'reservations' | 'pax') {
  const days: string[] = [];
  const cursor = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.end}T12:00:00`);

  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days.map((date) => {
    const dayReservations = reservations.filter((reservation) => parseComparableDate(reservation.date) === date);
    const [, month, day] = date.split('-');
    return {
      label: `${day}/${month}`,
      value: mode === 'pax' ? dayReservations.reduce((total, reservation) => total + safeNumber(reservation.pax), 0) : dayReservations.length,
    };
  });
}

function buildHourChartData(reservations: Reservation[]) {
  const counts = reservations.reduce<Record<string, number>>((items, reservation) => {
    if (reservation.time) {
      items[reservation.time] = (items[reservation.time] ?? 0) + 1;
    }

    return items;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));
}

function getTopEntry(items: Record<string, number>) {
  return Object.entries(items).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
}

function buildReportStats(reservations: Reservation[], range: { start: string; end: string }) {
  const periodReservations = reservations.filter((reservation) => {
    const date = parseComparableDate(reservation.date);
    return date >= range.start && date <= range.end;
  });
  const activeReservations = periodReservations.filter(isActiveReservation);
  const canceledReservations = periodReservations.filter(isCanceledReservation);
  const botReservations = activeReservations.filter((reservation) => getOriginKey(reservation.source) === 'bot');
  const botPax = botReservations.reduce((total, reservation) => total + safeNumber(reservation.pax), 0);
  const totalPax = activeReservations.reduce((total, reservation) => total + safeNumber(reservation.pax), 0);
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
    manualReservations: activeReservations.filter((reservation) => getOriginKey(reservation.source) === 'manual').length,
    walkInReservations: activeReservations.filter((reservation) => getOriginKey(reservation.source) === 'walkin').length,
    arrivedReservations: activeReservations.filter((reservation) => reservation.arrived).length,
    assignedTables: activeReservations.filter((reservation) => String(reservation.table ?? '').trim()).length,
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
    topDay: getTopEntry(
      activeReservations.reduce<Record<string, number>>((items, reservation) => {
        const date = parseComparableDate(reservation.date);
        if (date) {
          items[formatDisplayDate(date)] = (items[formatDisplayDate(date)] ?? 0) + 1;
        }
        return items;
      }, {}),
    ),
  };
}

function getDeltaPercent(current: number, previous: number) {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }

  return Math.round(((current - previous) / previous) * 100);
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
  const serviceStats = useMemo(() => getServiceStats(stats.activeReservations, averageTicket), [averageTicket, stats.activeReservations]);
  const estimatedRevenue = stats.totalPax * averageTicket;
  const estimatedBotRevenue = stats.botPax * averageTicket;
  const botRevenueWeight = percentage(estimatedBotRevenue, estimatedRevenue);
  const dailyReservations = buildDailyChartData(stats.activeReservations, range, 'reservations');
  const dailyPax = buildDailyChartData(stats.activeReservations, range, 'pax');
  const hourChart = buildHourChartData(stats.activeReservations);
  const originTotal = stats.confirmedReservations;
  const languageTotal = stats.languageCounts.spanish + stats.languageCounts.english;
  void feedbacks;
  const servicePaxTotal = serviceStats.totalPax > 0 ? serviceStats.totalPax : serviceStats.totalReservations;
  const servicePaxDonut = serviceStats.rows.map((service) => ({
    label: service.label,
    value: serviceStats.totalPax > 0 ? service.pax : service.reservations,
    color: service.color,
  }));
  const servicePaxLegend = serviceStats.rows.map((service) => ({
    label: service.label,
    value: service.pax,
    color: service.color,
  }));
  const dominantServicePaxPercent = percentage(
    serviceStats.totalPax > 0 ? serviceStats.dominantByPax?.pax ?? 0 : serviceStats.dominantByPax?.reservations ?? 0,
    servicePaxTotal,
  );
  const originDonut = [
    { label: 'BOT', value: stats.originCounts.bot, color: REPORT_COLORS.blue },
    { label: 'MANUAL', value: stats.originCounts.manual, color: REPORT_COLORS.amber },
    { label: 'WALK-IN', value: stats.originCounts.walkin, color: REPORT_COLORS.green },
  ];
  const languageDonut = [
    { label: 'Español', value: stats.languageCounts.spanish, color: REPORT_COLORS.blue },
    { label: 'Inglés', value: stats.languageCounts.english, color: REPORT_COLORS.turquoise },
  ];
  const statusDonut = [
    { label: 'Confirmadas', value: stats.confirmedReservations, color: REPORT_COLORS.green },
    { label: 'Canceladas', value: stats.canceledCount, color: REPORT_COLORS.red },
  ];
  const botRevenueDonut = [
    { label: 'BOT', value: estimatedBotRevenue, color: REPORT_COLORS.blue },
    { label: 'Resto', value: Math.max(0, estimatedRevenue - estimatedBotRevenue), color: '#d7e1f0' },
  ];

  function handleAverageTicketChange(value: string) {
    const nextValue = Number(value);

    if (Number.isFinite(nextValue) && nextValue >= 0) {
      setAverageTicket(nextValue);
      localStorage.setItem(TICKET_STORAGE_KEY, String(nextValue));
    }
  }

  async function exportPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 44;
    const fullWidth = pageWidth - margin * 2;
    const gap = 16;
    const periodRangeLabel = `${formatDisplayDate(range.start)} - ${formatDisplayDate(range.end)}`;
    const periodLabel = period === '7d' ? 'Ultimos 7 dias' : period === '30d' ? 'Ultimos 30 dias' : 'Este mes';
    const kpiWidth = (fullWidth - gap * 3) / 4;
    const halfWidth = (fullWidth - gap) / 2;
    const thirdWidth = (fullWidth - gap * 2) / 3;

    function rgb(hex: string) {
      const value = hex.replace('#', '');
      return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
      ] as [number, number, number];
    }

    function fill(hex: string) {
      const [red, green, blue] = rgb(hex);
      doc.setFillColor(red, green, blue);
    }

    function stroke(hex: string) {
      const [red, green, blue] = rgb(hex);
      doc.setDrawColor(red, green, blue);
    }

    function textColor(hex: string) {
      const [red, green, blue] = rgb(hex);
      doc.setTextColor(red, green, blue);
    }

    async function loadLogoDataUrl(url: string) {
      if (!url.trim()) {
        return '';
      }

      try {
        const response = await fetch(url);
        if (!response.ok) {
          return '';
        }

        const blob = await response.blob();
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(blob);
        });
      } catch {
        return '';
      }
    }

    function drawCard(x: number, y: number, width: number, height: number, radius = 16) {
      stroke('#e5eaf2');
      fill('#ffffff');
      doc.roundedRect(x, y, width, height, radius, radius, 'FD');
    }

    function sectionTitle(title: string, x: number, y: number) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      textColor('#667085');
      doc.text(title.toUpperCase(), x, y);
      textColor('#172033');
    }

    const logoDataUrl = await loadLogoDataUrl(restaurantLogoUrl);

    function drawLogo(x: number, y: number, size: number) {
      fill('#ffffff');
      stroke('#e5eaf2');
      doc.roundedRect(x, y, size, size, 14, 14, 'FD');
      if (logoDataUrl) {
        doc.addImage(logoDataUrl, x + 7, y + 7, size - 14, size - 14);
        return;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      textColor(REPORT_COLORS.blue);
      doc.text((restaurantName || 'R').slice(0, 1).toUpperCase(), x + size / 2, y + size / 2 + 8, { align: 'center' });
      textColor('#172033');
    }

    function executiveKpi(x: number, y: number, label: string, value: string | number, accent: string) {
      drawCard(x, y, kpiWidth, 96, 18);
      fill(accent);
      doc.roundedRect(x + 14, y + 14, 26, 5, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      textColor('#667085');
      doc.text(label.toUpperCase(), x + 14, y + 36, { maxWidth: kpiWidth - 28 });
      doc.setFontSize(25);
      textColor('#172033');
      doc.text(String(value), x + 14, y + 70, { maxWidth: kpiWidth - 28 });
    }

    function miniMetric(x: number, y: number, width: number, label: string, value: string | number) {
      fill('#f8fbff');
      stroke('#edf1f7');
      doc.roundedRect(x, y, width, 52, 12, 12, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      textColor('#667085');
      doc.text(label.toUpperCase(), x + 12, y + 18, { maxWidth: width - 24 });
      doc.setFontSize(14);
      textColor('#172033');
      doc.text(String(value), x + 12, y + 38, { maxWidth: width - 24 });
    }

    function drawDonut(segments: DonutSegment[], x: number, y: number, radius: number, centerText: string, centerSubtext?: string) {
      const total = segments.reduce((sum, segment) => sum + safeNumber(segment.value), 0);
      let startAngle = -90;

      if (total <= 0) {
        fill('#edf2f7');
        doc.circle(x, y, radius, 'F');
      } else {
        segments.forEach((segment) => {
          const value = safeNumber(segment.value);
          if (value <= 0) {
            return;
          }

          const angle = (value / total) * 360;
          const points: Array<[number, number]> = [[x, y]];
          const steps = Math.max(6, Math.ceil(angle / 7));

          for (let index = 0; index <= steps; index += 1) {
            const pointAngle = ((startAngle + (angle * index) / steps) * Math.PI) / 180;
            points.push([x + Math.cos(pointAngle) * radius, y + Math.sin(pointAngle) * radius]);
          }

          fill(segment.color);
          for (let index = 1; index < points.length - 1; index += 1) {
            doc.triangle(x, y, points[index][0], points[index][1], points[index + 1][0], points[index + 1][1], 'F');
          }
          startAngle += angle;
        });
      }

      fill('#ffffff');
      doc.circle(x, y, radius * 0.58, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(radius > 50 ? 14 : 12);
      textColor('#172033');
      doc.text(centerText, x, y - 1, { align: 'center', maxWidth: radius * 1.35 });
      if (centerSubtext) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        textColor('#667085');
        doc.text(centerSubtext, x, y + 14, { align: 'center' });
      }
      textColor('#172033');
    }

    function legend(items: Array<{ label: string; value: string | number; color: string }>, x: number, y: number, width: number, rowHeight = 17) {
      doc.setFontSize(8.5);
      items.forEach((item, index) => {
        const rowY = y + index * rowHeight;
        fill(item.color);
        doc.circle(x + 4, rowY - 3, 4, 'F');
        doc.setFont('helvetica', 'bold');
        textColor('#172033');
        doc.text(item.label, x + 14, rowY, { maxWidth: width * 0.58 });
        doc.setFont('helvetica', 'normal');
        textColor('#667085');
        doc.text(String(item.value), x + width, rowY, { align: 'right' });
      });
      textColor('#172033');
    }

    function barChart(data: Array<{ label: string; value: number }>, x: number, y: number, width: number, height: number, color = REPORT_COLORS.blue) {
      const max = Math.max(1, ...data.map((item) => item.value));
      const barGap = 6;
      const barWidth = Math.max(7, (width - barGap * Math.max(0, data.length - 1)) / Math.max(1, data.length));

      data.forEach((item, index) => {
        const barHeight = Math.max(4, (safeNumber(item.value) / max) * height);
        const barX = x + index * (barWidth + barGap);
        const barY = y + height - barHeight;
        fill('#edf2f7');
        doc.roundedRect(barX, y, barWidth, height, 4, 4, 'F');
        fill(color);
        doc.roundedRect(barX, barY, barWidth, barHeight, 4, 4, 'F');
        if (data.length <= 10) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          textColor('#98a2b3');
          doc.text(item.label, barX + barWidth / 2, y + height + 12, { align: 'center', maxWidth: barWidth + 8 });
        }
      });
      textColor('#172033');
    }

    function footer(page: number) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      textColor('#98a2b3');
      doc.text('COSTABOTS Manager', margin, pageHeight - 26);
      doc.text(periodRangeLabel, pageWidth / 2, pageHeight - 26, { align: 'center' });
      doc.text(`${page}/2`, pageWidth - margin, pageHeight - 26, { align: 'right' });
      textColor('#172033');
    }

    const generatedAt = new Date().toLocaleString('es-ES');
    const botSentence = `El BOT gestiono el ${botRevenueWeight}% del impacto estimado y genero ${formatMoney(estimatedBotRevenue)}.`;
    const executiveMessage = `Durante este periodo el restaurante recibio ${stats.totalReservations} reservas para un total de ${stats.totalPax} clientes. El servicio mas demandado fue ${serviceStats.dominantByReservations?.label ?? 'sin datos'}. ${botSentence}`;
    fill('#f7f9fc');
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    drawLogo(margin, 38, 58);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    textColor('#667085');
    doc.text((restaurantName || 'Restaurante').toUpperCase(), margin + 76, 58);
    doc.setFontSize(30);
    textColor('#172033');
    doc.text('INFORME EJECUTIVO', margin + 76, 88);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    textColor('#667085');
    doc.text(periodRangeLabel, margin + 76, 108);
    doc.text(`Generado: ${generatedAt}`, pageWidth - margin, 34, { align: 'right' });
    doc.text('Generado por COSTABOTS', pageWidth - margin, 50, { align: 'right' });

    let y = 148;
    sectionTitle('Resumen ejecutivo', margin, y);
    y += 18;
    executiveKpi(margin, y, 'Reservas', stats.totalReservations, REPORT_COLORS.blue);
    executiveKpi(margin + (kpiWidth + gap), y, 'PAX', stats.totalPax, REPORT_COLORS.green);
    executiveKpi(margin + (kpiWidth + gap) * 2, y, 'Ingresos estimados', formatMoney(estimatedRevenue), REPORT_COLORS.amber);
    executiveKpi(margin + (kpiWidth + gap) * 3, y, 'Peso del BOT', `${botRevenueWeight}%`, REPORT_COLORS.blue);

    y += 126;
    drawCard(margin, y, fullWidth, 92, 18);
    sectionTitle('Resumen del negocio', margin + 18, y + 24);
    const businessWidth = (fullWidth - 68) / 4;
    miniMetric(margin + 18, y + 38, businessWidth, 'Servicio lider', serviceStats.dominantByReservations?.label ?? '-');
    miniMetric(margin + 30 + businessWidth, y + 38, businessWidth, 'Hora fuerte', stats.topTime);
    miniMetric(margin + 42 + businessWidth * 2, y + 38, businessWidth, 'Dia fuerte', stats.topDay);
    miniMetric(margin + 54 + businessWidth * 3, y + 38, businessWidth, 'Ticket medio', formatMoney(averageTicket));

    y += 126;
    sectionTitle('Evolucion', margin, y);
    y += 18;
    drawCard(margin, y, halfWidth, 150, 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    textColor('#172033');
    doc.text('Reservas por dia', margin + 18, y + 28);
    barChart(dailyReservations, margin + 20, y + 58, halfWidth - 40, 62, REPORT_COLORS.blue);

    drawCard(margin + halfWidth + gap, y, halfWidth, 150, 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('PAX por dia', margin + halfWidth + gap + 18, y + 28);
    barChart(dailyPax, margin + halfWidth + gap + 20, y + 58, halfWidth - 40, 62, REPORT_COLORS.green);

    y += 182;
    drawCard(margin, y, fullWidth, 94, 18);
    sectionTitle('Mensaje automatico', margin + 18, y + 24);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    textColor('#344054');
    doc.text(executiveMessage, margin + 18, y + 50, { maxWidth: fullWidth - 36, lineHeightFactor: 1.35 });
    footer(1);

    doc.addPage();
    fill('#f7f9fc');
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    y = 44;
    sectionTitle('Servicios', margin, y);
    y += 18;
    drawCard(margin, y, fullWidth, 198, 20);
    drawDonut(servicePaxDonut, margin + 118, y + 108, 74, serviceStats.dominantByPax?.label ?? 'Sin datos', 'PAX');
    legend(
      serviceStats.rows.map((service) => ({
        label: service.label,
        value: `${service.pax} pax · ${formatMoney(service.revenue)}`,
        color: service.color,
      })),
      margin + 230,
      y + 74,
      250,
      22,
    );

    y += 230;
    drawCard(margin, y, halfWidth, 150, 18);
    sectionTitle('BOT', margin + 18, y + 24);
    drawDonut(botRevenueDonut, margin + 78, y + 88, 44, `${botRevenueWeight}%`, 'Peso BOT');
    miniMetric(margin + 140, y + 42, 92, 'Reservas BOT', stats.botReservations);
    miniMetric(margin + 242, y + 42, 110, 'Ingresos BOT', formatMoney(estimatedBotRevenue));
    miniMetric(margin + 140, y + 96, 92, 'Tiempo', formatDuration(stats.botReservations * 3));
    legend(originDonut.map((item) => ({ label: item.label, value: item.value, color: item.color })), margin + 242, y + 108, 110, 14);

    drawCard(margin + halfWidth + gap, y, halfWidth, 150, 18);
    sectionTitle('Operativa', margin + halfWidth + gap + 18, y + 24);
    const opX = margin + halfWidth + gap + 18;
    const opWidth = (halfWidth - 48) / 3;
    miniMetric(opX, y + 42, opWidth, 'Walk-ins', stats.walkInReservations);
    miniMetric(opX + opWidth + 6, y + 42, opWidth, 'Manual', stats.manualReservations);
    miniMetric(opX + (opWidth + 6) * 2, y + 42, opWidth, 'Llegadas', stats.arrivedReservations);
    miniMetric(opX, y + 96, opWidth, 'Cancel.', stats.canceledCount);
    miniMetric(opX + opWidth + 6, y + 96, opWidth, 'Mesas', stats.assignedTables);
    miniMetric(opX + (opWidth + 6) * 2, y + 96, opWidth, 'Full', '-');

    y += 182;
    if (languageTotal > 0) {
      drawCard(margin, y, halfWidth, 132, 18);
      sectionTitle('Idiomas', margin + 18, y + 24);
      drawDonut(languageDonut, margin + 78, y + 78, 40, `${languageTotal}`, 'Total');
      legend(languageDonut.map((item) => ({ label: item.label, value: item.value, color: item.color })), margin + 140, y + 72, 130);
    }
    footer(2);

    doc.save(`${(restaurantName || 'Restaurante').replace(/\s+/g, '_')}_Informe_${getLocalDateString(new Date())}.pdf`);
  }

  return (
    <main className="app-shell">
      <section className="reports-toolbar">
        <div>
          <p className="eyebrow">Analitica ejecutiva</p>
          <h1>INFORMES</h1>
        </div>
        <div className="report-range">
          <strong>Periodo</strong>
          <select value={period} onChange={(event) => setPeriod(event.target.value as ReportPeriod)}>
            <option value="7d">Ultimos 7 dias</option>
            <option value="30d">Ultimos 30 dias</option>
            <option value="month">Este mes</option>
          </select>
          <button type="button" onClick={exportPdf}>Exportar PDF</button>
        </div>
      </section>

      <section className="reports-kpi-strip">
        <KpiCard label="Reservas" value={stats.totalReservations} delta={getDeltaPercent(stats.totalReservations, previousStats.totalReservations)} accent="accent-blue" />
        <KpiCard label="PAX / Clientes" value={stats.totalPax} delta={getDeltaPercent(stats.totalPax, previousStats.totalPax)} accent="accent-green" />
        <KpiCard label="Ingresos estimados" value={formatMoney(estimatedRevenue)} accent="accent-amber" />
        <KpiCard label="Peso del BOT" value={`${botRevenueWeight}%`} detail={formatMoney(estimatedBotRevenue)} accent="accent-blue" />
      </section>

      <section className="reports-grid">
        <ReportCard title="Reservas">
          <div className="report-card-split">
            <DonutChart centerText={`${stats.cancellationRate}%`} centerSubtext="Cancelacion" segments={statusDonut} />
            <LegendList data={statusDonut.map((item) => ({ ...item, percent: percentage(item.value, stats.totalReservations) }))} />
          </div>
          <VerticalBars data={dailyReservations} compact />
        </ReportCard>

        <ReportCard title="PAX / Clientes">
          <Metric label="PAX media por reserva" value={stats.averagePax.toFixed(1)} compact />
          <VerticalBars data={dailyPax} compact />
        </ReportCard>
      </section>

      <section className="reports-focus-grid">
        <ReportCard title="Servicios">
          <div className="services-dashboard-layout">
            <div className="services-donut-panel">
              <DonutChart
                centerText={`${dominantServicePaxPercent}%`}
                centerSubtext="PAX"
                segments={servicePaxDonut}
              />
              <ServiceLegendList data={servicePaxLegend} mode="pax" />
            </div>
            <div className="services-summary-layout">
              <div className="services-mini-kpis">
                <StatCard label="Servicio lider" value={serviceStats.dominantByReservations?.label ?? '-'} />
                <StatCard label="Ingresos servicios" value={formatMoney(serviceStats.totalRevenue)} />
                <StatCard label="Balinesas" value={serviceStats.balinese.reservations} />
                <StatCard label="Ticket medio" value={formatMoney(averageTicket)} />
              </div>
              {serviceStats.balinese.reservations > 0 && (
                <div className="balinese-service-strip">
                  <strong>Balinesas</strong>
                  <span>
                    {serviceStats.balinese.reservations} reservas · {serviceStats.balinese.pax} pax · {formatMoney(serviceStats.balinese.revenue)} · mas usada {serviceStats.mostUsedBalinese}
                  </span>
                </div>
              )}
            </div>
          </div>
        </ReportCard>

        <ReportCard title="BOT">
          <div className="bot-dashboard-layout">
            <DonutChart centerText={`${botRevenueWeight}%`} centerSubtext="BOT" segments={botRevenueDonut} />
            <div className="bot-compact-grid">
              <StatCard label="Reservas BOT" value={stats.botReservations} />
              <StatCard label="Ingresos BOT" value={formatMoney(estimatedBotRevenue)} />
              <StatCard label="Tiempo" value={formatDuration(stats.botReservations * 3)} />
            </div>
            <LegendList data={originDonut.map((item) => ({ ...item, percent: percentage(item.value, originTotal) }))} />
          </div>
        </ReportCard>
      </section>

      <section className="reports-final-grid">
        <ReportCard title="Actividad">
          <div className="report-inline-metrics">
            <Metric label="Hora mas demandada" value={stats.topTime} compact />
            <Metric label="Dia mas demandado" value={stats.topDay} compact />
          </div>
          <HorizontalBars data={hourChart} />
        </ReportCard>

        <ReportCard title="Operativa">
          <div className="operation-grid">
            <StatCard label="Reservas manuales" value={stats.manualReservations} />
            <StatCard label="Walk-ins" value={stats.walkInReservations} />
            <StatCard label="Llegadas registradas" value={stats.arrivedReservations} />
            <StatCard label="Mesas asignadas" value={stats.assignedTables} />
            <StatCard label="Cancelaciones" value={stats.canceledCount} tone="is-danger" />
            <StatCard label="Fully booked activados" value="-" />
          </div>
        </ReportCard>

        <ReportCard title="Idiomas">
          <div className="report-card-split">
            <DonutChart centerText={`${languageTotal}`} centerSubtext="Feedback" segments={languageDonut} />
            <LegendList data={languageDonut.map((item) => ({ ...item, percent: percentage(item.value, languageTotal) }))} />
          </div>
        </ReportCard>
      </section>
    </main>
  );
}

function ReportCard({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <article className={`report-card ${wide ? 'is-wide' : ''}`}>
      <p className="eyebrow">{title}</p>
      {children}
    </article>
  );
}

function KpiCard({ label, value, detail, delta, accent }: { label: string; value: string | number; detail?: string; delta?: number; accent?: string }) {
  return (
    <article className={`report-kpi-card ${accent ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof delta === 'number' ? <small className={`report-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>{delta >= 0 ? '+' : ''}{delta}% vs periodo anterior</small> : null}
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function Metric({ label, value, detail, delta, tone, compact = false, featured = false }: {
  label: string;
  value: string | number;
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
      {typeof delta === 'number' ? <small className={`report-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>{delta >= 0 ? '+' : ''}{delta}%</small> : null}
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`report-stat-card ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DonutChart({
  segments,
  centerText,
  centerSubtext,
  mini = false,
}: {
  segments: DonutSegment[];
  centerText: string;
  centerSubtext?: string;
  mini?: boolean;
}) {
  const total = segments.reduce((sum, item) => sum + safeNumber(item.value), 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={`donut-chart ${mini ? 'is-mini' : ''}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="donut-ring" cx="60" cy="60" r={radius} />
        {total <= 0 ? (
          <circle className="donut-empty" cx="60" cy="60" r={radius} />
        ) : (
          segments.map((segment) => {
            const length = (safeNumber(segment.value) / total) * circumference;
            const dash = `${length} ${circumference - length}`;
            const circle = (
              <circle
                className="donut-segment"
                cx="60"
                cy="60"
                key={segment.label}
                r={radius}
                stroke={segment.color}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return circle;
          })
        )}
      </svg>
      <div className="donut-center">
        <strong>{centerText}</strong>
        {centerSubtext ? <span>{centerSubtext}</span> : null}
      </div>
    </div>
  );
}

function LegendList({ data }: { data: Array<{ label: string; value: number; percent: number; color: string }> }) {
  return (
    <div className="donut-legend">
      {data.map((item) => (
        <div className="donut-legend-item" key={item.label}>
          <span style={{ background: item.color }} />
          <strong>{item.label}</strong>
          <small>{item.value} · {item.percent}%</small>
        </div>
      ))}
    </div>
  );
}

function ServiceLegendList({ data, mode = 'reservas' }: { data: Array<{ label: string; value: number; color: string }>; mode?: 'reservas' | 'pax' }) {
  return (
    <div className="donut-legend services-legend">
      {data.map((item) => (
        <div className="donut-legend-item service-legend-item" key={item.label}>
          <span style={{ background: item.color }} />
          <strong>{item.label}</strong>
          <small>{item.value} {mode}</small>
        </div>
      ))}
    </div>
  );
}
function VerticalBars({ data, compact = false }: { data: Array<{ label: string; value: number }>; compact?: boolean }) {
  const max = Math.max(1, ...data.map((item) => item.value));

  return (
    <div className={`vertical-chart ${compact ? 'is-compact' : ''}`}>
      {data.map((item) => (
        <div className="vertical-bar-item" key={item.label}>
          <div className="vertical-bar-track">
            <span style={{ height: `${Math.max(4, (item.value / max) * 100)}%` }} />
          </div>
          <strong>{item.value}</strong>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((item) => item.value));

  return (
    <div className="horizontal-chart">
      {data.length === 0 ? <p className="empty-state">Sin datos suficientes.</p> : null}
      {data.map((item) => (
        <div className="horizontal-bar-item" key={item.label}>
          <div>
            <strong>{item.label}</strong>
            <small>{item.value}</small>
          </div>
          <div className="horizontal-bar-track">
            <span style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
