import { Component } from 'react';
import './SettingsCampaignShell.css';

const MODE_LABELS = {
  settings: 'Ayarlar',
  campaign: 'Kampanya Yönetimi',
};

export default class SettingsCampaignBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const mode = this.props.mode || 'settings';
    console.error(`[SettingsCampaignBoundary:${mode}]`, {
      message: error?.message || String(error),
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const mode = this.props.mode || 'settings';
    const label = MODE_LABELS[mode] || 'Bu sayfa';

    return (
      <div className={`dashboard-page page-stack ${mode === 'campaign' ? 'campaign-management-page' : 'settings-page'}`}>
        <div className="mod-card settings-campaign-runtime-fallback" role="alert">
          <div className="mod-card-header">
            <div>
              <h2>{label} bölümü yüklenemedi</h2>
              <p>Bu bölüm kontrollü olarak durduruldu. Sayfayı yenileyebilir veya diğer modüllere geçebilirsiniz.</p>
            </div>
          </div>
          <pre>{this.state.error?.message || 'Beklenmeyen render hatası'}</pre>
        </div>
      </div>
    );
  }
}
