'use client';

interface StatCardProps {
  label: string;
  value: number | string;
  change?: string;
  trend?: 'up' | 'down' | 'stable';
  icon: string;
  color: 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'purple';
}

const colorMap = {
  blue: 'glow-blue border-accent-blue/20',
  cyan: 'glow-cyan border-accent-cyan/20',
  green: 'glow-green border-accent-green/20',
  amber: 'border-accent-amber/20',
  red: 'border-accent-red/20',
  purple: 'glow-purple border-accent-purple/20',
};

const bgMap = {
  blue: 'bg-accent-blue/10 text-accent-blue',
  cyan: 'bg-accent-cyan/10 text-accent-cyan',
  green: 'bg-accent-green/10 text-accent-green',
  amber: 'bg-accent-amber/10 text-accent-amber',
  red: 'bg-accent-red/10 text-accent-red',
  purple: 'bg-accent-purple/10 text-accent-purple',
};

export function StatCard({ label, value, change, trend, icon, color }: StatCardProps) {
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const trendColor = trend === 'up' ? 'text-accent-green' : trend === 'down' ? 'text-accent-red' : 'text-text-muted';

  return (
    <div className={`skeuo-card p-4 animate-scale-in ${colorMap[color]}`}>
      <div className="flex items-start justify-between mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${bgMap[color]}`}>
          {icon}
        </span>
        {change && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${trendColor}`}>
            {trendSymbol} {change}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-text-primary tracking-tight number-stat">{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  );
}

export function StatsRow() {
  return (
    <div className="grid grid-cols-5 gap-3">
      <StatCard icon="◎" label="Open Reviews" value={24} change="12%" trend="up" color="blue" />
      <StatCard icon="⬡" label="At-Risk PRs" value={5} change="2%" trend="down" color="red" />
      <StatCard icon="◈" label="Escalations" value={3} color="amber" />
      <StatCard icon="✓" label="Healthy" value="87" change="5%" trend="up" color="green" />
      <StatCard icon="◉" label="Active Agents" value={3} trend="stable" color="purple" />
    </div>
  );
}
