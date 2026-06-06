import { useLocation } from 'react-router-dom';
import SettingsCampaignBoundary from '../_shared/settings-campaign-shell/SettingsCampaignBoundary.jsx';
import SettingsCampaignShell from '../_shared/settings-campaign-shell/SettingsCampaignShell.jsx';

export default function SystemSettingsShell() {
  const location = useLocation();

  return (
    <SettingsCampaignBoundary mode="settings" resetKey={location.key}>
      <SettingsCampaignShell pageMode="settings" />
    </SettingsCampaignBoundary>
  );
}
