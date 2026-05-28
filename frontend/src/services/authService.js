import { api, setAuthRefreshToken, setAuthToken, setStoredUser } from './api.js';

const resolveLoginSource = () => {
  if (typeof window === 'undefined') return 'admin_web';
  const path = String(window.location?.pathname || '').toLowerCase();
  return path.includes('personel') || path.includes('personnel') ? 'personnel_mobile' : 'admin_web';
};

export const authService = {
  async login(credentials) {
    const data = await api.post('/auth/login', { ...credentials, source: credentials?.source || resolveLoginSource() });
    setAuthToken(data.token);
    setAuthRefreshToken(data.refreshToken || '');
    setStoredUser(data.user);
    return data;
  },
  logout() {
    return api.post('/auth/logout', { source: resolveLoginSource() }, { __skipAuthRefresh: true });
  },
  me() {
    return api.get('/auth/me');
  },
};
