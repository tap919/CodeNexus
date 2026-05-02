/**
 * CodeNexus Design Reviewer
 *
 * Fused from impeccable's design review engine. Provides 24+
 * anti-pattern detection rules across HTML, CSS, and typography,
 * design system token extraction, severity classification, and
 * scoring. Exposes 8 commands: critique, audit, polish, distill,
 * animate, colorize, typeset, and layout.
 *
 * ```ts
 * import { DesignReviewer } from '@codenexus/design-reviewer';
 * const reviewer = new DesignReviewer();
 * const result = reviewer.critique('<div style="color: #000">...</div>', 'html');
 * ```
 */

import type {
  DesignAudit,
  AntiPattern,
  DesignSystem,
  TypographyTokens,
  SpacingTokens,
  ComponentTokens,
  Severity,
} from '../../shared/src/types.js';

// ─── Re-exports ───────────────────────────────────────────────

export type {
  DesignAudit,
  AntiPattern,
  DesignSystem,
  TypographyTokens,
  SpacingTokens,
  ComponentTokens,
} from '../../shared/src/types.js';

// ─── Anti-Pattern Definitions ─────────────────────────────────

export interface AntiPatternRule {
  name: string;
  category: AntiPatternCategory;
  severity: Severity;
  description: string;
  fix: string;
  detect: (input: string) => AntiPatternMatch[];
}

export interface AntiPatternMatch {
  element: string;
  description: string;
  fix: string;
  lineNumber: number;
  context: string;
}

export type AntiPatternCategory =
  | 'typography'
  | 'color'
  | 'spacing'
  | 'layout'
  | 'accessibility'
  | 'animation'
  | 'components'
  | 'responsive';

// ─── Scoring Constants ────────────────────────────────────────

const SEVERITY_PENALTIES: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 1,
};

const MAX_SCORE = 100;

// ─── HTML/CSS Scanning Regex Patterns ─────────────────────────

