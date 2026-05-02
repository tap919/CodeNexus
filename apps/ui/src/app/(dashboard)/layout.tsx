'use client';

import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/ui-store';
import { TopBar } from '@/components/shell/top-bar';
import { LeftRail } from '@/components/shell/left-rail';
import { RightRail } from '@/components/shell/right-rail';
import { CommandPalette } from '@/components/shell/command-palette';
import { useAuth } from '@/providers/auth-provider';
import { LoginScreen } from '@/components/shell/login-screen';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { leftPanelOpen, rightPanelOpen } = useUIStore();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-intent-action border-t-transparent rounded-full animate-spin" />
          <span className="text-fg-muted text-sm">Loading CodeNexus...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="h-screen flex flex-col bg-canvas overflow-hidden">
      <TopBar />
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          {leftPanelOpen && (
            <>
              <Panel defaultSize={15} minSize={12} maxSize={20}>
                <LeftRail />
              </Panel>
              <PanelResizeHandle className="w-px bg-border-subtle hover:bg-intent-action transition-colors" />
            </>
          )}
          <Panel defaultSize={leftPanelOpen ? (rightPanelOpen ? 60 : 85) : (rightPanelOpen ? 75 : 100)} minSize={40}>
            <main className="h-full overflow-y-auto p-6">{children}</main>
          </Panel>
          {rightPanelOpen && (
            <>
              <PanelResizeHandle className="w-px bg-border-subtle hover:bg-intent-action transition-colors" />
              <Panel defaultSize={25} minSize={18} maxSize={35}>
                <RightRail />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <CommandPalette />
    </div>
  );
}
