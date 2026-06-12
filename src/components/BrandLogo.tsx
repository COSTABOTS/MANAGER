import { useEffect } from 'react';

interface BrandLogoProps {
  logoUrl?: string;
  fallbackUrl: string;
  fallbackLabel: string;
  alt: string;
  variant: 'platform' | 'restaurant';
  preferFallback?: boolean;
}

export function BrandLogo({ logoUrl, fallbackUrl, fallbackLabel, alt, variant, preferFallback = false }: BrandLogoProps) {
  const trimmedUrl = logoUrl?.trim() ?? '';
  const finalSrc = !preferFallback && trimmedUrl !== '' ? trimmedUrl : fallbackUrl;
  const shouldUseImage = Boolean(finalSrc);
  const fallbackText = fallbackLabel.trim().slice(0, 1).toUpperCase() || '?';
  const frameClassName = `brand-logo-frame brand-logo-frame-${variant}`;

  useEffect(() => {
    console.log('BrandLogo logoUrl:', logoUrl);
    console.log('BrandLogo fallbackUrl:', fallbackUrl);
    console.log('BrandLogo finalSrc:', finalSrc);
  }, [fallbackUrl, finalSrc, logoUrl]);

  return (
    <span className={frameClassName}>
      {shouldUseImage ? (
          <img
            className="brand-logo-image"
            src={finalSrc}
            alt={alt}
            onError={() => {
              if (variant === 'restaurant' && finalSrc === trimmedUrl) {
                console.warn('No se pudo cargar el logo restaurante:', finalSrc);
              }
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
