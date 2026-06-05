import { useEffect, useState } from 'react';

interface BrandLogoProps {
  logoUrl?: string;
  fallbackUrl: string;
  fallbackLabel: string;
  alt: string;
  variant: 'platform' | 'restaurant';
}

export function BrandLogo({ logoUrl, fallbackUrl, fallbackLabel, alt, variant }: BrandLogoProps) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const trimmedUrl = logoUrl?.trim() ?? '';
  const imageUrl = trimmedUrl && !failedUrls.includes(trimmedUrl) ? trimmedUrl : fallbackUrl;
  const shouldUseImage = Boolean(imageUrl) && !failedUrls.includes(imageUrl);
  const fallbackText = fallbackLabel.trim().slice(0, 1).toUpperCase() || '?';

  useEffect(() => {
    setFailedUrls([]);
  }, [fallbackUrl, trimmedUrl]);

  if (shouldUseImage) {
    return (
      <img
        className={variant === 'platform' ? 'brand-logo brand-logo-platform' : 'brand-logo brand-logo-restaurant'}
        src={imageUrl}
        alt={alt}
        onError={() => setFailedUrls((current) => (current.includes(imageUrl) ? current : [...current, imageUrl]))}
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
