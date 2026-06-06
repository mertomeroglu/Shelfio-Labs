import React, { Component, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { DialogProvider } from './components/ConfirmModal.jsx';
import CookieConsentProvider from './components/CookieConsent.jsx';
import { AuthProvider } from './hooks/useAuth.js';
import { ErrorFallbackView } from './pages/_shared/route-error/RouteError.jsx';
import { router } from './router/router.jsx';
import { getStoredUser, isRequestCancellation } from './services/api.js';
import { settingsService } from './services/settingsService.js';
import { supportService } from './services/supportService.js';

function buildRuntimeErrorReport(error, source, errorInfo = null) {
	const storedUser = getStoredUser();
	return {
		message: error?.message || 'Component crash',
		stack: error?.stack || '',
		componentStack: errorInfo?.componentStack || '',
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

function sendFrontendDeveloperLog(error, action, extra = {}) {
	if (isRequestCancellation(error)) return;
	settingsService.sendDeveloperLog({
		level: 'error',
		source: 'frontend',
		message: error?.message || String(error || 'Runtime error'),
		action,
		endpoint: window.location.pathname,
		requestUrl: window.location.href,
		stack: error?.stack || '',
		errorType: extra.errorType || 'runtime_error',
		browserInfo: navigator.userAgent,
		...extra,
	});
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

	componentDidCatch(error, errorInfo) {
		if (isRequestCancellation(error)) {
			if (import.meta.env.DEV) {
				console.debug('[error-boundary] cancelled request ignored', error);
			}
			return;
		}
		console.error('Global runtime error:', error);
		supportService.reportSystemError(buildRuntimeErrorReport(error, 'React ErrorBoundary', errorInfo)).catch(() => {
			// Destek bildirimi uygulamanın toparlanmasını engellememeli.
		});
		sendFrontendDeveloperLog(error, 'React ErrorBoundary', {
			errorType: 'component_crash',
			componentStack: errorInfo?.componentStack || '',
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
			sendFrontendDeveloperLog(event?.error || event?.message || event, 'window.error', {
				message: event?.message || event?.error?.message || 'Runtime error',
				stack: event?.error?.stack || '',
				errorType: 'runtime_error',
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
			sendFrontendDeveloperLog(reason, 'window.unhandledrejection', {
				message: reason?.message || String(reason || 'Unhandled promise rejection'),
				stack: reason?.stack || '',
				errorType: 'unhandled_rejection',
			});
		};

		const originalConsoleError = console.error;
		console.error = (...args) => {
			originalConsoleError(...args);
			const firstError = args.find((item) => item instanceof Error);
			const message = firstError?.message || args.map((item) => (
				typeof item === 'string' ? item : item?.message || ''
			)).filter(Boolean).join(' ');
			if (!message || /developer log|settings\/developer-logs/i.test(message)) return;
			sendFrontendDeveloperLog(firstError || new Error(message), 'console.error', {
				message,
				stack: firstError?.stack || '',
				errorType: 'console_error',
			});
		};

		window.addEventListener('error', onWindowError);
		window.addEventListener('unhandledrejection', onUnhandledRejection);

		return () => {
			console.error = originalConsoleError;
			window.removeEventListener('error', onWindowError);
			window.removeEventListener('unhandledrejection', onUnhandledRejection);
		};
	}, []);

	return (
		<AuthProvider>
			<DialogProvider>
				<AppErrorBoundary>
					<RouterProvider router={router} />
					<CookieConsentProvider />
				</AppErrorBoundary>
			</DialogProvider>
		</AuthProvider>
	);
}

