import { useEffect, useState } from 'react';

interface BrandLogoProps {
  logoUrl?: string;
  fallbackUrl: string;
  fallbackLabel: string;
  alt: string;
  variant: 'platform' | 'restaurant';
  preferFallback?: boolean;
}

export function BrandLogo({ logoUrl, fallbackUrl, fallbackLabel, alt, variant, preferFallback = false }: BrandLogoProps) {
  const [imageState, setImageState] = useState<'primary' | 'fallback' | 'letter'>('primary');
  const trimmedUrl = logoUrl?.trim() ?? '';
  const primarySrc = !preferFallback && trimmedUrl !== '' ? trimmedUrl : fallbackUrl;
  const currentSrc = imageState === 'letter' ? '' : imageState === 'fallback' ? fallbackUrl : primarySrc;
  const shouldUseImage = Boolean(currentSrc);
  const fallbackText = fallbackLabel.trim().slice(0, 1).toUpperCase() || '?';
  const frameClassName = `brand-logo-frame brand-logo-frame-${variant}`;

  useEffect(() => {
    setImageState('primary');
  }, [fallbackUrl, preferFallback, trimmedUrl]);

  return (
    <span className={frameClassName}>
      {shouldUseImage ? (
          <img
            key={currentSrc}
            className="brand-logo-image"
            src={currentSrc}
            alt={alt}
            onError={() => {
              if (imageState === 'primary' && currentSrc !== fallbackUrl && fallbackUrl) {
                if (variant === 'restaurant') {
                  console.warn('No se pudo cargar el logo restaurante:', currentSrc);
                }
                setImageState('fallback');
                return;
              }

              setImageState('letter');
            }}
          />
      ) : (
        <span className="brand-logo-letter" aria-hidden="true">
          {fallbackText}
        </span>
      )}
    </span>
  );
}
