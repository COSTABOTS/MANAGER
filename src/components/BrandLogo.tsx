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
  const [failedLogoUrl, setFailedLogoUrl] = useState('');
  const trimmedUrl = logoUrl?.trim() ?? '';
  const hasLogoUrl = !preferFallback && trimmedUrl !== '';
  const shouldUseFallback = hasLogoUrl && failedLogoUrl === trimmedUrl;
  const src = hasLogoUrl && !shouldUseFallback ? trimmedUrl : fallbackUrl;
  const shouldUseImage = Boolean(src);
  const fallbackText = fallbackLabel.trim().slice(0, 1).toUpperCase() || '?';
  const frameClassName = `brand-logo-frame brand-logo-frame-${variant}`;

  useEffect(() => {
    setFailedLogoUrl('');
  }, [trimmedUrl]);

  useEffect(() => {
    console.log('BrandLogo src final:', src);
  }, [src]);

  return (
    <span className={frameClassName}>
      {shouldUseImage ? (
        <img
          className="brand-logo-image"
          src={src}
          alt={alt}
          onError={() => {
            if (variant === 'restaurant' && src === trimmedUrl) {
              console.warn('No se pudo cargar el logo restaurante:', src);
              setFailedLogoUrl(trimmedUrl);
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
