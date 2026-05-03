'use client';

interface Alert {
  id: string;
  repo: string;
  pr: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  time: string;
}

const alerts: Alert[] = [
  { id: '1', repo: 'codenexus/auth-service', pr: '#142', title: 'Auth race condition detected in session handler', severity: 'critical', time: '2m ago' },
  { id: '2', repo: 'codenexus/security', pr: '#138', title: 'Security middleware bypass via token refresh', severity: 'high', time: '10m ago' },
  { id: '3', repo: 'codenexus/shared', pr: '#140', title: 'Build failed after shared type change', severity: 'medium', time: '30m ago' },
  { id: '4', repo: 'codenexus/knowledge', pr: '#135', title: 'KB engine path traversal fix merged', severity: 'low', time: '1h ago' },
];

const sevColor = { critical: 'tag-red', high: 'tag-amber', medium: 'tag-cyan', low: 'tag-green' };

export function OverviewTab() {
  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">System Overview</h2>
          <p className="text-xs text-text-muted mt-0.5">Real-time monitoring dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-base-800 border border-base-600/30">
            <span className="status-dot online" />
            <span className="text-xs text-text-secondary font-medium">Live</span>
          </div>
        </div>
      </div>

      {/* Health meters */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'System Health', value: 98, color: '#4ade80' },
          { label: 'Build Health', value: 78, color: '#fbbf24' },
          { label: 'Security Score', value: 87, color: '#4dabf7' },
          { label: 'Coverage', value: 72, color: '#a78bfa' },
        ].map((item) => (
          <div key={item.label} className="skeuo-card p-4">
            <p className="text-xs text-text-muted mb-2">{item.label}</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-text-primary number-stat">{item.value}</span>
              <span className="text-xs text-text-muted mb-0.5">/100</span>
            </div>
            <div className="mt-2 progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${item.value}%`, background: item.color, boxShadow: `0 0 8px ${item.color}40` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Alerts timeline */}
      <div className="skeuo-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">Recent Alerts</h3>
          <span className="tag-amber text-[10px]">4 active</span>
        </div>
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <div
              key={alert.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-base-800/50 hover:bg-base-700/50 transition-all cursor-pointer border border-transparent hover:border-base-600/30 animate-slide-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                alert.severity === 'critical' ? 'bg-accent-red animate-breathe' :
                alert.severity === 'high' ? 'bg-accent-amber' :
                alert.severity === 'medium' ? 'bg-accent-cyan' : 'bg-accent-green'
              }`} style={alert.severity === 'critical' ? { animation: 'breathe 2s ease-in-out infinite' } : {}} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{alert.title}</p>
                <p className="text-[11px] text-text-muted font-mono">{alert.repo} · {alert.pr}</p>
              </div>
              <span className={`tag ${sevColor[alert.severity]}`}>{alert.severity}</span>
              <span className="text-[10px] text-text-muted w-12 text-right">{alert.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
