import { useMemo, useState } from 'react';
import type { Feedback } from '../services/feedbacks';

interface FeedbacksProps {
  feedbacks: Feedback[];
  message: string;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}

function parseFeedbackDate(value: string) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return 0;
  }

  const dayFirstMatch = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dayFirstMatch) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = dayFirstMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
  }

  const parsed = Date.parse(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFeedbackDateTime(feedback: Feedback) {
  return Math.max(parseFeedbackDate(feedback.timestamp), parseFeedbackDate(feedback.date));
}

function getNegativeAlerts(feedbacks: Feedback[]) {
  return feedbacks
    .filter((feedback) => Number(feedback.rating) > 0 && Number(feedback.rating) <= 2)
    .slice()
    .sort((a, b) => getFeedbackDateTime(b) - getFeedbackDateTime(a))
    .slice(0, 5);
}

export function Feedbacks({ feedbacks, message, isLoading, onRefresh }: FeedbacksProps) {
  const [scoreFilter, setScoreFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [showAlerts, setShowAlerts] = useState(false);

  const validFeedbacks = useMemo(() => feedbacks.filter((feedback) => feedback.rating > 0), [feedbacks]);
  const average = useMemo(() => {
    if (validFeedbacks.length === 0) {
      return 0;
    }

    return validFeedbacks.reduce((total, feedback) => total + feedback.rating, 0) / validFeedbacks.length;
  }, [validFeedbacks]);

  const negativeAlerts = useMemo(() => getNegativeAlerts(feedbacks), [feedbacks]);
  const latestAlert = negativeAlerts[0];

  const visibleFeedbacks = feedbacks.filter((feedback) => {
    const matchesScore = scoreFilter === 'all' || feedback.rating === Number(scoreFilter);
    const matchesQuery = `${feedback.client} ${feedback.room} ${feedback.comment}`.toLowerCase().includes(query.toLowerCase());
    return matchesScore && matchesQuery;
  });

  return (
    <main className="app-shell">
      <PageHeader eyebrow="Dashboard visual" title="FEEDBACKS" isLoading={isLoading} onRefresh={onRefresh} />

      {message && <p className="sync-message">{message}</p>}

      <section className="feedback-grid">
        <article className="rating-card">
          <p className="eyebrow">Valoracion media</p>
          <strong>{average.toFixed(1)}</strong>
          <span>{average > 0 ? '⭐'.repeat(Math.round(average)) : '-'}</span>
        </article>

        <article className="distribution-card">
          <p className="eyebrow">Distribucion</p>
          {[5, 4, 3, 2, 1].map((score) => {
            const count = validFeedbacks.filter((feedback) => feedback.rating === score).length;
            const width = validFeedbacks.length > 0 ? (count / validFeedbacks.length) * 100 : 0;
            return (
              <div className="rating-row" key={score}>
                <span>{'⭐'.repeat(score)}</span>
                <div className="rating-bar">
                  <span style={{ width: `${width}%` }} />
                </div>
                <strong>{count}</strong>
              </div>
            );
          })}
        </article>
      </section>

      <section className="feedback-alerts-card">
        {negativeAlerts.length === 0 ? (
          <p className="empty-state">No hay alertas negativas recientes.</p>
        ) : (
          <>
            <div className="feedback-last-alert">
              <strong>⚠ Ultima alerta:</strong>
              <span>
                {latestAlert.date || '-'} · {latestAlert.client || 'Cliente'} · {latestAlert.comment || '-'}
              </span>
              <button className="secondary-button compact-action" type="button" onClick={() => setShowAlerts((current) => !current)}>
                {showAlerts ? 'Ocultar alertas' : 'Ver alertas'}
              </button>
            </div>
            {showAlerts && (
              <div className="feedback-alert-list">
                {negativeAlerts.map((feedback) => (
                  <article className="feedback-alert-item" key={feedback.id}>
                    <span className="alert-dot" aria-hidden="true" />
                    <div>
                      <strong>{feedback.date || '-'}</strong>
                      <span>{feedback.client || 'Cliente'}</span>
                      <p>{feedback.comment || '-'}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="toolbar-card">
        <label>
          Buscador
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, habitacion, comentario..." />
        </label>
        <label>
          Puntuacion
          <select value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value)}>
            <option value="all">Todas</option>
            <option value="5">5 estrellas</option>
            <option value="4">4 estrellas</option>
            <option value="3">3 estrellas</option>
            <option value="2">2 estrellas</option>
            <option value="1">1 estrella</option>
          </select>
        </label>
      </section>

      <section className="table-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Comentarios</p>
            <h2>Listado</h2>
          </div>
        </div>
        {visibleFeedbacks.length === 0 ? (
          <p className="empty-state">No hay feedbacks todavía.</p>
        ) : (
          <div className="table-wrap">
            <table className="reservations-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Habitacion</th>
                  <th>Comentario</th>
                  <th>Puntuacion</th>
                </tr>
              </thead>
              <tbody>
                {visibleFeedbacks.map((feedback) => (
                  <tr key={feedback.id}>
                    <td data-label="Fecha">{feedback.date || '-'}</td>
                    <td data-label="Cliente">{feedback.client || '-'}</td>
                    <td data-label="Habitacion">{feedback.room || '-'}</td>
                    <td data-label="Comentario">{feedback.comment || '-'}</td>
                    <td data-label="Puntuacion">{feedback.rating > 0 ? '⭐'.repeat(feedback.rating) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function PageHeader({
  eyebrow,
  title,
  isLoading,
  onRefresh,
}: {
  eyebrow: string;
  title: string;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="top-bar">
      <div className="brand-lockup">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </div>
      <button className="secondary-button" type="button" disabled={isLoading} onClick={() => void onRefresh()}>
        {isLoading ? 'Actualizando...' : 'Actualizar datos'}
      </button>
    </section>
  );
}