const REGEX_PATTERNS = {
  // Inline styles
  inlineStyle: /style\s*=\s*["']([^"']*)["']/gi,
  styleTag: /<style[^>]*>([\s\S]*?)<\/style>/gi,
  styleTagAttr: /<style[^>]*/gi,
  classAttr: /class\s*=\s*["']([^"']*)["']/gi,

  // Color patterns
  hexColor: /#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
  rgbColor: /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/gi,
  rgbaColor: /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)/gi,
  namedColor: /\b(white|black|gray|grey|red|blue|green|transparent)\b/gi,

  // Font patterns
  fontFamily: /font-family\s*:\s*([^;}]+)/gi,
  fontSize: /font-size\s*:\s*([^;}]+)/gi,
  fontWeight: /font-weight\s*:\s*([^;}]+)/gi,
  lineHeight: /line-height\s*:\s*([^;}]+)/gi,

  // Spacing patterns
  padding: /padding\s*:\s*([^;}]+)/gi,
  paddingTop: /padding-top\s*:\s*([^;}]+)/gi,
  paddingBottom: /padding-bottom\s*:\s*([^;}]+)/gi,
  paddingLeft: /padding-left\s*:\s*([^;}]+)/gi,
  paddingRight: /padding-right\s*:\s*([^;}]+)/gi,
  margin: /margin\s*:\s*([^;}]+)/gi,
  gap: /gap\s*:\s*([^;}]+)/gi,

  // Layout patterns
  display: /display\s*:\s*([^;}]+)/gi,
  position: /position\s*:\s*([^;}]+)/gi,
  width: /width\s*:\s*([^;}]+)/gi,
  maxWidth: /max-width\s*:\s*([^;}]+)/gi,
  zIndex: /z-index\s*:\s*([^;}]+)/gi,
  overflow: /overflow\s*:\s*([^;}]+)/gi,

  // Animation patterns
  transition: /transition\s*:\s*([^;}]+)/gi,
  animation: /animation\s*:\s*([^;}]+)/gi,
  animationTiming: /animation-timing-function\s*:\s*([^;}]+)/gi,
  transitionTiming: /transition-timing-function\s*:\s*([^;}]+)/gi,
  transform: /transform\s*:\s*([^;}]+)/gi,

  // Accessibility patterns
  ariaLabel: /aria-label\s*=/gi,
  ariaLabelledby: /aria-labelledby\s*=/gi,
  role: /role\s*=\s*["']([^"']*)["']/gi,
  altAttr: /alt\s*=\s*["']/gi,
  headingTag: /<h([1-6])[^>]*>/gi,
  tabIndex: /tabindex\s*=\s*["']?(-?\d+)["']?/gi,

  // Component patterns
  button: /<button[^>]*>([\s\S]*?)<\/button>/gi,
  input: /<input[^>]*>/gi,
  anchor: /<a[^>]*>([\s\S]*?)<\/a>/gi,
  img: /<img[^>]*>/gi,
  cardClass: /class\s*=\s*["'][^"']*\bcard\b[^"']*["']/gi,
  nestedCard: /class\s*=\s*["'][^"']*\b(card|panel|box)\b[^"']*["'].*class\s*=\s*["'][^"']*\b(card|panel|box)\b[^"']*["']/gis,
};

// ─── Anti-Pattern Rules (24+) ─────────────────────────────────

const ANTI_PATTERN_RULES: AntiPatternRule[] = [
  // ── Typography (5 rules) ────────────────────────────────
  {
    name: 'Overused decorative fonts',
    category: 'typography',
    severity: 'medium' as Severity,
    description: 'More than 2 font families are used, creating visual chaos and inconsistency.',
    fix: 'Limit your design to at most 2 font families (one for headings, one for body). Use a single type scale.',
    detect: (input: string): AntiPatternMatch[] => {
      const families = new Set<string>();
      const matches: AntiPatternMatch[] = [];
      let match: RegExpExecArray | null;
      const re = new RegExp(REGEX_PATTERNS.fontFamily.source, 'gi');
      while ((match = re.exec(input)) !== null) {
        const names = match[1].split(',').map(s => s.trim().replace(/["']/g, ''));
        names.forEach(n => families.add(n.toLowerCase()));
      }
      if (families.size > 2) {
        matches.push({
          element: 'CSS font-family declarations',
          description: `${families.size} different font families detected.`,
          fix: 'Reduce to 2 font families (heading + body).',
          lineNumber: countLinesBefore(input, input.indexOf('font-family')),
          context: Array.from(families).join(', '),
        });
      }
      return matches;
    },
  },
  {
    name: 'Skipped heading levels',
    category: 'typography',
    severity: 'high' as Severity,
    description: 'Heading levels jump (e.g., h1 → h3) which breaks document outline and accessibility.',
    fix: 'Ensure heading levels increment by at most 1 (h1 → h2 → h3). Do not skip levels.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = new RegExp(REGEX_PATTERNS.headingTag.source, 'gi');
      let match: RegExpExecArray | null;
      const levels: number[] = [];
      while ((match = re.exec(input)) !== null) {
        levels.push(parseInt(match[1], 10));
      }
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
          matches.push({
            element: `h${levels[i]}`,
            description: `Heading jumps from h${levels[i - 1]} to h${levels[i]}.`,
            fix: `Change h${levels[i]} to h${levels[i - 1] + 1} or restructure the outline.`,
            lineNumber: countLinesBefore(input, input.indexOf(`<h${levels[i]}`)),
            context: `h${levels[i - 1]} → h${levels[i]}`,
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Excessive line length',
    category: 'typography',
    severity: 'medium' as Severity,
    description: 'Line length exceeds 80 characters, reducing readability.',
    fix: 'Limit line length to 60–80 characters. Set max-width on text containers (e.g., 65ch).',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = new RegExp(REGEX_PATTERNS.maxWidth.source, 'gi');
      let match: RegExpExecArray | null;
      let hasMaxWidth = false;
      while ((match = re.exec(input)) !== null) {
        hasMaxWidth = true;
      }
      if (!hasMaxWidth) {
        matches.push({
          element: 'Text container',
          description: 'No max-width constraint on text content — lines could be excessively long.',
          fix: 'Add max-width: 65ch (or 60–80ch) to your main content containers.',
          lineNumber: 1,
          context: 'Missing max-width on text elements',
        });
      }
      return matches;
    },
  },
  {
    name: 'Cramped line height',
    category: 'typography',
    severity: 'medium' as Severity,
    description: 'Line-height below 1.5 for body text makes it hard to read.',
    fix: 'Use line-height: 1.5–1.8 for body text and 1.2–1.4 for headings.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = new RegExp(REGEX_PATTERNS.lineHeight.source, 'gi');
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        const lh = match[1].trim();
        const val = parseFloat(lh);
        if (!isNaN(val) && val > 0 && val < 1.4) {
          matches.push({
            element: `line-height: ${lh}`,
            description: `Line height of ${lh} is too cramped for body text.`,
            fix: 'Increase line-height to at least 1.5 for body copy.',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0],
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Small font size for body text',
    category: 'typography',
    severity: 'medium' as Severity,
    description: 'Body text font-size below 14px compromises readability.',
    fix: 'Use at least 16px (1rem) for body text. Avoid going below 14px.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = new RegExp(REGEX_PATTERNS.fontSize.source, 'gi');
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        const fs = match[1].trim();
        const val = parseFloat(fs);
        if (fs.includes('px') && !isNaN(val) && val < 14) {
          matches.push({
            element: `font-size: ${fs}`,
            description: `Body text at ${fs} is too small.`,
            fix: 'Increase to at least 14px; 16px is recommended for body text.',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0],
          });
        }
      }
      return matches;
    },
  },

  // ── Color (5 rules) ────────────────────────────────────
  {
    name: 'Pure black text (#000)',
    category: 'color',
    severity: 'medium' as Severity,
    description: 'Pure black (#000) on white creates excessive contrast that causes eye strain.',
    fix: 'Use a dark gray (#1a1a1a, #2c2c2c, or #333) instead of pure black for body text.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /color\s*:\s*(?:#[fF]{3}|#[0]{3,6}|black)\b/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        matches.push({
          element: match[0],
          description: 'Pure black (#000) text detected — causes eye strain on white backgrounds.',
          fix: 'Replace with a dark gray like #1a1a1a, #2c2c2c, or #333.',
          lineNumber: countLinesBefore(input, match.index),
          context: match[0],
        });
      }
      return matches;
    },
  },
  {
    name: 'Pure gray text on colored background',
    category: 'color',
    severity: 'high' as Severity,
    description: 'Gray text on a colored or dark background often fails WCAG contrast requirements.',
    fix: 'Lighten gray text on dark backgrounds or darken it on light backgrounds to ensure 4.5:1 contrast ratio.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /color\s*:\s*(?:#[89a-fA-F][0-9a-fA-F]{2}|rgb\(\s*(?:12[8-9]|1[3-9]\d|2[0-4]\d|25[0-5])\s*,)/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        matches.push({
          element: match[0],
          description: 'Gray/mid-tone text may lack sufficient contrast on certain backgrounds.',
          fix: 'Test contrast ratio with a WCAG tool. Adjust color to meet 4.5:1 minimum contrast.',
          lineNumber: countLinesBefore(input, match.index),
          context: match[0],
        });
      }
      return matches;
    },
  },
  {
    name: 'Insufficient color contrast',
    category: 'color',
    severity: 'high' as Severity,
    description: 'Low-contrast text fails WCAG AA (4.5:1 for normal text).',
    fix: 'Ensure a minimum 4.5:1 contrast ratio for normal text and 3:1 for large text against its background.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const lowContrastColors = /color\s*:\s*(#[cCdD][0-9a-fA-F]{2}|#[89aAbB][0-9a-fA-F]{2}|rgb\(\s*1[0-5]\d\s*,)/gi;
      let match: RegExpExecArray | null;
      while ((match = lowContrastColors.exec(input)) !== null) {
        matches.push({
          element: match[0],
          description: 'Light-colored text may fail WCAG AA contrast requirements.',
          fix: 'Darken text color or adjust background to achieve 4.5:1 contrast ratio.',
          lineNumber: countLinesBefore(input, match.index),
          context: match[0],
        });
      }
      return matches;
    },
  },
  {
    name: 'Pure black background',
    category: 'color',
    severity: 'low' as Severity,
    description: 'Pure black backgrounds (#000) can obscure depth and hierarchy.',
    fix: 'Use very dark grays (#111, #1a1a1a, #222) for backgrounds instead of pure black.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /background(?:-color)?\s*:\s*(?:#[fF]{3}|#[0]{3,6}|black)\b/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        matches.push({
          element: match[0],
          description: 'Pure black background — use a very dark gray instead.',
          fix: 'Replace with #111, #1a1a1a, or #222 for better depth perception.',
          lineNumber: countLinesBefore(input, match.index),
          context: match[0],
        });
      }
      return matches;
    },
  },
  {
    name: 'Overuse of bright/saturated colors',
    category: 'color',
    severity: 'medium' as Severity,
    description: 'Highly saturated colors used for large areas cause visual fatigue.',
    fix: 'Reserve saturated colors for accents and interactive elements. Use muted/desaturated tones for large areas.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /color\s*:\s*(#[fF][0-9a-fA-F]{2}|#[eE][0-9a-fA-F]{2}|rgb\(\s*2[45]\d\s*,)/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        matches.push({
          element: match[0],
          description: 'Highly saturated color used — may cause visual fatigue in large areas.',
          fix: 'Use saturated colors only for accents. Mute large-area colors by reducing saturation.',
          lineNumber: countLinesBefore(input, match.index),
          context: match[0],
        });
      }
      return matches;
    },
  },

  // ── Spacing (4 rules) ──────────────────────────────────
  {
    name: 'Cramped padding',
    category: 'spacing',
    severity: 'medium' as Severity,
    description: 'Elements with less than 8px padding feel cramped and lack visual breathing room.',
    fix: 'Use at least 12–16px padding for containers, 8px minimum for small elements.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /padding\s*:\s*(\d+)px/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        const val = parseInt(match[1], 10);
        if (val < 8) {
          matches.push({
            element: `padding: ${match[1]}px`,
            description: `Padding of ${match[1]}px is too cramped.`,
            fix: 'Increase padding to at least 8px (12–16px recommended for containers).',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0],
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Inconsistent spacing rhythm',
    category: 'spacing',
    severity: 'medium' as Severity,
    description: 'Spacing values do not follow a consistent scale, creating visual noise.',
    fix: 'Define a spacing scale (e.g., 4, 8, 12, 16, 24, 32, 48, 64px) and stick to it throughout the design.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const allValues = new Set<number>();
      const re = /(padding|margin|gap)\s*:\s*(\d+)px/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        allValues.add(parseInt(match[2], 10));
      }
      const standardScale = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];
      const nonStandard = Array.from(allValues).filter(v => !standardScale.includes(v) && v > 0);
      if (nonStandard.length > 3) {
        matches.push({
          element: 'Multiple spacing declarations',
          description: `${nonStandard.length} non-standard spacing values found: [${nonStandard.join(', ')}]. Inconsistent spacing rhythm.`,
          fix: 'Use a consistent spacing scale (4, 8, 12, 16, 24, 32, 48, 64px).',
          lineNumber: 1,
          context: `Non-standard values: ${nonStandard.join(', ')}`,
        });
      }
      return matches;
    },
  },
  {
    name: 'Small touch targets',
    category: 'spacing',
    severity: 'high' as Severity,
    description: 'Interactive elements (buttons, links) smaller than 44×44px fail mobile usability.',
    fix: 'Ensure touch targets are at least 44×44px. Add padding or min-width/min-height.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const buttonHeight = /<button[^>]*>[\s\S]*?<\/button>/gi;
      const btnMatch = buttonHeight.exec(input);
      if (btnMatch) {
        const btnContent = btnMatch[0];
        const hasMinDim = /min-(height|width)\s*:\s*(?:44|[5-9]\d|1\d{2})px/i.test(btnContent);
        if (!hasMinDim) {
          matches.push({
            element: '<button>',
            description: 'Button may be smaller than 44×44px minimum touch target.',
            fix: 'Add min-height: 44px and min-width: 44px, or sufficient padding (at least 12px).',
            lineNumber: countLinesBefore(input, btnMatch.index),
            context: btnContent.substring(0, 120),
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Missing gap in flex/grid layouts',
    category: 'spacing',
    severity: 'low' as Severity,
    description: 'Flex or grid layouts without gap rely on margins for spacing, which can cause cascading issues.',
    fix: 'Use the gap property on flexbox and grid containers instead of margins on children.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const hasFlexOrGrid = /display\s*:\s*(flex|grid|inline-flex|inline-grid)/gi.test(input);
      const hasGap = /gap\s*:/gi.test(input);
      if (hasFlexOrGrid && !hasGap) {
        matches.push({
          element: 'Flexbox/Grid container',
          description: 'Flex or grid layout without gap property — using margins for spacing is error-prone.',
          fix: 'Add gap (e.g., gap: 16px) to the flex/grid container and remove child margins.',
          lineNumber: 1,
          context: 'Missing gap in flex/grid container',
        });
      }
      return matches;
    },
  },

  // ── Layout (3 rules) ───────────────────────────────────
  {
    name: 'Card nesting without clear hierarchy',
    category: 'layout',
    severity: 'medium' as Severity,
    description: 'Cards, panels, or boxes nested inside each other without visual distinction.',
    fix: 'Avoid nesting cards/panels. Use a single layer of cards and arrange content with typography or dividers.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const cardCount = (input.match(/class\s*=\s*["'][^"']*\b(card|panel|box)\b[^"']*["']/gi) || []).length;
      if (cardCount > 3) {
        matches.push({
          element: 'Multiple card/panel/box elements',
          description: `${cardCount} card-like containers detected — likely nested or excessive.`,
          fix: 'Reduce card nesting. Use at most one card layer per section.',
          lineNumber: 1,
          context: `${cardCount} card/panel/box elements found`,
        });
      }
      return matches;
    },
  },
  {
    name: 'Excessive z-index usage',
    category: 'layout',
    severity: 'low' as Severity,
    description: 'Multiple z-index values above 1000 indicate stacking context mismanagement.',
    fix: 'Keep z-index values low (< 100). Use a z-index scale system (dropdown: 100, modal: 200, toast: 300).',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /z-index\s*:\s*(\d+)/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        const val = parseInt(match[1], 10);
        if (val > 1000) {
          matches.push({
            element: `z-index: ${val}`,
            description: `z-index value of ${val} is excessively high — stacking context management issue.`,
            fix: 'Define a z-index scale system and keep values under 1000.',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0],
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Fixed height on text containers',
    category: 'layout',
    severity: 'high' as Severity,
    description: 'Fixed height on text containers causes text clipping when content overflows.',
    fix: 'Use min-height instead of height, or remove the height constraint entirely.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /height\s*:\s*(\d+)px/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        matches.push({
          element: `height: ${match[1]}px`,
          description: `Fixed height of ${match[1]}px may clip overflow text.`,
          fix: 'Replace with min-height or remove fixed height on text containers.',
          lineNumber: countLinesBefore(input, match.index),
          context: match[0],
        });
      }
      return matches;
    },
  },

  // ── Accessibility (3 rules) ────────────────────────────
  {
    name: 'Missing alt text on images',
    category: 'accessibility',
    severity: 'high' as Severity,
    description: 'Images without alt attributes are invisible to screen readers.',
    fix: 'Add descriptive alt text to every <img> element. Use alt="" for decorative images.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /<img[^>]*>/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        if (!/alt\s*=\s*["']/i.test(match[0])) {
          matches.push({
            element: match[0].substring(0, 80),
            description: 'Image missing alt attribute — invisible to screen readers.',
            fix: 'Add alt="Descriptive text" to the image.',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0].substring(0, 120),
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Missing form labels',
    category: 'accessibility',
    severity: 'high' as Severity,
    description: 'Input fields without associated labels fail accessibility requirements.',
    fix: 'Wrap inputs in <label> elements or use aria-label / aria-labelledby.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /<input[^>]*>/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        const inputEl = match[0];
        if (!/aria-label\s*=/i.test(inputEl) && !/aria-labelledby\s*=/i.test(inputEl)) {
          // Check if it's hidden
          if (!/type\s*=\s*["']hidden["']/i.test(inputEl)) {
            matches.push({
              element: inputEl.substring(0, 80),
              description: 'Input field without accessible label.',
              fix: 'Add aria-label="Field description" or wrap with <label>.',
              lineNumber: countLinesBefore(input, match.index),
              context: inputEl.substring(0, 120),
            });
          }
        }
      }
      return matches;
    },
  },
  {
    name: 'Interactive elements without focus styles',
    category: 'accessibility',
    severity: 'medium' as Severity,
    description: 'No visible focus indicator means keyboard users cannot navigate.',
    fix: 'Add :focus-visible styles (e.g., outline: 2px solid blue) to all interactive elements.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const hasFocusStyle = /:focus|:focus-visible|:focus-within/i.test(input);
      if (!hasFocusStyle && (/\b(button|a\s|input|select|textarea)\b/i.test(input))) {
        matches.push({
          element: 'Interactive elements',
          description: 'No focus styles detected — keyboard navigation will be invisible.',
          fix: 'Add :focus-visible { outline: 2px solid Highlight; } to all interactive elements.',
          lineNumber: 1,
          context: 'Missing :focus styles',
        });
      }
      return matches;
    },
  },

  // ── Animation (2 rules) ────────────────────────────────
  {
    name: 'Bounce or elastic easing on UI elements',
    category: 'animation',
    severity: 'medium' as Severity,
    description: 'Bounce/elastic easing on interface elements feels playful but unprofessional for serious UIs.',
    fix: 'Use ease-out (deceleration) for UI entrances and ease-in-out for cosmetic transitions.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /(animation|transition)-timing-function\s*:\s*(cubic-bezier|ease-out|ease-in-out|ease-in|linear|steps|step-start|step-end)/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        const val = match[2];
        const fullMatch = match[0];
        // Detect bounce-like cubic-bezier
        if (/cubic-bezier\s*\(\s*0\.[6-9]\d*\s*,\s*0/i.test(fullMatch)) {
          matches.push({
            element: match[0],
            description: 'Bounce-like easing curve detected — may feel unprofessional for UI transitions.',
            fix: 'Replace with ease-out (cubic-bezier(0.25, 0.1, 0.25, 1)) or ease-in-out.',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0],
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Excessive transition durations',
    category: 'animation',
    severity: 'low' as Severity,
    description: 'Transitions longer than 300ms feel sluggish for UI interactions.',
    fix: 'Keep UI transitions between 150–300ms. Use longer durations only for entrance animations.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /transition\s*:\s*[^;}]*?(\d+(?:\.\d+)?)s/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        const sec = parseFloat(match[1]);
        if (sec > 0.5) {
          matches.push({
            element: `transition: ${match[0].substring(0, 60)}`,
            description: `Transition duration of ${sec}s is too slow for UI interactions.`,
            fix: 'Reduce UI transition duration to 150–300ms (0.15–0.3s).',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0],
          });
        }
      }
      return matches;
    },
  },

  // ── Components (2 rules) ───────────────────────────────
  {
    name: 'Missing button type attribute',
    category: 'components',
    severity: 'medium' as Severity,
    description: 'Buttons without a type attribute default to "submit", causing accidental form submissions.',
    fix: 'Always set type="button" for non-submit buttons and type="submit" for form submissions.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /<button[^>]*>/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        if (!/type\s*=\s*["'](button|submit|reset)["']/i.test(match[0])) {
          matches.push({
            element: match[0].substring(0, 60),
            description: 'Button missing type attribute — defaults to type="submit".',
            fix: 'Add type="button" for non-submit buttons or type="submit" for form submissions.',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0].substring(0, 120),
          });
        }
      }
      return matches;
    },
  },
  {
    name: 'Links without href',
    category: 'components',
    severity: 'high' as Severity,
    description: 'Anchor elements without href are not keyboard-focusable and may not work as links.',
    fix: 'Always include an href attribute on <a> elements, even if it points to "#" with event handlers.',
    detect: (input: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      const re = /<a\s[^>]*>/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(input)) !== null) {
        if (!/href\s*=\s*["']/i.test(match[0])) {
          matches.push({
            element: match[0].substring(0, 60),
            description: 'Anchor element without href — not keyboard accessible.',
            fix: 'Add href attribute. Use href="#!" if using JavaScript event handlers.',
            lineNumber: countLinesBefore(input, match.index),
            context: match[0].substring(0, 120),
          });
        }
      }
      return matches;
    },
  },
];

