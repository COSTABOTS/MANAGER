import { useEffect, useState } from 'react';

interface BrandLogoProps {
  logoUrl?: string;
  fallbackLabel: string;
  alt: string;
  variant: 'platform' | 'restaurant';
}

export function BrandLogo({ logoUrl, fallbackLabel, alt, variant }: BrandLogoProps) {
  const [failedUrl, setFailedUrl] = useState('');
  const trimmedUrl = logoUrl?.trim() ?? '';
  const shouldUseImage = Boolean(trimmedUrl) && failedUrl !== trimmedUrl;
  const fallbackText = fallbackLabel.trim().slice(0, 1).toUpperCase() || '?';

  useEffect(() => {
    setFailedUrl('');
  }, [trimmedUrl]);

  if (shouldUseImage) {
    return (
      <img
        className={variant === 'platform' ? 'brand-logo brand-logo-platform' : 'brand-logo brand-logo-restaurant'}
        src={trimmedUrl}
        alt={alt}
        onError={() => setFailedUrl(trimmedUrl)}
      />
    );
  }

  return (
    <span
      className={variant === 'platform' ? 'brand-logo-fallback brand-logo-platform' : 'brand-logo-fallback brand-logo-restaurant'}
      aria-hidden="true"
    >
      {fallbackText}
    </span>
  );
}
