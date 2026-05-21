import { api, setAuthToken, setStoredUser } from './api.js';

export const authService = {
  async login(credentials) {
    const data = await api.post('/auth/login', credentials);
    setAuthToken(data.token);
    setStoredUser(data.user);
    return data;
  },
  me() {
    return api.get('/auth/me');
  },
};