// ─── Design System Token Extraction ───────────────────────────

function extractColors(input: string): Record<string, string> {
  const colors: Record<string, string> = {};
  const seen = new Set<string>();
  let idx = 0;

  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = hexRe.exec(input)) !== null) {
    if (!seen.has(match[1].toLowerCase())) {
      seen.add(match[1].toLowerCase());
      colors[`color-${idx++}`] = `#${match[1].toLowerCase()}`;
    }
  }

  // Extract CSS custom properties for colors
  const customRe = /--(?:\w+-)*color-\w+\s*:\s*([^;]+)/gi;
  while ((match = customRe.exec(input)) !== null) {
    const propName = match[0].split(':')[0].trim();
    colors[propName] = match[1].trim();
  }

  return colors;
}

function extractTypography(input: string): TypographyTokens {
  const fontFamilies = new Set<string>();
  const fontSizes: Record<string, string> = {};
  const lineHeights: Record<string, string> = {};
  const fontWeights: Record<string, number> = {};

  // Extract font families from CSS custom properties
  const familyRe = /--(?:\w+-)*font(?:\w+-)*family\s*:\s*([^;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = familyRe.exec(input)) !== null) {
    match[1].split(',').forEach(f => fontFamilies.add(f.trim().replace(/["']/g, '')));
  }

  // Extract font sizes
  const sizeRe = /--(?:\w+-)*font(?:\w+-)*size\s*:\s*([^;]+)/gi;
  while ((match = sizeRe.exec(input)) !== null) {
    const name = match[0].split(':')[0].trim();
    fontSizes[name] = match[1].trim();
  }

  // Extract line heights
  const lhRe = /--(?:\w+-)*line(?:\w+-)*height\s*:\s*([^;]+)/gi;
  while ((match = lhRe.exec(input)) !== null) {
    const name = match[0].split(':')[0].trim();
    lineHeights[name] = match[1].trim();
  }

  // Extract font weights
  const fwRe = /--(?:\w+-)*font(?:\w+-)*weight\s*:\s*(\d+)/gi;
  while ((match = fwRe.exec(input)) !== null) {
    const name = match[0].split(':')[0].trim();
    fontWeights[name] = parseInt(match[1], 10);
  }

  return {
    fontFamilies: Array.from(fontFamilies),
    fontSizes,
    lineHeights,
    fontWeights,
  };
}

function extractSpacing(input: string): SpacingTokens {
  const values = new Set<number>();
  const re = /--(?:\w+-)*spacing\w*\s*:\s*(\d+)px/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    values.add(parseInt(match[1], 10));
  }

  // If no custom properties, infer from actual usage
  if (values.size === 0) {
    const usageRe = /(padding|margin|gap)\s*:\s*(\d+)px/gi;
    while ((match = usageRe.exec(input)) !== null) {
      values.add(parseInt(match[2], 10));
    }
  }

  const sorted = Array.from(values).sort((a, b) => a - b);
  const unit = sorted.length > 0 ? sorted[0] : 4;

  return {
    unit,
    scale: sorted.length > 0 ? sorted : [0, 4, 8, 12, 16, 24, 32, 48, 64],
  };
}

function extractComponents(input: string): ComponentTokens {
  const button: Record<string, string> = {};
  const inputToken: Record<string, string> = {};
  const card: Record<string, string> = {};

  // Extract CSS custom properties for components
  const btnRe = /--btn-(\w+)\s*:\s*([^;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = btnRe.exec(input)) !== null) {
    button[match[1]] = match[2].trim();
  }

  const inpRe = /--input-(\w+)\s*:\s*([^;]+)/gi;
  while ((match = inpRe.exec(input)) !== null) {
    inputToken[match[1]] = match[2].trim();
  }

  const cardRe = /--card-(\w+)\s*:\s*([^;]+)/gi;
  while ((match = cardRe.exec(input)) !== null) {
    card[match[1]] = match[2].trim();
  }

  return {
    button: Object.keys(button).length > 0 ? button : { 'border-radius': '8px', padding: '12px 24px' },
    input: Object.keys(inputToken).length > 0 ? inputToken : { 'border-radius': '6px', padding: '10px 12px' },
    card: Object.keys(card).length > 0 ? card : { 'border-radius': '12px', padding: '24px' },
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function countLinesBefore(input: string, index: number): number {
  return input.substring(0, Math.max(0, index)).split('\n').length;
}

function extractCSS(input: string): string {
  const cssParts: string[] = [];

  // Extract inline styles
  let match: RegExpExecArray | null;
  const styleRe = new RegExp(REGEX_PATTERNS.styleTag.source, 'gi');
  while ((match = styleRe.exec(input)) !== null) {
    cssParts.push(match[1]);
  }

  // Extract inline style attributes
  const inlineRe = new RegExp(REGEX_PATTERNS.inlineStyle.source, 'gi');
  while ((match = inlineRe.exec(input)) !== null) {
    cssParts.push(match[1]);
  }

  return cssParts.join('\n');
}

function extractHTML(input: string): string {
  // Strip <style> blocks to get pure HTML
  return input.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
}

function calculateScore(antiPatterns: AntiPattern[]): number {
  if (antiPatterns.length === 0) return MAX_SCORE;

  let totalPenalty = 0;
  for (const ap of antiPatterns) {
    totalPenalty += SEVERITY_PENALTIES[ap.severity] ?? SEVERITY_PENALTIES.medium;
  }

  // Cap penalty at MAX_SCORE
  const score = Math.max(0, MAX_SCORE - totalPenalty);

  // Apply diminishing returns for large numbers of issues
  if (antiPatterns.length > 10) {
    return Math.max(0, score - (antiPatterns.length - 10) * 1.5);
  }

  return score;
}

function classifyScore(score: number): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 55) return 'fair';
  if (score >= 35) return 'poor';
  return 'critical';
}

// ─── DesignReviewer Class ─────────────────────────────────────

export class DesignReviewer {
  private rules: AntiPatternRule[];

  constructor(rules?: AntiPatternRule[]) {
    this.rules = rules ?? ANTI_PATTERN_RULES;
  }

  /**
   * Run all 24+ anti-pattern detection rules against HTML/CSS input.
   */
  critique(input: string, _format: 'html' | 'css' | 'both' = 'html'): DesignAudit {
    const antiPatterns: AntiPattern[] = [];
    const css = extractCSS(input);
    const html = extractHTML(input);
    const combined = input;

    for (const rule of this.rules) {
      try {
        const matches = rule.detect(combined);
        for (const match of matches) {
          antiPatterns.push({
            name: rule.name,
            severity: rule.severity,
            element: match.element,
            description: match.description,
            fix: match.fix,
            lineNumber: match.lineNumber,
          });
        }
      } catch (err) {
        console.warn(`[design-reviewer] Rule "${rule.name}" failed: ${err}`);
      }
    }

    const score = calculateScore(antiPatterns);
    const scoreLabel = classifyScore(score);

    const recommendations = antiPatterns
      .filter(ap => ap.severity === 'critical' || ap.severity === 'high')
      .map(ap => `[${ap.severity.toUpperCase()}] ${ap.element}: ${ap.fix}`)
      .slice(0, 10);

    if (recommendations.length === 0) {
      recommendations.push('Design looks solid — no critical or high-severity issues found.');
    }

    const designSystem = this.distill(input);

    return {
      url: '',
      timestamp: new Date().toISOString(),
      antiPatterns,
      score,
      recommendations,
      designSystem,
      scoreLabel,
    } as DesignAudit & { designSystem: DesignSystem; scoreLabel: string };
  }

  /**
   * Perform a full design audit with scoring summary.
   */
  audit(input: string, format: 'html' | 'css' | 'both' = 'html'): DesignAudit & {
    summary: Record<AntiPatternCategory, { count: number; severity: Severity }>;
  } {
    const audit = this.critique(input, format);

    const summary: Record<string, { count: number; severity: Severity }> = {};
    for (const category of this.getCategories()) {
      const categoryRules = audit.antiPatterns.filter(ap =>
        this.rules.some(r => r.name === ap.name && r.category === category),
      );
      if (categoryRules.length > 0) {
        const worstSeverity = this.getWorstSeverity(categoryRules.map(r => r.severity));
        summary[category] = { count: categoryRules.length, severity: worstSeverity };
      }
    }

    return { ...audit, summary };
  }

  /**
   * Generate design system tokens from analyzed code.
   */
  distill(input: string): DesignSystem {
    const css = extractCSS(input);

    return {
      colors: extractColors(css),
      typography: extractTypography(css),
      spacing: extractSpacing(css),
      components: extractComponents(css),
    };
  }

  /**
   * Analyze animation usage and provide recommendations.
   */
  animate(input: string): {
    transitions: Array<{ property: string; duration: string; timing: string }>;
    keyframes: string[];
    recommendations: string[];
  } {
    const transitions: Array<{ property: string; duration: string; timing: string }> = [];
    const keyframes = new Set<string>();

    const transRe = /transition\s*:\s*([^;}]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = transRe.exec(input)) !== null) {
      const parts = match[1].trim().split(/\s+/);
      transitions.push({
        property: parts[0] ?? 'all',
        duration: parts[1] ?? '0s',
        timing: parts[2] ?? 'ease',
      });
    }

    const kfRe = /@keyframes\s+(\w+)/gi;
    while ((match = kfRe.exec(input)) !== null) {
      keyframes.add(match[1]);
    }

    const recommendations: string[] = [];
    if (transitions.length === 0) {
      recommendations.push('No CSS transitions found. Consider adding subtle transitions for interactive elements.');
    }
    if (keyframes.size === 0) {
      recommendations.push('No @keyframes animations found. Consider adding micro-animations for feedback.');
    }
    recommendations.push('Ensure animations respect prefers-reduced-motion media query.');

    return {
      transitions,
      keyframes: Array.from(keyframes),
      recommendations,
    };
  }

  /**
   * Analyze color palette and contrast.
   */
  colorize(input: string): {
    palette: Record<string, string>;
    contrastIssues: string[];
    recommendations: string[];
  } {
    const css = extractCSS(input);
    const palette = extractColors(css);

    const contrastIssues: string[] = [];

    // Detect possible low-contrast combinations
    if (palette['color-0'] === '#ffffff' || palette['color-0'] === '#fff') {
      const textColors = Object.values(palette).filter(c => c !== '#ffffff' && c !== '#fff');
      for (const tc of textColors) {
        if (/^#[89a-f][0-9a-f]{2}/i.test(tc)) {
          contrastIssues.push(`${tc} on white may have insufficient contrast.`);
        }
      }
    }

    const recommendations: string[] = [];
    if (Object.keys(palette).length < 3) {
      recommendations.push('Color palette is minimal. Consider primary, secondary, and neutral colors.');
    }
    if (contrastIssues.length > 0) {
      recommendations.push('Test all text/background combinations with a WCAG contrast checker.');
    }
    recommendations.push('Define colors as CSS custom properties for consistency.');

    return { palette, contrastIssues, recommendations };
  }

  /**
   * Analyze typography scale and hierarchy.
   */
  typeset(input: string): {
    families: string[];
    sizeScale: Record<string, string>;
    hierarchyIssues: string[];
    recommendations: string[];
  } {
    const css = extractCSS(input);
    const typography = extractTypography(css);

    const hierarchyIssues: string[] = [];
    if (typography.fontSizes && Object.keys(typography.fontSizes).length === 0) {
      hierarchyIssues.push('No font-size custom properties defined — sizing may be inconsistent.');
    }
    if (typography.fontFamilies.length > 2) {
      hierarchyIssues.push(`Using ${typography.fontFamilies.length} font families — consider reducing to 2.`);
    }

    const recommendations: string[] = [];
    recommendations.push('Use a modular type scale (e.g., 1.25 ratio for web).');
    recommendations.push('Define font sizes as CSS custom properties (--text-sm, --text-base, --text-lg, etc.).');
    if (typography.fontFamilies.length === 0) {
      recommendations.push('Consider a system font stack for performance.');
    }

    return {
      families: typography.fontFamilies,
      sizeScale: typography.fontSizes,
      hierarchyIssues,
      recommendations,
    };
  }

  /**
   * Analyze layout structure and spacing.
   */
  layout(input: string): {
    containers: string[];
    spacingIssues: string[];
    responsiveIssues: string[];
    recommendations: string[];
  } {
    const containers: string[] = [];
    const spacingIssues: string[] = [];
    const responsiveIssues: string[] = [];

    // Detect layout patterns
    const containerRe = /class\s*=\s*["'][^"']*\b(container|wrapper|section|row|col)\b[^"']*["']/gi;
    let match: RegExpExecArray | null;
    while ((match = containerRe.exec(input)) !== null) {
      const cls = match[0].match(/\b(container|wrapper|section|row|col)\b/i);
      if (cls) containers.push(cls[0]);
    }

    const hasMediaQuery = /@media/i.test(input);
    if (!hasMediaQuery) {
      responsiveIssues.push('No media queries detected — layout may not be responsive.');
    }

    const hasViewportMeta = /<meta[^>]*name\s*=\s*["']viewport["']/i.test(input);
    if (!hasViewportMeta) {
      responsiveIssues.push('Missing viewport meta tag for mobile rendering.');
    }

    const recommendations: string[] = [];
    recommendations.push('Use CSS Grid for 2D layouts and Flexbox for 1D layouts.');
    recommendations.push('Implement a consistent grid system (12-column, 8-column, etc.).');
    if (responsiveIssues.length > 0) {
      recommendations.push('Add responsive breakpoints for mobile, tablet, and desktop.');
    }

    return { containers, spacingIssues, responsiveIssues, recommendations };
  }

  /**
   * Apply auto-fix suggestions to the input (returns fixed version).
   */
  polish(input: string): { output: string; fixesApplied: number; changes: string[] } {
    let output = input;
    const changes: string[] = [];
    let fixesApplied = 0;

    // Fix 1: Add type="button" to buttons without type
    const btnRe = /<button(?=\s|>)((?!\s+type=)[^>]*)>/gi;
    output = output.replace(btnRe, (match) => {
      if (!/type\s*=\s*["'](button|submit|reset)["']/i.test(match)) {
        fixesApplied++;
        changes.push('Added type="button" to <button> element');
        return match.replace('>', ' type="button">');
      }
      return match;
    });

    // Fix 2: Add alt="" to images without alt
    const imgRe = /<img(?=\s)((?!\s+alt=)[^>]*)>/gi;
    output = output.replace(imgRe, (match) => {
      if (!/alt\s*=\s*["']/i.test(match)) {
        fixesApplied++;
        changes.push('Added empty alt attribute to <img>');
        return match.replace('>', ' alt="">');
      }
      return match;
    });

    // Fix 3: Replace pure black with dark gray
    output = output.replace(/color\s*:\s*black\b/gi, 'color: #1a1a1a');
    if (output !== input && output.includes('color: #1a1a1a')) {
      fixesApplied++;
      changes.push('Replaced pure black (#000/black) with dark gray (#1a1a1a)');
    }

    // Fix 4: Add viewport meta if missing
    if (!/<meta[^>]*name\s*=\s*["']viewport["']/i.test(output) && /<head>/i.test(output)) {
      output = output.replace(
        /<head>/i,
        '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      );
      fixesApplied++;
      changes.push('Added viewport meta tag for responsive rendering');
    }

    // Fix 5: Wrap standalone text in proper typography containers (demo)
    const bodyMatch = /<body[^>]*>/i.exec(output);
    if (bodyMatch) {
      // Add a basic max-width constraint suggestion as comment
      const hasMaxWidthCSS = /max-width/i.test(output);
      if (!hasMaxWidthCSS) {
        output = output.replace(
          /<\/head>/i,
          '  <style>\n    body { max-width: 65ch; margin: 0 auto; padding: 1rem; }\n  </style>\n</head>',
        );
        fixesApplied++;
        changes.push('Added base body styles with max-width constraint');
      }
    }

    return { output, fixesApplied, changes };
  }

  // ─── Private Helpers ────────────────────────────────────

  private getCategories(): AntiPatternCategory[] {
    const cats = new Set<AntiPatternCategory>();
    for (const rule of this.rules) {
      cats.add(rule.category);
    }
    return Array.from(cats);
  }

  private getWorstSeverity(severities: string[]): Severity {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    let worst = 'info' as Severity;
    let worstRank = -1;
    for (const s of severities) {
      const rank = order[s] ?? 99;
      if (worstRank === -1 || rank < worstRank) {
        worst = s as Severity;
        worstRank = rank;
      }
    }
    return worst;
  }
}

// ─── Default Export ───────────────────────────────────────────

export default DesignReviewer;

// ─── Module-Level Helpers ─────────────────────────────────────

/**
 * Convenience function: run a full critique in one call.
 */
export function critique(input: string, format: 'html' | 'css' | 'both' = 'html'): DesignAudit {
  const reviewer = new DesignReviewer();
  return reviewer.critique(input, format);
}

/**
 * Convenience function: run a full audit with category summaries.
 */
export function audit(input: string, format: 'html' | 'css' | 'both' = 'html') {
  const reviewer = new DesignReviewer();
  return reviewer.audit(input, format);
}

/**
 * Convenience function: auto-fix common issues.
 */
export function polish(input: string) {
  const reviewer = new DesignReviewer();
  return reviewer.polish(input);
}

/**
 * Convenience function: extract design tokens.
 */
export function distill(input: string): DesignSystem {
  const reviewer = new DesignReviewer();
  return reviewer.distill(input);
}
