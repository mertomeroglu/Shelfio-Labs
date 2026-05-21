import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AccessRequestsAdmin from '../access-requests-admin/AccessRequestsAdmin.jsx';

const listRequestsMock = vi.fn();
const rejectRequestMock = vi.fn();
const bulkActionMock = vi.fn();

vi.mock('../../services/accessService.js', () => ({
  accessService: {
    listRequests: (...args) => listRequestsMock(...args),
    rejectRequest: (...args) => rejectRequestMock(...args),
    bulkAction: (...args) => bulkActionMock(...args),
    approveRequest: vi.fn(),
    extendRequest: vi.fn(),
    revokeGrant: vi.fn(),
  },
}));

const sampleRows = [
  {
    id: 'req-1',
    userId: 'u-1',
    requesterName: 'Test Kullanici',
    permission: 'purchase:approve',
    storeId: 'S1',
    status: 'pending',
    riskLevel: 'medium',
    reason: 'Test nedeni',
    createdAt: '2026-04-20T09:00:00.000Z',
    requestedDurationMinutes: 120,
    auditTrail: [
      {
        id: 'audit-1',
        action: 'Talep Olusturuldu',
        actorName: 'Test Kullanici',
        createdAt: '2026-04-20T09:00:00.000Z',
      },
    ],
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AccessRequestsAdmin />
    </MemoryRouter>
  );
}

describe('AccessRequestsAdmin', () => {
  beforeEach(() => {
    listRequestsMock.mockResolvedValue(sampleRows);
    rejectRequestMock.mockResolvedValue({ ok: true });
    bulkActionMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Geçmiş butonunda tekrarli aç/kapat etkileşiminde stabil kalir', async () => {
    const user = userEvent.setup();
    renderPage();

    const historyButton = await screen.findByRole('button', { name: /geçmiş/i });

    for (let index = 0; index < 6; index += 1) {
      await user.click(historyButton);
    }

    expect(screen.queryByText(/talep olusturuldu/i)).not.toBeInTheDocument();

    await user.click(historyButton);
    expect(await screen.findByText(/talep olusturuldu/i)).toBeInTheDocument();

    await user.click(historyButton);
    await waitFor(() => {
      expect(screen.queryByText(/talep olusturuldu/i)).not.toBeInTheDocument();
    });
  });

  it('Red onayi modalinda açilis, kapanis ve submit akisi çalisir', async () => {
    const user = userEvent.setup();
    renderPage();

    const rejectActionButton = await screen.findByRole('button', { name: /^reddet$/i });
    await user.click(rejectActionButton);

    const modalTitle = await screen.findByRole('heading', { name: /red onayı/i });
    expect(modalTitle).toBeInTheDocument();

    const noteField = screen.getByRole('textbox', { name: /red nedeni/i });
    await user.type(noteField, 'Uygun degil');

    const closeButton = screen.getByRole('button', { name: /vazgeç/i });
    await user.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /red onayı/i })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^reddet$/i }));
    const reopenTitle = await screen.findByRole('heading', { name: /red onayı/i });
    const modalCard = reopenTitle.closest('.modal-card');
    expect(modalCard).toBeTruthy();

    await user.type(within(modalCard).getByRole('textbox', { name: /red nedeni/i }), 'Politika uyumsuz');
    await user.click(within(modalCard).getByRole('button', { name: /^reddet$/i }));

    await waitFor(() => {
      expect(rejectRequestMock).toHaveBeenCalledWith('req-1', { note: 'Politika uyumsuz' });
    });
  });
});
