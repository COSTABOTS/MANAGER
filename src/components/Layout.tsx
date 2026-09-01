import { Menu, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { PageKey } from '../App';
import { DEFAULT_COSTABOTS_LOGO, RESTAURANT_LOGO } from '../config/branding';
import { BrandLogo } from './BrandLogo';

const NAV_ITEMS: Array<{ key: PageKey; label: string }> = [
  { key: 'today', label: 'HOY' },
  { key: 'reservations', label: 'RESERVAS' },
  { key: 'control', label: 'CONTROL' },
  { key: 'feedbacks', label: 'FEEDBACKS' },
  { key: 'shows', label: 'SHOWS' },
  { key: 'settings', label: 'SETTINGS' },
];

interface LayoutProps {
  activePage: PageKey;
  children: ReactNode;
  restaurantName: string;
  restaurantLogoUrl: string;
  isSuperAdmin?: boolean;
  activeClientId?: string;
  managedClients?: Array<{ client_id: string; rest_name: string }>;
  onClientChange?: (clientId: string) => void;
  onNavigate: (page: PageKey) => void;
  onLogout: () => void;
}

export function Layout({
  activePage,
  children,
  restaurantName,
  restaurantLogoUrl,
  isSuperAdmin = false,
  activeClientId = '',
  managedClients = [],
  onClientChange,
  onNavigate,
  onLogout,
}: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    console.log('Logo visual recibido:', restaurantLogoUrl);
  }, [restaurantLogoUrl]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousOverscroll = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousOverscroll;
    };
  }, [isSidebarOpen]);

  function handleNavigate(page: PageKey) {
    onNavigate(page);
    setIsSidebarOpen(false);
  }

  function handleLogout() {
    setIsSidebarOpen(false);
    onLogout();
  }

  return (
    <>
      <button className="menu-button" type="button" onClick={() => setIsSidebarOpen(true)} aria-label="Abrir menú">
        <Menu size={28} />
      </button>

      <aside className={`sidebar ${isSidebarOpen ? 'is-open' : ''}`} aria-label="Navegación principal">
        <div className="sidebar-header">
          <div className="sidebar-brand-stack">
            <div className="costabots-lockup">
              <BrandLogo fallbackUrl={DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt="Costabots" variant="platform" preferFallback />
              <span>COSTABOTS MANAGER</span>
            </div>
            <div className="brand-lockup">
              <BrandLogo className="restaurant-avatar-sidebar" logoUrl={restaurantLogoUrl} fallbackUrl={RESTAURANT_LOGO} fallbackLabel={restaurantName} alt={restaurantName} variant="restaurant" />
              <div>
                <p className="eyebrow">Restaurante</p>
                <strong>{restaurantName}</strong>
              </div>
            </div>
            {isSuperAdmin && managedClients.length > 0 && (
              <label className="superadmin-client-selector">
                <span>Cliente activo</span>
                <select className="client-switcher-select" value={activeClientId} onChange={(event) => onClientChange?.(event.target.value)}>
                  {managedClients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.rest_name || client.client_id} · {client.client_id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button className="icon-button" type="button" onClick={() => setIsSidebarOpen(false)} aria-label="Cerrar menú">
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
          <button
            className={activePage === 'reports' ? 'is-active' : ''}
            type="button"
            onClick={() => handleNavigate('reports')}
          >
            INFORMES
          </button>
        </nav>

        <button className="logout-button" type="button" onClick={handleLogout}>
          LOGOUT
        </button>
      </aside>

      {isSidebarOpen && <button className="sidebar-backdrop" type="button" onClick={() => setIsSidebarOpen(false)} aria-label="Cerrar menú" />}

      {children}
    </>
  );
}
