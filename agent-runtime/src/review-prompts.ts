import type { LLMMessage } from './llm-provider';

export interface ReviewContext {
  diff: string;
  findings: Array<{
    type: string;
    severity: string;
    description: string;
    file: string;
    line: number;
  }>;
  mode: 'vibe' | 'engineer' | 'security';
  prTitle?: string;
  prDescription?: string;
  language?: string;
}

function buildSystemPrompt(mode: ReviewContext['mode']): string {
  switch (mode) {
    case 'vibe':
      return `You are a friendly code reviewer for CodeNexus. Explain findings in plain language that any developer can understand. Focus on business impact and what the user should do next. Keep responses concise and actionable.`;
    case 'engineer':
      return `You are a technical code reviewer for CodeNexus. Provide detailed analysis with code references, root causes, and concrete fix suggestions. Reference line numbers, files, and architectural patterns. Be precise and thorough.`;
    case 'security':
      return `You are a security-focused code reviewer for CodeNexus. Prioritize security vulnerabilities, trust boundary violations, auth bypasses, and data exposure risks. Flag every finding with severity and CWE mapping where applicable.`;
  }
}

export function buildReviewPrompt(context: ReviewContext): { messages: LLMMessage[]; stopTokens: number } {
  const findingsText = context.findings.length > 0
    ? `## Scanner Findings (${context.findings.length} issues)\n` +
      context.findings.map((f, i) =>
        `${i + 1}. [${f.severity.toUpperCase()}] ${f.type} in ${f.file}:${f.line} — ${f.description}`
      ).join('\n')
    : 'No automated scanner findings detected.';

  const diffPreview = context.diff.length > 8000
    ? context.diff.slice(0, 8000) + '\n... (truncated)'
    : context.diff;

  const systemPrompt = buildSystemPrompt(context.mode);

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `## PR: ${context.prTitle || 'Untitled'}`,
          context.prDescription ? `\n${context.prDescription}\n` : '',
          findingsText,
          `\n## Code Diff\n\`\`\`${context.language || 'diff'}`,
          diffPreview,
          '```',
          `\n\nFor each finding above:`,
          `1. Explain *why* it matters`,
          `2. Suggest a concrete fix with code example`,
          `3. Flag anything the scanners might have missed`,
          `4. Rate confidence (high/medium/low)`,
        ].join('\n'),
      },
    ],
    stopTokens: context.diff.length * 2 + 1000,
  };
}

export function buildBlindSpotPrompt(context: ReviewContext): LLMMessage[] {
  return [
    { role: 'system', content: 'You are identifying what automated scanners might have missed in this code review.' },
    {
      role: 'user',
      content: `Given this PR context and scanner findings, list 3-5 things the scanners might have missed:\n\n` +
        `Title: ${context.prTitle}\n` +
        `Language: ${context.language}\n` +
        `Findings: ${context.findings.length} detected\n` +
        `Diff (first 4000 chars):\n${context.diff.slice(0, 4000)}`,
    },
  ];
}

export function buildFixPrompt(finding: ReviewContext['findings'][0], fileContent: string): LLMMessage[] {
  return [
    { role: 'system', content: 'You generate concrete code fixes for review findings. Output only the fix with a brief explanation.' },
    {
      role: 'user',
      content: [
        `Fix this finding:`,
        `- Type: ${finding.type}`,
        `- Severity: ${finding.severity}`,
        `- Description: ${finding.description}`,
        `- File: ${finding.file}:${finding.line}`,
        `\nFile content:\n\`\`\`\n${fileContent.slice(0, 6000)}\n\`\`\``,
        `\nProvide the exact code change needed.`,
      ].join('\n'),
    },
  ];
}
