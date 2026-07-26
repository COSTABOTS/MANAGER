import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { CheckCircle2, Send, Star } from 'lucide-react';
import { CLIENT_CONFIG_KEY } from '../services/clientConfig';
import { getPublicFeedbackClientContextFromUrl, loadPublicFeedbackDetails, submitFeedback } from '../services/publicFeedback';
import type { FeedbackSubmitState, PublicFeedbackClientContext } from '../services/publicFeedback';

interface FeedbackPublicProps {
  idReserva: string;
}

interface FeedbackBranding {
  restaurantName: string;
  primaryColor: string;
  logoUrl: string;
  backgroundImageUrl: string;
  alreadySubmitted: boolean;
}

const FALLBACK_BRANDING: FeedbackBranding = {
  restaurantName: 'el restaurante',
  primaryColor: '#2f7d4a',
  logoUrl: '',
  backgroundImageUrl: '',
  alreadySubmitted: false,
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
  const branding = typeof config.branding === 'object' && config.branding ? (config.branding as Record<string, unknown>) : {};
  const mergedConfig = { ...config, ...branding };

  return {
    restaurantName:
      pickString(mergedConfig, ['restaurante', 'rest_nombre', 'restaurantName', 'restaurant_name', 'nombre_restaurante']) ||
      FALLBACK_BRANDING.restaurantName,
    primaryColor: pickString(mergedConfig, ['color', 'primaryColor', 'primary_color']) || FALLBACK_BRANDING.primaryColor,
    logoUrl: pickString(mergedConfig, ['logo_restaurante', 'restaurantLogoUrl', 'restaurant_logo_url', 'logo', 'logoUrl']),
    backgroundImageUrl: pickString(mergedConfig, ['backgroundImageUrl', 'backgroundImage', 'restaurantBackgroundUrl', 'fondo_restaurante', 'fondo', 'background']),
    alreadySubmitted: config.already_submitted === true,
  };
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

async function loadPublicFeedbackBranding(idReserva: string, clientContext: PublicFeedbackClientContext): Promise<FeedbackBranding> {
  const storedBranding = getStoredFeedbackBranding();

  try {
    const details = await loadPublicFeedbackDetails(idReserva, clientContext);
    if (!details || details.encontrada === false) {
      return storedBranding;
    }

    return normalizeFeedbackBranding(details as Record<string, unknown>);
  } catch (error) {
    console.warn('[Safari Manager] No se pudo cargar config publica de feedback', error);
    return storedBranding;
  }
}

export function FeedbackPublic({ idReserva }: FeedbackPublicProps) {
  const feedbackClientContext = useMemo(() => getPublicFeedbackClientContextFromUrl(), []);
  const [branding, setBranding] = useState<FeedbackBranding>(() => getStoredFeedbackBranding());
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<FeedbackSubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;
    console.log('[FeedbackPublic mounted]', idReserva);

    loadPublicFeedbackBranding(idReserva, feedbackClientContext)
      .then((nextBranding) => {
        if (!isMounted) return;
        setBranding(nextBranding);
        if (nextBranding.alreadySubmitted) {
          setStatus('already_submitted');
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
  }, [feedbackClientContext, idReserva]);

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
      const result = await submitFeedback(
        {
          id_reserva: idReserva,
          puntuacion: rating,
          puntuacion_texto: getRatingText(rating),
          comentario: comment.trim(),
          timestamp: new Date().toISOString(),
        },
        feedbackClientContext,
      );
      setStatus(result.alreadySubmitted ? 'already_submitted' : 'success');
    } catch (error) {
      console.error('[Safari Manager] Error enviando feedback publico', error);
      setStatus('error');
      setErrorMessage('No se ha podido enviar la valoración en este momento.');
    }
  }

  const activeRating = hoverRating || rating;

  return (
    <main className="feedback-public-shell" style={accentStyle}>
      <section className="feedback-public-card" aria-label={`Valoración de ${branding.restaurantName}`}>
        {status === 'success' || status === 'already_submitted' ? (
          <div className="feedback-public-success">
            <span className="feedback-success-icon" aria-hidden="true">
              <CheckCircle2 size={38} />
            </span>
            <p className="feedback-public-restaurant">{branding.restaurantName}</p>
            <h1>{status === 'already_submitted' ? 'Valoración ya enviada' : 'Gracias por tu valoración'}</h1>
            <p>{status === 'already_submitted' ? 'Ya hemos recibido tu valoración.' : 'Tu opinión nos ayuda a mejorar.'}</p>
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
