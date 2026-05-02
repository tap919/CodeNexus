'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';

const MOCK_DATA = [
  { day: 'Mon', reviews: 12, fixes: 8, escalations: 2 },
  { day: 'Tue', reviews: 15, fixes: 11, escalations: 3 },
  { day: 'Wed', reviews: 18, fixes: 14, escalations: 1 },
  { day: 'Thu', reviews: 14, fixes: 10, escalations: 4 },
  { day: 'Fri', reviews: 20, fixes: 16, escalations: 2 },
  { day: 'Sat', reviews: 8, fixes: 6, escalations: 1 },
  { day: 'Sun', reviews: 5, fixes: 4, escalations: 0 },
];

export function ReviewTrendChart() {
  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle">
      <h3 className="text-sm font-medium text-fg-primary mb-3">Review Throughput</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={MOCK_DATA} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3A3737" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#B7B1B1' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#B7B1B1' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#2A2727', border: '1px solid #3A3737', borderRadius: 8, fontSize: 12, color: '#F1ECEC' }}
            />
            <Line type="monotone" dataKey="reviews" stroke="#3B82F6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="fixes" stroke="#22C55E" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="escalations" stroke="#F59E0B" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-2 justify-center">
        <span className="text-[10px] text-fg-muted flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-intent-action inline-block" /> Reviews</span>
        <span className="text-[10px] text-fg-muted flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-intent-success inline-block" /> Fixes</span>
        <span className="text-[10px] text-fg-muted flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-intent-warning inline-block" /> Escalations</span>
      </div>
    </div>
  );
}
