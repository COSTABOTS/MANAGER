import { useMemo, useState } from 'react';
import type { Feedback } from '../services/feedbacks';

interface FeedbacksProps {
  feedbacks: Feedback[];
  message: string;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}

export function Feedbacks({ feedbacks, message, isLoading, onRefresh }: FeedbacksProps) {
  const [scoreFilter, setScoreFilter] = useState('all');
  const [query, setQuery] = useState('');

  const validFeedbacks = useMemo(() => feedbacks.filter((feedback) => feedback.rating > 0), [feedbacks]);
  const average = useMemo(() => {
    if (validFeedbacks.length === 0) {
      return 0;
    }

    return validFeedbacks.reduce((total, feedback) => total + feedback.rating, 0) / validFeedbacks.length;
  }, [validFeedbacks]);

  const positiveCount = validFeedbacks.filter((feedback) => feedback.rating >= 4).length;
  const neutralCount = validFeedbacks.filter((feedback) => feedback.rating === 3).length;
  const negativeCount = validFeedbacks.filter((feedback) => feedback.rating <= 2).length;
  const alertFeedbacks = feedbacks
    .filter((feedback) => feedback.rating > 0 && feedback.rating <= 2)
    .slice()
    .sort((a, b) => (b.timestamp || b.date).localeCompare(a.timestamp || a.date));

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

      <section className="feedback-kpi-grid">
        <article className="feedback-kpi is-positive">
          <p className="eyebrow">Positive</p>
          <strong>Positivos: {positiveCount}</strong>
        </article>
        <article className="feedback-kpi is-neutral">
          <p className="eyebrow">Neutral</p>
          <strong>Neutros: {neutralCount}</strong>
        </article>
        <article className="feedback-kpi is-negative">
          <p className="eyebrow">Negative</p>
          <strong>Negativos: {negativeCount}</strong>
        </article>
      </section>

      <section className="feedback-alerts-card">
        <div className="section-title compact">
          <div>
            <p className="eyebrow">Alertas</p>
            <h2>Comentarios que requieren atencion</h2>
          </div>
        </div>
        {alertFeedbacks.length === 0 ? (
          <p className="empty-state">Sin incidencias recientes</p>
        ) : (
          <div className="feedback-alert-list">
            {alertFeedbacks.map((feedback) => (
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
        <div className="logo-mark" aria-hidden="true">
          S
        </div>
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

