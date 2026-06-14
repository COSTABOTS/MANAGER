import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { CheckCircle2, Send, Star } from 'lucide-react';
import { CLIENT_CONFIG_KEY } from '../services/clientConfig';
import { PUBLIC_FEEDBACK_CONFIG_WEBHOOK_URL, submitFeedback } from '../services/publicFeedback';
import type { FeedbackSubmitState } from '../services/publicFeedback';

interface FeedbackPublicProps {
  idReserva: string;
}

interface FeedbackBranding {
  restaurantName: string;
  primaryColor: string;
  logoUrl: string;
  backgroundImageUrl: string;
  positiveFeedbackWebhook: string;
  negativeFeedbackWebhook: string;
}

const FALLBACK_BRANDING: FeedbackBranding = {
  restaurantName: 'Safari Restaurant',
  primaryColor: '#2f7d4a',
  logoUrl: '',
  backgroundImageUrl: '',
  positiveFeedbackWebhook: '',
  negativeFeedbackWebhook: '',
};

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toStringValue(source[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function normalizeFeedbackBranding(config: Record<string, unknown>): FeedbackBranding {
  const webhooks = typeof config.webhooks === 'object' && config.webhooks ? (config.webhooks as Record<string, unknown>) : {};
  const mergedConfig = { ...webhooks, ...config };

  return {
    restaurantName:
      pickString(mergedConfig, ['rest_nombre', 'restaurantName', 'restaurant_name', 'nombre_restaurante']) ||
      FALLBACK_BRANDING.restaurantName,
    primaryColor: pickString(mergedConfig, ['color', 'primaryColor', 'primary_color']) || FALLBACK_BRANDING.primaryColor,
    logoUrl: pickString(mergedConfig, ['logo_restaurante', 'restaurantLogoUrl', 'restaurant_logo_url', 'logo']),
    backgroundImageUrl: pickString(mergedConfig, ['backgroundImageUrl', 'backgroundImage', 'restaurantBackgroundUrl', 'fondo_restaurante', 'background']),
    positiveFeedbackWebhook: pickString(mergedConfig, ['webhook_feedback_positivo']),
    negativeFeedbackWebhook: pickString(mergedConfig, ['webhook_feedback_negativo']),
  };
}

function hasFeedbackWebhooks(branding: FeedbackBranding) {
  return Boolean(branding.positiveFeedbackWebhook && branding.negativeFeedbackWebhook);
}

function getRatingText(rating: number) {
  return '⭐'.repeat(Math.min(5, Math.max(1, rating)));
}

function getStoredFeedbackBranding(): FeedbackBranding {
  try {
    const rawConfig = sessionStorage.getItem(CLIENT_CONFIG_KEY);

    if (!rawConfig) {
      return FALLBACK_BRANDING;
    }

    return normalizeFeedbackBranding(JSON.parse(rawConfig) as Record<string, unknown>);
  } catch {
    return FALLBACK_BRANDING;
  }
}

async function loadPublicFeedbackBranding(idReserva: string): Promise<FeedbackBranding> {
  const storedBranding = getStoredFeedbackBranding();

  if (hasFeedbackWebhooks(storedBranding)) {
    return storedBranding;
  }

  const configWebhookUrl = PUBLIC_FEEDBACK_CONFIG_WEBHOOK_URL.trim();

  if (!configWebhookUrl) {
    return storedBranding;
  }

  try {
    const response = await fetch(configWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id_reserva: idReserva }),
    });

    if (!response.ok) {
      return storedBranding;
    }

    return normalizeFeedbackBranding((await response.json()) as Record<string, unknown>);
  } catch (error) {
    console.warn('[Safari Manager] No se pudo cargar config publica de feedback', error);
    return storedBranding;
  }
}

export function FeedbackPublic({ idReserva }: FeedbackPublicProps) {
  const [branding, setBranding] = useState<FeedbackBranding>(() => getStoredFeedbackBranding());
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<FeedbackSubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    loadPublicFeedbackBranding(idReserva)
      .then((nextBranding) => {
        if (isMounted) {
          setBranding(nextBranding);
        }
      })
      .catch(() => {
        if (isMounted) {
          setBranding(FALLBACK_BRANDING);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [idReserva]);

  const accentStyle = useMemo(
    () =>
      ({
        '--feedback-accent': branding.primaryColor,
        '--feedback-bg-image': branding.backgroundImageUrl ? `url("${branding.backgroundImageUrl}")` : 'none',
      }) as CSSProperties,
    [branding.backgroundImageUrl, branding.primaryColor],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!rating || status === 'sending') {
      return;
    }

    setStatus('sending');
    setErrorMessage('');

    try {
      const feedbackWebhook = rating >= 4 ? branding.positiveFeedbackWebhook : branding.negativeFeedbackWebhook;
      await submitFeedback({
        id_reserva: idReserva,
        puntuacion: rating,
        puntuacion_texto: getRatingText(rating),
        comentario: comment.trim(),
        timestamp: new Date().toISOString(),
      }, feedbackWebhook);
      setStatus('success');
    } catch (error) {
      console.error('[Safari Manager] Error enviando feedback publico', error);
      setStatus('error');
      setErrorMessage('No se ha podido enviar la valoración en este momento.');
    }
  }

  const activeRating = hoverRating || rating;

  return (
    <main className="feedback-public-shell" style={accentStyle}>
      <section className="feedback-public-card" aria-label={`Valoracion de ${branding.restaurantName}`}>
        {status === 'success' ? (
          <div className="feedback-public-success">
            <span className="feedback-success-icon" aria-hidden="true">
              <CheckCircle2 size={38} />
            </span>
            <p className="feedback-public-restaurant">{branding.restaurantName}</p>
            <h1>Gracias por tu valoración</h1>
            <p>Tu opinión nos ayuda a mejorar.</p>
          </div>
        ) : (
          <form className="feedback-public-form" onSubmit={handleSubmit}>
            <div className="feedback-public-brand">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.restaurantName} />
              ) : (
                <span aria-hidden="true">{branding.restaurantName.slice(0, 1).toUpperCase()}</span>
              )}
            </div>

            <p className="feedback-public-restaurant">{branding.restaurantName}</p>
            <div className="feedback-bot-message">
              <h1>Gracias por visitarnos</h1>
              <p>¿Cómo valorarías tu experiencia?</p>
            </div>

            <fieldset className="feedback-stars" aria-label="Puntuacion">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`}
                  aria-pressed={rating === value}
                  className={value <= activeRating ? 'is-active' : ''}
                  onBlur={() => setHoverRating(0)}
                  onClick={() => setRating(value)}
                  onFocus={() => setHoverRating(value)}
                  onMouseEnter={() => setHoverRating(value)}
                  onMouseLeave={() => setHoverRating(0)}
                  type="button"
                >
                  <Star size={38} fill="currentColor" />
                </button>
              ))}
            </fieldset>

            <label className="feedback-comment-field">
              Comentario opcional
              <textarea
                onChange={(event) => setComment(event.target.value)}
                placeholder="Cuéntanos qué te gustó o qué podríamos mejorar"
                rows={4}
                value={comment}
              />
            </label>

            {status === 'error' && <p className="feedback-public-error">{errorMessage}</p>}

            <button className="feedback-submit-button" disabled={!rating || status === 'sending'} type="submit">
              <Send size={18} />
              {status === 'sending' ? 'Enviando...' : 'Enviar valoración'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
