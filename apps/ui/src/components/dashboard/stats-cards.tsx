'use client';

const stats = [
  {
    label: 'PRs Reviewed',
    value: '1,248',
    change: '+12%',
    trend: 'up' as const,
    color: 'blue' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
        <path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>
      </svg>
    ),
  },
  {
    label: 'Issues Found',
    value: '342',
    change: '-8%',
    trend: 'down' as const,
    color: 'amber' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  {
    label: 'Auto-Fixed',
    value: '189',
    change: '+34%',
    trend: 'up' as const,
    color: 'green' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    ),
  },
  {
    label: 'Avg Review Time',
    value: '4.2m',
    change: '-22%',
    trend: 'up' as const,
    color: 'cyan' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
  {
    label: 'Security Score',
    value: '98.2',
    change: '+1.4',
    trend: 'up' as const,
    color: 'purple' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
];

const colorMap = {
  blue: { glow: 'glow-blue', border: 'border-accent-blue/20', icon: 'bg-accent-blue/15 text-accent-blue' },
  cyan: { glow: 'glow-cyan', border: 'border-accent-cyan/20', icon: 'bg-accent-cyan/15 text-accent-cyan' },
  green: { glow: 'glow-green', border: 'border-accent-green/20', icon: 'bg-accent-green/15 text-accent-green' },
  amber: { glow: '', border: 'border-accent-amber/20', icon: 'bg-accent-amber/15 text-accent-amber' },
  red: { glow: '', border: 'border-accent-red/20', icon: 'bg-accent-red/15 text-accent-red' },
  purple: { glow: 'glow-purple', border: 'border-accent-purple/20', icon: 'bg-accent-purple/15 text-accent-purple' },
};

function StatCard({ label, value, change, trend, icon, color }: typeof stats[0]) {
  const cm = colorMap[color];
  const trendColor = trend === 'up' ? 'text-accent-green' : trend === 'down' ? 'text-accent-red' : 'text-text-muted';
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

  return (
    <div className={`skeuo-card glass-panel-hover p-4 ${cm.glow} border ${cm.border}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cm.icon}`}>
          {icon}
        </div>
        {change && (
          <span className={`text-xs font-semibold ${trendColor}`}>
            {trendSymbol} {change}
          </span>
        )}
      </div>
      <div className="number-stat text-2xl font-bold text-text-primary tracking-tight">{value}</div>
      <div className="text-xs text-text-muted mt-1">{label}</div>
    </div>
  );
}

export function StatsRow() {
  return (
    <div className="grid grid-cols-5 gap-4">
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}
