import { Navigate, useLocation } from 'react-router-dom';
import { customerPortalAuthService } from '../services/customerPortalAuthService.js';

export default function CustomerProtectedRoute({ children }) {
  const location = useLocation();
  if (!customerPortalAuthService.isLoggedIn()) {
    return <Navigate to="/musteri/login" replace state={{ from: location }} />;
  }
  return children;
}

