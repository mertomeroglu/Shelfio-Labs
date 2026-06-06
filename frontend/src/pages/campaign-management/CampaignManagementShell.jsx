import { useLocation } from 'react-router-dom';
import SettingsCampaignBoundary from '../_shared/settings-campaign-shell/SettingsCampaignBoundary.jsx';
import SettingsCampaignShell from '../_shared/settings-campaign-shell/SettingsCampaignShell.jsx';

export default function CampaignManagementShell() {
  const location = useLocation();

  return (
    <SettingsCampaignBoundary mode="campaign" resetKey={location.key}>
      <SettingsCampaignShell pageMode="campaign" />
    </SettingsCampaignBoundary>
  );
}
