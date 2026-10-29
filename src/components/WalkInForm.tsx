import { FormEvent, useState } from 'react';
import { Plus } from 'lucide-react';
import { attemptWalkInCreate } from '../utils/internalBookingPreview';

interface WalkInFormProps {
  onAddWalkIn: (nameOrRoom: string, pax: number) => Promise<void>;
  disabledReason?: string;
}

function selectPaxInput(event: { currentTarget: HTMLInputElement }) {
  const input = event.currentTarget;
  requestAnimationFrame(() => {
    input.select();
  });
}

function numericInputValue(value: string) {
  return value.replace(/\D/g, '');
}

export function WalkInForm({ onAddWalkIn, disabledReason }: WalkInFormProps) {
  const [nameOrRoom, setNameOrRoom] = useState('');
  const [pax, setPax] = useState('2');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedPax = Number(pax);

    if (disabledReason || !nameOrRoom.trim() || !pax.trim() || !Number.isInteger(parsedPax) || parsedPax < 1) {
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await attemptWalkInCreate(() => onAddWalkIn(nameOrRoom.trim(), parsedPax));
      if (created) {
        setNameOrRoom('');
        setPax('2');
        setError('');
      } else {
        setError('No se pudo crear el walk-in. Los datos permanecen en el formulario; inténtalo de nuevo.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="walkin-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <span>Nueva mesa</span>
        <strong>Walk-in</strong>
      </div>
      <label>
        Nombre o Habitación
        <input
          value={nameOrRoom}
          onChange={(event) => setNameOrRoom(event.target.value)}
          placeholder="Nombre / Hab."
          autoComplete="off"
        />
      </label>
      <label>
        Pax
        <input
          value={pax}
          onFocus={selectPaxInput}
          onClick={selectPaxInput}
          onPointerUp={selectPaxInput}
          onChange={(event) => setPax(numericInputValue(event.target.value))}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          min="1"
          step="1"
          max="30"
        />
      </label>
      {disabledReason && <p className="walkin-status" role="status">{disabledReason}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" disabled={isSubmitting || Boolean(disabledReason)}>
        <Plus size={18} />
        {isSubmitting ? 'Añadiendo...' : '+AÑADIR MESA'}
      </button>
    </form>
  );
}
