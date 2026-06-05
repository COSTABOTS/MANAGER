export const DEFAULT_COSTABOTS_LOGO = '/LOGO_COSTABOTS_WHITE.png';
export const DEFAULT_RESTAURANT_LOGO = '/logos/safari-logo.png';

export function getRestaurantLogo(restaurantLogoUrl?: string) {
  const trimmedUrl = restaurantLogoUrl?.trim() ?? '';
  return trimmedUrl || DEFAULT_RESTAURANT_LOGO;
}
