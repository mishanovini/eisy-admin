/**
 * Main application shell — sidebar + content area + status bar.
 * Handles auth gating: shows LoginScreen if not connected.
 */
import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useConnectionStore } from '@/stores/connection-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { useUIStore } from '@/stores/ui-store.ts';
import { usePortalStore } from '@/stores/portal-store.ts';
import { useWebSocket } from '@/hooks/useWebSocket.ts';
import { useKBCapture } from '@/hooks/useKBCapture.ts';
import { registerKBCaptureAI } from '@/ai/kb-capture.ts';
import { sendChatMessage } from '@/ai/provider.ts';
import { LoginScreen } from '@/components/auth/LoginScreen.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { SearchPalette } from '@/components/common/SearchPalette.tsx';
import { AIChatPanel } from '@/components/ai/AIChatPanel.tsx';
import { IconLegend } from '@/components/common/IconLegend.tsx';
import { KBCaptureToast } from '@/components/common/KBCaptureToast.tsx';
import { SceneWriteToast } from '@/components/common/SceneWriteToast.tsx';
import { ActionApprovalOverlay } from '@/components/common/ActionApprovalOverlay.tsx';
import { UpdateBanner } from '@/components/common/UpdateBanner.tsx';
import { useUpdateStore } from '@/services/update-service.ts';
import { useIssueStore } from '@/stores/issue-store.ts';
import { useEisyLogStore } from '@/stores/eisy-log-store.ts';

// Page components (placeholder implementations until their blocks)
import { DashboardPage } from '@/components/dashboard/Dashboard.tsx';
import { DevicesPage } from '@/components/devices/DevicesPage.tsx';
import { ScenesPage } from '@/components/scenes/ScenesPage.tsx';
import { ProgramsPage } from '@/components/programs/ProgramsPage.tsx';
import { LogsPage } from '@/components/logs/LogsPage.tsx';
import { NetworkPage } from '@/components/network/NetworkPage.tsx';
import { SettingsPage } from '@/components/settings/SettingsPage.tsx';
import { Troubleshooter } from '@/components/troubleshoot/Troubleshooter.tsx';
import { ScheduleCalendar } from '@/components/schedule/ScheduleCalendar.tsx';
import { KnowledgeBase } from '@/components/integration/KnowledgeBase.tsx';
import { BatteriesPage } from '@/components/batteries/BatteriesPage.tsx';

export function AppShell() {
  const status = useConnectionStore((s) => s.status);
  const fetchDevices = useDeviceStore((s) => s.fetchAll);
  const fetchStatus = useStatusStore((s) => s.fetchAll);
  const fetchPrograms = useProgramStore((s) => s.fetchAll);
  const restoreUI = useUIStore((s) => s.restore);

  // Restore UI preferences on mount
  useEffect(() => {
    restoreUI();
  }, [restoreUI]);

  // Connect WebSocket when authenticated
  useWebSocket();

  // Activate KB auto-capture channels
  useKBCapture();

  // Register AI callback for KB capture research (once on mount)
  useEffect(() => {
    registerKBCaptureAI(sendChatMessage);
  }, []);

  // Load initial data once connected
  useEffect(() => {
    if (status === 'connected') {
      fetchDevices();
      fetchStatus();
      fetchPrograms();
      // Auto-restore portal connection if credentials were saved
      usePortalStore.getState().restore();
      // Check for app updates on startup (non-blocking)
      useUpdateStore.getState().checkForUpdate();
      // Load issue reports and sync statuses from GitHub (non-blocking)
      useIssueStore.getState().loadReports().then(() => {
        useIssueStore.getState().syncStatuses();
      });
      // Initialize eisy event log capture — sets debug level + single fetch.
      // Continuous polling only happens while the Logs page is open.
      useEisyLogStore.getState().init(1);
    }
  }, [status, fetchDevices, fetchStatus, fetchPrograms]);

  // Show login screen if not connected
  if (status !== 'connected') {
    return <LoginScreen />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <UpdateBanner />
          <SearchPalette />
          <main className="flex-1 overflow-y-auto p-3 sm:p-4">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/devices/*" element={<DevicesPage />} />
              <Route path="/scenes/*" element={<ScenesPage />} />
              <Route path="/programs/*" element={<ProgramsPage />} />
              <Route path="/batteries" element={<BatteriesPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/network" element={<NetworkPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/troubleshoot" element={<Troubleshooter />} />
              <Route path="/schedule" element={<ScheduleCalendar />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
            </Routes>
          </main>
        </div>
      </div>
      <StatusBar />
      <AIChatPanel />
      <IconLegend />
      <SceneWriteToast />
      <KBCaptureToast />
      <ActionApprovalOverlay />
    </div>
  );
}
