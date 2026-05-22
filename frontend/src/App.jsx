import React, { Component, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { DialogProvider } from './components/ConfirmModal.jsx';
import { AuthProvider } from './hooks/useAuth.js';
import { ErrorFallbackView } from './pages/_shared/route-error/RouteError.jsx';
import { router } from './router/router.jsx';
import { getStoredUser, isRequestCancellation } from './services/api.js';
import { settingsService } from './services/settingsService.js';
import { supportService } from './services/supportService.js';

function buildRuntimeErrorReport(error, source) {
	const storedUser = getStoredUser();
	return {
		message: error?.message || 'Component crash',
		stack: error?.stack || '',
		url: typeof window !== 'undefined' ? window.location.href : '',
		browser: typeof navigator !== 'undefined' ? navigator.userAgent : '',
		occurredAt: new Date().toISOString(),
		source,
		user: storedUser ? {
			id: storedUser.id,
			username: storedUser.username,
			name: storedUser.name,
			role: storedUser.role,
			email: storedUser.email,
		} : null,
	};
}

class AppErrorBoundary extends Component {
	constructor(props) {
		super(props);
		this.state = { hasError: false, errorMessage: '' };
	}

	static getDerivedStateFromError(error) {
		if (isRequestCancellation(error)) {
			return null;
		}
		return {
			hasError: true,
			errorMessage: error?.message || 'Bilinmeyen hata',
		};
	}

	componentDidCatch(error) {
		if (isRequestCancellation(error)) {
			if (import.meta.env.DEV) {
				console.debug('[error-boundary] cancelled request ignored', error);
			}
			return;
		}
		console.error('Global runtime error:', error);
		supportService.reportSystemError(buildRuntimeErrorReport(error, 'React ErrorBoundary')).catch(() => {
			// Destek bildirimi uygulamanın toparlanmasını engellememeli.
		});
		settingsService.sendDeveloperLog({
			level: 'error',
			source: 'frontend',
			message: error?.message || 'Component crash',
			action: 'React ErrorBoundary',
			endpoint: window.location.pathname,
			requestUrl: window.location.href,
			stack: error?.stack || '',
			errorType: 'component_crash',
			browserInfo: navigator.userAgent,
		});
	}

	render() {
		if (this.state.hasError) {
			return <ErrorFallbackView technicalMessage={this.state.errorMessage} />;
		}
		return this.props.children;
	}
}

export default function App() {
	useEffect(() => {
		const onWindowError = (event) => {
			if (isRequestCancellation(event?.error) || isRequestCancellation(event)) {
				return;
			}
			settingsService.sendDeveloperLog({
				level: 'error',
				source: 'frontend',
				message: event?.message || 'Runtime error',
				action: 'window.error',
				endpoint: window.location.pathname,
				requestUrl: window.location.href,
				stack: event?.error?.stack || '',
				errorType: 'runtime_error',
				browserInfo: navigator.userAgent,
			});
		};

		const onUnhandledRejection = (event) => {
			const reason = event?.reason;
			if (isRequestCancellation(reason)) {
				event?.preventDefault?.();
				if (import.meta.env.DEV) {
					console.debug('[unhandledrejection] cancelled request ignored', reason);
				}
				return;
			}
			settingsService.sendDeveloperLog({
				level: 'error',
				source: 'frontend',
				message: reason?.message || String(reason || 'Unhandled promise rejection'),
				action: 'window.unhandledrejection',
				endpoint: window.location.pathname,
				requestUrl: window.location.href,
				stack: reason?.stack || '',
				errorType: 'runtime_error',
				browserInfo: navigator.userAgent,
			});
		};

		window.addEventListener('error', onWindowError);
		window.addEventListener('unhandledrejection', onUnhandledRejection);

		return () => {
			window.removeEventListener('error', onWindowError);
			window.removeEventListener('unhandledrejection', onUnhandledRejection);
		};
	}, []);

	return (
		<AuthProvider>
			<DialogProvider>
				<AppErrorBoundary>
					<RouterProvider router={router} />
				</AppErrorBoundary>
			</DialogProvider>
		</AuthProvider>
	);
}

