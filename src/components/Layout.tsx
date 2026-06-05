import { Menu, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { PageKey } from '../App';
import { DEFAULT_COSTABOTS_LOGO, DEFAULT_RESTAURANT_LOGO } from '../config/branding';
import { BrandLogo } from './BrandLogo';

const NAV_ITEMS: Array<{ key: PageKey; label: string }> = [
  { key: 'today', label: '🏠 HOY' },
  { key: 'reservations', label: '📅 RESERVAS' },
  { key: 'control', label: '📊 CONTROL' },
  { key: 'feedbacks', label: '⭐ FEEDBACKS' },
  { key: 'shows', label: '🎤 SHOWS' },
  { key: 'settings', label: '⚙️ SETTINGS' },
];

interface LayoutProps {
  activePage: PageKey;
  children: ReactNode;
  costabotsLogoUrl?: string;
  restaurantName: string;
  restaurantLogoUrl?: string;
  onNavigate: (page: PageKey) => void;
}

export function Layout({ activePage, children, costabotsLogoUrl, restaurantName, restaurantLogoUrl, onNavigate }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  function handleNavigate(page: PageKey) {
    onNavigate(page);
    setIsSidebarOpen(false);
  }

  return (
    <>
      <button className="menu-button" type="button" onClick={() => setIsSidebarOpen(true)} aria-label="Abrir menu">
        <Menu size={28} />
      </button>

      <aside className={`sidebar ${isSidebarOpen ? 'is-open' : ''}`} aria-label="Navegacion principal">
        <div className="sidebar-header">
          <div className="sidebar-brand-stack">
            <div className="costabots-lockup">
              <BrandLogo logoUrl={costabotsLogoUrl} fallbackUrl={DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt="Costabots" variant="platform" />
              <span>COSTABOTS MANAGER</span>
            </div>
            <div className="brand-lockup">
              <BrandLogo logoUrl={restaurantLogoUrl} fallbackUrl={DEFAULT_RESTAURANT_LOGO} fallbackLabel={restaurantName} alt={restaurantName} variant="restaurant" />
              <div>
                <p className="eyebrow">Restaurante</p>
                <strong>{restaurantName}</strong>
              </div>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={() => setIsSidebarOpen(false)} aria-label="Cerrar menu">
            <X size={22} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={activePage === item.key ? 'is-active' : ''}
              type="button"
              onClick={() => handleNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button className="logout-button" type="button">
          🚪 LOGOUT
        </button>
      </aside>

      {isSidebarOpen && <button className="sidebar-backdrop" type="button" onClick={() => setIsSidebarOpen(false)} aria-label="Cerrar menu" />}

      {children}
    </>
  );
}
