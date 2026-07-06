import { Plus, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { mockShows } from '../mock';
import { sendWebhook } from '../services/webhookClient';
import type { Show, Weekday } from '../types';

interface ShowsProps {
  webhookShows: string;
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miercoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sabado',
  sunday: 'Domingo',
};

const WEEKDAYS = Object.entries(WEEKDAY_LABELS) as Array<[Weekday, string]>;

const EMPTY_SHOW: Omit<Show, 'id'> = {
  name: '',
  type: 'single',
  date: '2026-08-15',
  weekday: 'tuesday',
  time: '21:00',
  active: true,
  visibleInChatbot: true,
  bookable: true,
};

export function Shows({ webhookShows }: ShowsProps) {
  const [shows, setShows] = useState<Show[]>(mockShows);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draftShow, setDraftShow] = useState<Omit<Show, 'id'>>(EMPTY_SHOW);
  const [statusMessage, setStatusMessage] = useState('Shows activos visibles para Safari-IA');

  function toggleShow(id: string) {
    let updatedShow: Show | undefined;

    setShows((current) =>
      current.map((show) => {
        if (show.id !== id) {
          return show;
        }

        const nextActive = !show.active;
        updatedShow = {
          ...show,
          active: nextActive,
          visibleInChatbot: nextActive,
          bookable: nextActive,
        };
        return updatedShow;
      }),
    );

    setStatusMessage('Show actualizado. Este cambio se enviará al chatbot cuando esté conectado.');

    if (!updatedShow) {
      return;
    }

    void sendWebhook(webhookShows, {
      accion: 'actualizar_show',
      id: updatedShow.id,
      nombre: updatedShow.name,
      tipo: updatedShow.type,
      fecha: updatedShow.date,
      diasSemana: updatedShow.weekday ? [updatedShow.weekday] : [],
      hora: updatedShow.time,
      activo: updatedShow.active,
    }).then((result) => {
      if (result.success) {
        setStatusMessage('Sincronizado correctamente');
        return;
      }

      setStatusMessage(result.skipped ? 'Webhook no configurado' : 'Cambio guardado en la app, pero no sincronizado');
    });
  }

  function updateDraft<T extends keyof Omit<Show, 'id'>>(key: T, value: Omit<Show, 'id'>[T]) {
    setDraftShow((current) => ({ ...current, [key]: value }));
  }

  function handleCreateShow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextShow: Show = {
      id: `show-${Date.now()}`,
      name: draftShow.name.trim(),
      type: draftShow.type,
      time: draftShow.time,
      active: draftShow.active,
      visibleInChatbot: draftShow.active,
      bookable: draftShow.active,
      ...(draftShow.type === 'single' ? { date: draftShow.date } : { weekday: draftShow.weekday }),
    };

    if (!nextShow.name) {
      return;
    }

    setShows((current) => [...current, nextShow]);
    setDraftShow(EMPTY_SHOW);
    setIsModalOpen(false);
  }

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div className="brand-lockup">
          <div>
            <p className="eyebrow">Gestion espectaculos</p>
            <h1>SHOWS</h1>
          </div>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          NUEVO SHOW
        </button>
      </section>

      <div className="sync-status shows-status">{statusMessage}</div>

      <section className="table-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Puntuales y recurrentes</p>
            <h2>Programacion</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="reservations-table">
            <thead>
              <tr>
                <th>Nombre / Artista</th>
                <th>Tipo</th>
                <th>Fecha o Dia</th>
                <th>Hora</th>
                <th>Estado</th>
                <th>Visible en chatbot</th>
                <th>Reservable</th>
              </tr>
            </thead>
            <tbody>
              {shows.map((show) => (
                <tr key={show.id}>
                  <td data-label="Nombre / Artista">{show.name}</td>
                  <td data-label="Tipo">{show.type === 'single' ? 'Puntual' : 'Recurrente'}</td>
                  <td data-label="Fecha o Dia">{show.type === 'single' ? show.date : WEEKDAY_LABELS[show.weekday ?? 'monday']}</td>
                  <td data-label="Hora">{show.time}</td>
                  <td data-label="Estado">
                    <button className={`compact-toggle ${show.active ? 'is-open' : 'is-closed'}`} type="button" onClick={() => toggleShow(show.id)}>
                      <span>{show.active ? 'Activo' : 'Inactivo'}</span>
                      <strong>{show.active ? 'ON' : 'OFF'}</strong>
                    </button>
                  </td>
                  <td data-label="Visible en chatbot">
                    <span className={`status-pill ${show.visibleInChatbot ? '' : 'is-cancelada'}`}>
                      {show.visibleInChatbot ? 'Visible' : 'Oculto'}
                    </span>
                  </td>
                  <td data-label="Reservable">
                    <span className={`status-pill ${show.bookable ? '' : 'is-cancelada'}`}>
                      {show.bookable ? 'Reservable' : 'No reservable'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="show-modal" onSubmit={handleCreateShow}>
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Nuevo show</p>
                <h2>Programacion</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsModalOpen(false)} aria-label="Cerrar">
                <X size={22} />
              </button>
            </div>

            <label>
              Nombre / Artista
              <input value={draftShow.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="DJ Sunset" />
            </label>

            <label>
              Tipo
              <select value={draftShow.type} onChange={(event) => updateDraft('type', event.target.value as Show['type'])}>
                <option value="single">Puntual</option>
                <option value="recurring">Recurrente</option>
              </select>
            </label>

            {draftShow.type === 'single' ? (
              <label>
                Fecha concreta
                <input value={draftShow.date} type="date" onChange={(event) => updateDraft('date', event.target.value)} />
              </label>
            ) : (
              <label>
                Dia de la semana
                <select value={draftShow.weekday} onChange={(event) => updateDraft('weekday', event.target.value as Weekday)}>
                  {WEEKDAYS.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              Hora
              <input value={draftShow.time} type="time" onChange={(event) => updateDraft('time', event.target.value)} />
            </label>

            <div className="switch-row modal-switch">
              <span>Activo</span>
              <button className={`compact-toggle ${draftShow.active ? 'is-open' : 'is-closed'}`} type="button" onClick={() => updateDraft('active', !draftShow.active)}>
                <strong>{draftShow.active ? 'ON' : 'OFF'}</strong>
              </button>
            </div>

            <button type="submit">
              <Plus size={18} />
              GUARDAR SHOW
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
