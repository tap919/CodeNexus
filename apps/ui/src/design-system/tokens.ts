export const tokens = {
  canvas: '#211E1E',
  surface: '#2A2727',
  surfaceElevated: '#322F2F',
  fgPrimary: '#F1ECEC',
  fgMuted: '#B7B1B1',
  borderSubtle: '#3A3737',
  borderDefault: '#656363',
  action: '#3B82F6',
  warning: '#F59E0B',
  critical: '#EF4444',
  evidence: '#06B6D4',
  success: '#22C55E',
} as const;

export const severityColor = {
  critical: tokens.critical,
  high: '#F87171',
  medium: tokens.warning,
  low: tokens.fgMuted,
  info: tokens.evidence,
} as const;

export const confidenceColor = {
  high: tokens.success,
  medium: tokens.warning,
  low: tokens.critical,
  none: tokens.fgMuted,
} as const;
