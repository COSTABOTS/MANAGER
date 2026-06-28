import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { DEFAULT_COSTABOTS_LOGO } from '../config/branding';
import { BrandLogo } from './BrandLogo';

interface LoginScreenProps {
  error: string;
  isLoading: boolean;
  onLogin: (usuario: string, password: string) => Promise<void>;
}

const DEMO_LOGIN_USER = 'demo2@costabots.local';
const DEMO_LOGIN_PASSWORD = 'Demo2026';

function shouldPrefillDemoLogin() {
  const params = new URLSearchParams(window.location.search);
  return params.get('demo') === '1';
}

export function LoginScreen({ error, isLoading, onLogin }: LoginScreenProps) {
  const isDemo = shouldPrefillDemoLogin();
  const [usuario, setUsuario] = useState(isDemo ? DEMO_LOGIN_USER : '');
  const [password, setPassword] = useState(isDemo ? DEMO_LOGIN_PASSWORD : '');
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onLogin(usuario.trim(), password);
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-label="Acceso CostaBots Manager">
        <div className="login-brand">
          <BrandLogo fallbackUrl={DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt="Costabots" variant="platform" preferFallback />
          <div>
            <p className="eyebrow">Acceso restaurante</p>
            <h1>CostaBots Manager</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Usuario
            <input
              autoComplete="username"
              autoFocus
              name="usuario"
              onChange={(event) => setUsuario(event.target.value)}
              placeholder="Usuario"
              required
              type="text"
              value={usuario}
            />
          </label>

          <label>
            Password
            <span className="password-field">
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? 'Ocultar password' : 'Mostrar password'}
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          {error && <p className="login-error">{error}</p>}

          <button className="primary-button login-submit" disabled={isLoading} type="submit">
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
