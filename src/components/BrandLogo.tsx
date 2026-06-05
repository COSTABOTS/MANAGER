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
  const frameClassName = `brand-logo-frame brand-logo-frame-${variant}`;

  useEffect(() => {
    setFailedUrls([]);
  }, [fallbackUrl, trimmedUrl]);

  return (
    <span className={frameClassName}>
      {shouldUseImage ? (
        <img
          className="brand-logo-image"
          src={imageUrl}
          alt={alt}
          onError={() => setFailedUrls((current) => (current.includes(imageUrl) ? current : [...current, imageUrl]))}
        />
      ) : (
        <span className="brand-logo-letter" aria-hidden="true">
          {fallbackText}
        </span>
      )}
    </span>
  );
}
