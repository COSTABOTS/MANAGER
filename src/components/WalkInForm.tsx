import { FormEvent, useState } from 'react';
import { Plus } from 'lucide-react';

interface WalkInFormProps {
  onAddWalkIn: (nameOrRoom: string, pax: number) => Promise<void>;
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

export function WalkInForm({ onAddWalkIn }: WalkInFormProps) {
  const [nameOrRoom, setNameOrRoom] = useState('');
  const [pax, setPax] = useState('2');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedPax = Number(pax);

    if (!nameOrRoom.trim() || !pax.trim() || !Number.isInteger(parsedPax) || parsedPax < 1) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddWalkIn(nameOrRoom.trim(), parsedPax);
      setNameOrRoom('');
      setPax('2');
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
      <button type="submit" disabled={isSubmitting}>
        <Plus size={18} />
        {isSubmitting ? 'Añadiendo...' : '+AÑADIR MESA'}
      </button>
    </form>
  );
}
