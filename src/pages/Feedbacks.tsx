import { useMemo, useState } from 'react';

const FEEDBACKS = [
  { id: 'f1', date: '2026-06-01', client: 'Ana', room: '654', comment: 'Cena excelente y servicio muy atento.', score: 5 },
  { id: 'f2', date: '2026-06-02', client: 'William', room: '123', comment: 'Muy buena experiencia, volveremos.', score: 5 },
  { id: 'f3', date: '2026-06-03', client: 'Nico', room: '', comment: 'El show empezo un poco tarde.', score: 4 },
  { id: 'f4', date: '2026-06-04', client: 'Huil', room: '123', comment: 'Buena comida, terraza agradable.', score: 4 },
  { id: 'f5', date: '2026-06-04', client: 'Kj', room: '877', comment: 'Esperamos demasiado por la mesa.', score: 3 },
];

export function Feedbacks() {
  const [scoreFilter, setScoreFilter] = useState('all');
  const [query, setQuery] = useState('');

  const average = useMemo(
    () => FEEDBACKS.reduce((total, feedback) => total + feedback.score, 0) / FEEDBACKS.length,
    [],
  );

  const visibleFeedbacks = FEEDBACKS.filter((feedback) => {
    const matchesScore = scoreFilter === 'all' || feedback.score === Number(scoreFilter);
    const matchesQuery = `${feedback.client} ${feedback.room} ${feedback.comment}`.toLowerCase().includes(query.toLowerCase());
    return matchesScore && matchesQuery;
  });

  return (
    <main className="app-shell">
      <PageHeader eyebrow="Dashboard visual" title="FEEDBACKS" />

      <section className="feedback-grid">
        <article className="rating-card">
          <p className="eyebrow">Valoracion media</p>
          <strong>{average.toFixed(1)}</strong>
          <span>★★★★★</span>
        </article>

        <article className="distribution-card">
          <p className="eyebrow">Distribucion</p>
          {[5, 4, 3, 2, 1].map((score) => {
            const count = FEEDBACKS.filter((feedback) => feedback.score === score).length;
            return (
              <div className="rating-row" key={score}>
                <span>{'⭐'.repeat(score)}</span>
                <div className="rating-bar">
                  <span style={{ width: `${(count / FEEDBACKS.length) * 100}%` }} />
                </div>
                <strong>{count}</strong>
              </div>
            );
          })}
        </article>
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
                  <td data-label="Fecha">{feedback.date}</td>
                  <td data-label="Cliente">{feedback.client}</td>
                  <td data-label="Habitacion">{feedback.room || '-'}</td>
                  <td data-label="Comentario">{feedback.comment}</td>
                  <td data-label="Puntuacion">{'⭐'.repeat(feedback.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
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
