/**
 * CodeNexus Vibe Coder Power-Ups
 *
 * Five features that transform code review from passive analysis
 * into active learning, provable safety, and measurable system health.
 *
 * 1. ConfidenceHeatmap — Per-line review confidence overlay
 * 2. ImpactSimulator — Slider-driven scenario projections
 * 3. AdversarialReview — BlindSpot-driven red-team attacks
 * 4. FixGenerator — Three-tier fix options with effort/risk estimates
 * 5. BuildHealthPulse — Aggregated 0-100 system health metric
 */

import { v4 as uuid } from "uuid";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ConfidenceTier = "GREEN" | "YELLOW" | "RED";
export type FixTier = "QUICK_PATCH" | "PROPER_FIX" | "EXPERT_REQUIRED";

// ─── Confidence Heatmap ───────────────────────────────────────

export interface LineConfidence {
  /** 1-based line number in the file */
  line: number;
  /** GREEN = fully validated, YELLOW = automated with blind spots, RED = escalated/missing */
  tier: ConfidenceTier;
  /** 0-100 confidence score */
  score: number;
  /** What validated this line (detector name, human review, test pass) */
  validatedBy: string[];
  /** Blind spots affecting this line */
  blindSpots: string[];
  /** Whether this line needs human review */
  needsHumanReview: boolean;
  /** Findings associated with this line */
  findingIds: string[];
}

export interface FileHeatmap {
  filePath: string;
  riskLevel: RiskLevel;
  lines: LineConfidence[];
  overallConfidence: number;
  /** Percentage of lines at each tier */
  distribution: { green: number; yellow: number; red: number };
}

export interface PRHeatmap {
  prNumber: number;
  files: FileHeatmap[];
  overallConfidence: number;
  generatedAt: string;
}

// ─── Impact Simulator ────────────────────────────────────────

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  /** The finding this scenario simulates */
  findingCategory: string;
  /** Slider parameters */
  sliders: SimulationSlider[];
  /** Current slider values */
  currentValues: Record<string, number>;
  /** Computed projections */
  projections: ImpactProjection;
}

export interface SimulationSlider {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
  /** How this slider affects each projection dimension */
  affects: ("userTrust" | "operationalCost" | "securityPosture" | "buildStability")[];
}

export interface ImpactProjection {
  userTrust: ProjectedMetric;
  operationalCost: ProjectedMetric;
  securityPosture: ProjectedMetric;
  buildStability: ProjectedMetric;
  /** Overall consequence category */
  consequenceLevel: "MINIMAL" | "MODERATE" | "SIGNIFICANT" | "SEVERE" | "CATASTROPHIC";
}

export interface ProjectedMetric {
  currentValue: number;
  projectedValue: number;
  delta: number;
  deltaPercent: number;
  unit: string;
  trend: "improving" | "stable" | "degrading" | "collapsing";
}

// ─── Adversarial Review ──────────────────────────────────────

export interface AdversarialRun {
  id: string;
  prNumber: number;
  /** Which BlindSpotDeclarations drive this run */
  drivenByBlindSpots: string[];
  /** Attack vectors attempted */
  attacks: AdversarialAttack[];
  /** Results summary */
  summary: {
    totalAttacks: number;
    successful: number;
    failed: number;
    inconclusive: number;
    criticalExploitsFound: number;
  };
  /** Generated exploit trace */
  exploitTraces: ExploitTrace[];
  startedAt: string;
  completedAt: string;
}

export interface AdversarialAttack {
  id: string;
  category: string;
  /** The blind spot gap this attack targets */
  targetsBlindSpot: string;
  /** Attack technique */
  technique: string;
  /** Payload or approach */
  payload: string;
  /** Result */
  result: "SUCCEEDED" | "FAILED" | "INCONCLUSIVE";
  /** If succeeded, what was compromised */
  impact: string;
  /** Evidence */
  evidence: string[];
}

export interface ExploitTrace {
  attackId: string;
  /** Step-by-step narration of the exploit */
  steps: ExploitStep[];
  /** Total time from first step to exploitation */
  totalDurationMs: number;
  /** Whether the exploit produced a video/trace artifact */
  hasRecording: boolean;
  recordingPath?: string;
}

export interface ExploitStep {
  stepNumber: number;
  timestamp: string;
  action: string;
  response: string;
  /** Screenshot or trace at this step */
  evidence: string;
}

// ─── Fix Generator ───────────────────────────────────────────

export interface FixOption {
  tier: FixTier;
  title: string;
  description: string;
  /** Code snippet or patch */
  codeSnippet: string;
  /** Estimated effort */
  effort: { level: "LOW" | "MEDIUM" | "HIGH"; hours: number };
  /** Confidence this fix resolves the finding */
  confidence: number;
  /** Risk of regression */
  regressionRisk: number;
  /** What the vibe coder needs to know to implement */
  implementationGuide: string;
  /** Prerequisites */
  prerequisites: string[];
  /** Test coverage impact */
  testImpact: string;
}

export interface GeneratedFix {
  findingId: string;
  findingCategory: string;
  summary: string;
  options: FixOption[];
  /** Recommended option */
  recommended: FixTier;
  recommendationReason: string;
}

// ─── Build Health Pulse ──────────────────────────────────────

export interface BuildHealthPulse {
  /** Single 0-100 aggregate */
  score: number;
  /** Trend over last 7 days */
  trend: "IMPROVING" | "STABLE" | "DEGRADING";
  trendPoints: number[];
  /** Component breakdown */
  components: {
    openRiskScore: number;        // Aggregate of all open PR risk scores
    blindSpotConfidence: number;  // Average blind spot confidence across open PRs
    unresolvedEscalations: number; // Count of unresolved escalations
    reviewCoverage: number;       // % of PR lines reviewed
    adversarialPassRate: number;  // % of adversarial attacks that fail (good)
    regressionRate: number;       // % of fixes that caused regressions
  };
  /** Top risks */
  topRisks: {
    prNumber: number;
    title: string;
    riskLevel: RiskLevel;
    impact: string;
  }[];
  generatedAt: string;
}

// ─── Regret Minimizer Types ──────────────────────────────────

export interface RegretRecord {
  prNumber: number;
  mergedAt: string;
  predictedImpact: ImpactProjection;
  actualImpact: {
    incidentsIn30Days: number;
    bugReportsIn30Days: number;
    rollbackRequired: boolean;
    securityAlertsTriggered: number;
  };
  predictionDelta: {
    userTrustDelta: number;
    operationalCostDelta: number;
    securityPostureDelta: number;
    buildStabilityDelta: number;
  };
  /** Learning signal extracted */
  learningSignal: string;
}

// ═══════════════════════════════════════════════════════════════
// 1. CONFIDENCE HEATMAP GENERATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Generates a per-line confidence heatmap for every file in a PR.
 *
 * Green = fully validated (test passed, human reviewed, automated check passed)
 * Yellow = automated with declared blind spots (found by bot, blind spots exist)
 * Red = escalated or missing evidence (human review mandatory, no automated validation)
 */
export function generateConfidenceHeatmap(
  prNumber: number,
  files: { path: string; lines: number; riskLevel: RiskLevel }[],
  findings: { filePath: string; line: number; severity: string; blindSpots: string[] }[],
  blindSpots: { section: string; thingsSystemMightMiss: string[] }[],
): PRHeatmap {
  const heatmapFiles: FileHeatmap[] = [];

  for (const file of files) {
    const lines: LineConfidence[] = [];
    const fileFindings = findings.filter((f) => f.filePath === file.path);

    for (let lineNum = 1; lineNum <= file.lines; lineNum++) {
      const lineFindings = fileFindings.filter((f) => f.line === lineNum);

      if (lineFindings.length === 0) {
        // No findings on this line — check if blind spots might affect it
        const hasBlindSpotRisk =
          file.riskLevel === "CRITICAL" || file.riskLevel === "HIGH";

        lines.push({
          line: lineNum,
          tier: hasBlindSpotRisk ? "YELLOW" : "GREEN",
          score: hasBlindSpotRisk ? 70 : 95,
          validatedBy: hasBlindSpotRisk ? ["automated-scan"] : ["automated-full-pass"],
          blindSpots: hasBlindSpotRisk
            ? blindSpots.flatMap((b) => b.thingsSystemMightMiss)
            : [],
          needsHumanReview: hasBlindSpotRisk,
          findingIds: [],
        });
      } else {
        // Has findings — determine tier based on severity and blind spot overlap
        const hasCritical = lineFindings.some((f) => f.severity === "CRITICAL");
        const hasEscalated = lineFindings.some((f) => f.severity === "HIGH");
        const lineBlindSpots = [
          ...new Set(lineFindings.flatMap((f) => f.blindSpots)),
        ];

        const tier: ConfidenceTier = hasCritical ? "RED" : hasEscalated ? "YELLOW" : "YELLOW";
        const score = hasCritical ? 15 : hasEscalated ? 45 : 60;

        lines.push({
          line: lineNum,
          tier,
          score,
          validatedBy: ["automated-detection"],
          blindSpots: lineBlindSpots,
          needsHumanReview: tier === "RED" || tier === "YELLOW",
          findingIds: lineFindings.map((f) => `${f.filePath}:${f.line}`),
        });
      }
    }

    const distribution = {
      green: lines.filter((l) => l.tier === "GREEN").length / lines.length,
      yellow: lines.filter((l) => l.tier === "YELLOW").length / lines.length,
      red: lines.filter((l) => l.tier === "RED").length / lines.length,
    };

    const overallConfidence =
      lines.reduce((sum, l) => sum + l.score, 0) / Math.max(lines.length, 1);

    heatmapFiles.push({
      filePath: file.path,
      riskLevel: file.riskLevel,
      lines,
      overallConfidence: Math.round(overallConfidence),
      distribution: {
        green: Math.round(distribution.green * 100),
        yellow: Math.round(distribution.yellow * 100),
        red: Math.round(distribution.red * 100),
      },
    });
  }

  const overallConfidence =
    heatmapFiles.reduce((sum, f) => sum + f.overallConfidence, 0) /
    Math.max(heatmapFiles.length, 1);

  return {
    prNumber,
    files: heatmapFiles,
    overallConfidence: Math.round(overallConfidence),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Renders a heatmap as ASCII for terminal display or collapses to summary for PR comments.
 */
export function renderHeatmapSummary(heatmap: PRHeatmap): string {
  const lines: string[] = [
    `## 📊 Confidence Heatmap — PR #${heatmap.prNumber}`,
    ``,
    `**Overall Confidence**: ${heatmap.overallConfidence}%`,
    ``,
    `| File | Risk | 🟢 Green | 🟡 Yellow | 🔴 Red | Confidence |`,
    `|------|------|----------|-----------|---------|------------|`,
  ];

  for (const file of heatmap.files) {
    lines.push(
      `| \`${file.filePath}\` | ${file.riskLevel} | ${file.distribution.green}% | ${file.distribution.yellow}% | ${file.distribution.red}% | ${file.overallConfidence}% |`,
    );
  }

  lines.push(
    ``,
    `> 🟢 = fully validated | 🟡 = automated with declared blind spots | 🔴 = escalated, human review mandatory`,
    ``,
    `**Files needing human attention**: ${heatmap.files.filter((f) => f.distribution.red > 0 || f.distribution.yellow > 50).length}`,
  );

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// 2. IMPACT SIMULATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Creates an interactive simulation scenario from a finding.
 * Vibe coders drag sliders to simulate "what if X% of checkouts fail"
 * and see real-time projections on trust, cost, security, and stability.
 */
export function createSimulation(
  findingCategory: string,
  technicalSummary: string,
): SimulationScenario {
  const template = SIMULATION_TEMPLATES[findingCategory] ?? SIMULATION_TEMPLATES["Generic"];

  return {
    id: `SIM-${uuid().slice(0, 8)}`,
    name: template.name,
    description: technicalSummary,
    findingCategory,
    sliders: template.sliders,
    currentValues: Object.fromEntries(
      template.sliders.map((s) => [s.key, s.defaultValue]),
    ),
    projections: computeProjections(
      template,
      Object.fromEntries(template.sliders.map((s) => [s.key, s.defaultValue])),
    ),
  };
}

/**
 * Updates projections based on slider changes.
 */
export function simulateScenario(
  scenario: SimulationScenario,
  newValues: Record<string, number>,
): SimulationScenario {
  const template = SIMULATION_TEMPLATES[scenario.findingCategory] ?? SIMULATION_TEMPLATES["Generic"];

  return {
    ...scenario,
    currentValues: newValues,
    projections: computeProjections(template, newValues),
  };
}

function computeProjections(
  template: SimulationTemplate,
  values: Record<string, number>,
): ImpactProjection {
  const userTrust = template.compute("userTrust", values);
  const operationalCost = template.compute("operationalCost", values);
  const securityPosture = template.compute("securityPosture", values);
  const buildStability = template.compute("buildStability", values);

  const maxDelta = Math.max(
    Math.abs(userTrust.deltaPercent),
    Math.abs(operationalCost.deltaPercent),
    Math.abs(securityPosture.deltaPercent),
    Math.abs(buildStability.deltaPercent),
  );

  const consequenceLevel: ImpactProjection["consequenceLevel"] =
    maxDelta <= 5
      ? "MINIMAL"
      : maxDelta <= 15
        ? "MODERATE"
        : maxDelta <= 30
          ? "SIGNIFICANT"
          : maxDelta <= 50
            ? "SEVERE"
            : "CATASTROPHIC";

  return { userTrust, operationalCost, securityPosture, buildStability, consequenceLevel };
}

interface SimulationTemplate {
  name: string;
  sliders: SimulationSlider[];
  compute: (
    dimension: "userTrust" | "operationalCost" | "securityPosture" | "buildStability",
    values: Record<string, number>,
  ) => ProjectedMetric;
}

const SIMULATION_TEMPLATES: Record<string, SimulationTemplate> = {
  "Transaction Integrity Failure": {
    name: "Checkout Failure Simulator",
    sliders: [
      {
        key: "checkoutFailureRate",
        label: "% of checkouts that fail",
        min: 0, max: 25, step: 1, defaultValue: 5, unit: "%",
        affects: ["userTrust", "operationalCost", "buildStability"],
      },
      {
        key: "usersAffected",
        label: "Monthly active users",
        min: 100, max: 1000000, step: 100, defaultValue: 10000, unit: "users",
        affects: ["userTrust", "operationalCost"],
      },
      {
        key: "avgOrderValue",
        label: "Average order value",
        min: 5, max: 1000, step: 5, defaultValue: 50, unit: "$",
        affects: ["operationalCost", "userTrust"],
      },
    ],
    compute: (dimension, values) => {
      const rate = (values["checkoutFailureRate"] ?? 5) / 100;
      const users = values["usersAffected"] ?? 10000;
      const orderVal = values["avgOrderValue"] ?? 50;

      switch (dimension) {
        case "userTrust":
          return {
            currentValue: 85, projectedValue: Math.round(85 - rate * 200),
            delta: Math.round(-rate * 200), deltaPercent: Math.round(-rate * 235),
            unit: "%", trend: rate > 0.1 ? "collapsing" : rate > 0.05 ? "degrading" : "stable",
          };
        case "operationalCost":
          const lostRevenue = users * rate * orderVal;
          return {
            currentValue: 0, projectedValue: Math.round(lostRevenue),
            delta: Math.round(lostRevenue), deltaPercent: Math.round(rate * 100),
            unit: "$/month", trend: rate > 0.1 ? "collapsing" : "degrading",
          };
        case "securityPosture":
          return {
            currentValue: 75, projectedValue: 75,
            delta: 0, deltaPercent: 0, unit: "%", trend: "stable",
          };
        case "buildStability":
          return {
            currentValue: 90, projectedValue: Math.round(90 - rate * 100),
            delta: Math.round(-rate * 100), deltaPercent: Math.round(-rate * 111),
            unit: "%", trend: rate > 0.05 ? "degrading" : "stable",
          };
      }
    },
  },
  "Authorization Gap": {
    name: "Data Breach Simulator",
    sliders: [
      {
        key: "exposedRecords",
        label: "Number of exposed records",
        min: 10, max: 10000000, step: 10, defaultValue: 1000, unit: "records",
        affects: ["userTrust", "operationalCost", "securityPosture"],
      },
      {
        key: "containsPII",
        label: "% of records containing PII",
        min: 0, max: 100, step: 5, defaultValue: 60, unit: "%",
        affects: ["userTrust", "securityPosture", "operationalCost"],
      },
      {
        key: "timeToDetect",
        label: "Days to detect breach",
        min: 1, max: 180, step: 1, defaultValue: 30, unit: "days",
        affects: ["userTrust", "operationalCost"],
      },
    ],
    compute: (dimension, values) => {
      const records = values["exposedRecords"] ?? 1000;
      const piiPct = (values["containsPII"] ?? 60) / 100;
      const ttd = values["timeToDetect"] ?? 30;
      const piiRecords = records * piiPct;

      switch (dimension) {
        case "userTrust":
          const trustDrop = Math.min(85, Math.round(piiRecords / 100));
          return {
            currentValue: 85, projectedValue: 85 - trustDrop,
            delta: -trustDrop, deltaPercent: Math.round(-trustDrop / 85 * 100),
            unit: "%", trend: trustDrop > 40 ? "collapsing" : "degrading",
          };
        case "operationalCost":
          const finePerRecord = piiPct > 0.5 ? 150 : 25;
          const cost = piiRecords * finePerRecord;
          return {
            currentValue: 0, projectedValue: Math.round(cost),
            delta: Math.round(cost), deltaPercent: 0, unit: "$",
            trend: "degrading",
          };
        case "securityPosture":
          return {
            currentValue: 70, projectedValue: Math.round(Math.max(10, 70 - ttd)),
            delta: -Math.min(60, ttd), deltaPercent: Math.round(-Math.min(60, ttd) / 70 * 100),
            unit: "%", trend: "degrading",
          };
        case "buildStability":
          return {
            currentValue: 90, projectedValue: 90, delta: 0, deltaPercent: 0,
            unit: "%", trend: "stable",
          };
      }
    },
  },
  "Race Condition Risk": {
    name: "Race Condition Simulator",
    sliders: [
      {
        key: "concurrentRequests",
        label: "Peak concurrent requests",
        min: 10, max: 100000, step: 10, defaultValue: 1000, unit: "req/s",
        affects: ["buildStability", "userTrust"],
      },
      {
        key: "raceWindowMs",
        label: "Race window size (ms)",
        min: 1, max: 5000, step: 10, defaultValue: 100, unit: "ms",
        affects: ["buildStability"],
      },
    ],
    compute: (dimension, values) => {
      const reqs = values["concurrentRequests"] ?? 1000;
      const window = values["raceWindowMs"] ?? 100;
      const raceProb = Math.min(1, (reqs * window) / 1_000_000);

      switch (dimension) {
        case "buildStability":
          const stabilityDrop = Math.round(raceProb * 30);
          return {
            currentValue: 90, projectedValue: 90 - stabilityDrop,
            delta: -stabilityDrop, deltaPercent: Math.round(-stabilityDrop / 90 * 100),
            unit: "%", trend: raceProb > 0.1 ? "degrading" : "stable",
          };
        case "userTrust":
          return {
            currentValue: 85, projectedValue: Math.round(85 - raceProb * 25),
            delta: Math.round(-raceProb * 25), deltaPercent: Math.round(-raceProb * 29),
            unit: "%", trend: raceProb > 0.05 ? "degrading" : "stable",
          };
        case "operationalCost":
          return {
            currentValue: 0, projectedValue: Math.round(reqs * raceProb * 0.01),
            delta: Math.round(reqs * raceProb * 0.01), deltaPercent: 0,
            unit: "$/incident", trend: "stable",
          };
        case "securityPosture":
          return {
            currentValue: 75, projectedValue: Math.round(75 - raceProb * 10),
            delta: Math.round(-raceProb * 10), deltaPercent: Math.round(-raceProb * 13),
            unit: "%", trend: raceProb > 0.05 ? "degrading" : "stable",
          };
      }
    },
  },
  Generic: {
    name: "Impact Simulator",
    sliders: [
      {
        key: "failureRate",
        label: "Failure rate",
        min: 0, max: 100, step: 1, defaultValue: 5, unit: "%",
        affects: ["userTrust", "operationalCost", "buildStability", "securityPosture"],
      },
    ],
    compute: (dimension, values) => {
      const rate = (values["failureRate"] ?? 5) / 100;
      return {
        currentValue: 80,
        projectedValue: Math.round(80 - rate * 150),
        delta: Math.round(-rate * 150),
        deltaPercent: Math.round(-rate * 188),
        unit: "%",
        trend: rate > 0.2 ? "collapsing" : rate > 0.1 ? "degrading" : "stable",
      };
    },
  },
};

/**
 * Renders simulation output as Markdown.
 */
export function renderSimulationMarkdown(scenario: SimulationScenario): string {
  const p = scenario.projections;

  const consequenceEmoji: Record<string, string> = {
    MINIMAL: "🟢",
    MODERATE: "🟡",
    SIGNIFICANT: "🟠",
    SEVERE: "🔴",
    CATASTROPHIC: "💀",
  };

  return [
    `### 🎮 Impact Simulator — ${scenario.name}`,
    ``,
    `> ${scenario.description}`,
    ``,
    `**Current consequence level**: ${consequenceEmoji[scenario.projections.consequenceLevel]} **${p.consequenceLevel}**`,
    ``,
    `**Sliders**`,
    ...scenario.sliders.map(
      (s) =>
        `- ${s.label}: **${scenario.currentValues[s.key]}${s.unit}** (range: ${s.min}-${s.max}${s.unit})`,
    ),
    ``,
    `**Projected Impact**`,
    ``,
    `| Dimension | Current | Projected | Delta | Trend |`,
    `|-----------|---------|-----------|-------|-------|`,
    `| 🏗️ Build Stability | ${p.buildStability.currentValue}% | ${p.buildStability.projectedValue}% | ${p.buildStability.deltaPercent >= 0 ? "+" : ""}${p.buildStability.deltaPercent}% | ${p.buildStability.trend} |`,
    `| 🔒 Security Posture | ${p.securityPosture.currentValue}% | ${p.securityPosture.projectedValue}% | ${p.securityPosture.deltaPercent >= 0 ? "+" : ""}${p.securityPosture.deltaPercent}% | ${p.securityPosture.trend} |`,
    `| 😤 User Trust | ${p.userTrust.currentValue}% | ${p.userTrust.projectedValue}% | ${p.userTrust.deltaPercent >= 0 ? "+" : ""}${p.userTrust.deltaPercent}% | ${p.userTrust.trend} |`,
    `| 📊 Operational Cost | $${p.operationalCost.currentValue} | $${p.operationalCost.projectedValue} | ${p.operationalCost.deltaPercent >= 0 ? "+" : ""}${p.operationalCost.deltaPercent}% | ${p.operationalCost.trend} |`,
    ``,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════
// 3. ADVERSARIAL REVIEW MODE
// ═══════════════════════════════════════════════════════════════

/**
 * Generates an adversarial review run driven by BlindSpotDeclarations.
 *
 * For every blind spot the system declared, this generates concrete attack
 * vectors and simulates what a red-team pass would attempt.
 */
export function generateAdversarialRun(
  prNumber: number,
  blindSpots: { section: string; thingsSystemMightMiss: string[] }[],
  sourceCode: string,
): AdversarialRun {
  const attacks: AdversarialAttack[] = [];
  const exploitTraces: ExploitTrace[] = [];

  for (const bs of blindSpots) {
    for (const gap of bs.thingsSystemMightMiss) {
      const technique = selectAttackTechnique(bs.section, gap);
      attacks.push({
        id: `ATK-${uuid().slice(0, 8)}`,
        category: bs.section,
        targetsBlindSpot: gap,
        technique: technique.name,
        payload: technique.payload,
        result: "INCONCLUSIVE", // Will be updated after actual execution
        impact: technique.potentialImpact,
        evidence: [],
      });
    }
  }

  return {
    id: `ADV-${uuid().slice(0, 8)}`,
    prNumber,
    drivenByBlindSpots: blindSpots.map((b) => b.section),
    attacks,
    summary: {
      totalAttacks: attacks.length,
      successful: 0,
      failed: 0,
      inconclusive: attacks.length,
      criticalExploitsFound: 0,
    },
    exploitTraces,
    startedAt: new Date().toISOString(),
    completedAt: "",
  };
}

interface AttackTechnique {
  name: string;
  payload: string;
  potentialImpact: string;
}

function selectAttackTechnique(section: string, gap: string): AttackTechnique {
  const sectionTechniques: Record<string, AttackTechnique[]> = {
    "Authorization Review": [
      {
        name: "IDOR Enumeration", payload: "Iterate object IDs in API requests; verify 403 for unowned resources",
        potentialImpact: "Unauthorized data access across tenant boundaries",
      },
      {
        name: "Role Escalation Chain",
        payload: "Modify user role in request body; attempt to access admin-only endpoints with modified token claims",
        potentialImpact: "Full privilege escalation from user to admin",
      },
    ],
    "Race Conditions": [
      {
        name: "Parallel Request Storm",
        payload: "Fire 50 concurrent requests to coupon-claim endpoint with same coupon code within 100ms window",
        potentialImpact: "Multiple redemptions of single-use coupons",
      },
      {
        name: "TOCTOU Race",
        payload: "Read balance, wait, withdraw — repeat in parallel; check if balance ever goes negative",
        potentialImpact: "Overdraft or negative inventory",
      },
    ],
    "Transaction Integrity": [
      {
        name: "Partial Failure Injection",
        payload: "Simulate DB timeout after payment succeeds but before order commit; verify compensating rollback",
        potentialImpact: "Orphaned payments with no orders",
      },
      {
        name: "Idempotency Key Replay",
        payload: "Replay the same idempotency key with different payload; verify the original result is returned, not the modified one",
        potentialImpact: "Payment amount manipulation through idempotency replay",
      },
    ],
  };

  const techniques = sectionTechniques[section] ?? [
    {
      name: "Generic Exploit Attempt",
      payload: `Attempt to exploit: ${gap}`,
      potentialImpact: "Unknown — requires manual analysis",
    },
  ];

  return techniques[0];
}

/**
 * Renders adversarial run results as Markdown.
 */
export function renderAdversarialMarkdown(run: AdversarialRun): string {
  const statusEmoji =
    run.summary.criticalExploitsFound > 0
      ? "💀"
      : run.summary.successful > 0
        ? "🔴"
        : "🟢";

  return [
    `## ${statusEmoji} Adversarial Review — Run ${run.id}`,
    ``,
    `**Driven by**: ${run.drivenByBlindSpots.join(", ")}`,
    ``,
    `**Results**: ${run.summary.totalAttacks} attacks — ` +
      `${run.summary.criticalExploitsFound} critical | ${run.summary.successful} succeeded | ${run.summary.failed} blocked | ${run.summary.inconclusive} pending`,
    ``,
    `| # | Category | Technique | Result | Impact |`,
    `|---|----------|-----------|--------|--------|`,
    ...run.attacks.map((a) => {
      const resultEmoji = a.result === "SUCCEEDED" ? "🔴" : a.result === "FAILED" ? "🟢" : "🟡";
      return `| ${a.id} | ${a.category} | ${a.technique} | ${resultEmoji} ${a.result} | ${a.impact} |`;
    }),
    ``,
    run.summary.criticalExploitsFound > 0
      ? `> ⚠️ **${run.summary.criticalExploitsFound} critical exploits found. These must be fixed before merge.**`
      : run.summary.successful > 0
        ? "> 🔴 Exploits succeeded. Review attack results and apply fixes."
        : "> 🟢 All attacks were blocked or inconclusive. No confirmed exploits found.",
    ``,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════
// 4. FIX GENERATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Generates three-tier fix options for every finding.
 *
 * Quick Patch: High confidence, low effort. Band-aid that ships now.
 * Proper Fix: Medium confidence, architectural change. The right way.
 * Expert Required: Low confidence, needs specialist. Escalate to domain expert.
 */
export function generateFixOptions(
  findingId: string,
  findingCategory: string,
  findingDescription: string,
): GeneratedFix {
  const template = FIX_TEMPLATES[findingCategory] ?? FIX_TEMPLATES["Generic Finding"];

  return {
    findingId,
    findingCategory,
    summary: findingDescription,
    options: template.options.map((opt) => ({
      ...opt,
      codeSnippet: opt.codeSnippet.replace(/\{FINDING\}/g, findingDescription),
    })),
    recommended: template.recommended,
    recommendationReason: template.reason,
  };
}

interface FixTemplate {
  options: Omit<FixOption, "codeSnippet">[];
  recommended: FixTier;
  reason: string;
}

const FIX_TEMPLATES: Record<string, FixTemplate> = {
  "Transaction Integrity Failure": {
    options: [
      {
        tier: "QUICK_PATCH",
        title: "Add try/catch + compensating action",
        description: "Wrap the critical section in a try/catch and add a compensating cleanup action in the catch block.",
        effort: { level: "LOW", hours: 2 },
        confidence: 85,
        regressionRisk: 15,
        implementationGuide: "1. Identify the two operations that need atomicity\n2. Wrap in try/catch\n3. In catch, reverse the first operation if it succeeded\n4. Log the compensation for auditing",
        prerequisites: ["Access to service code", "Understanding of the two operations involved"],
        testImpact: "Add unit test for compensation path; add integration test for partial failure",
      },
      {
        tier: "PROPER_FIX",
        title: "Implement database transaction",
        description: "Wrap both operations in a single database transaction with proper isolation level.",
        effort: { level: "MEDIUM", hours: 8 },
        confidence: 95,
        regressionRisk: 5,
        implementationGuide: "1. Identify transaction boundary\n2. Set isolation level to SERIALIZABLE or use SELECT FOR UPDATE\n3. Ensure both operations share the same connection/transaction\n4. Add rollback on any failure\n5. Test with concurrent load",
        prerequisites: ["Database transaction support", "Connection pooling configured for transactions"],
        testImpact: "Add concurrent transaction tests; add rollback verification tests",
      },
      {
        tier: "EXPERT_REQUIRED",
        title: "Implement distributed saga pattern",
        description: "For cross-service transactions, implement a saga orchestrator with compensating transactions for each step.",
        effort: { level: "HIGH", hours: 40 },
        confidence: 70,
        regressionRisk: 25,
        implementationGuide: "This requires architectural expertise:\n1. Design saga steps and compensating actions\n2. Implement saga orchestrator or use choreography\n3. Handle saga failure recovery and idempotency\n4. Add saga state persistence for crash recovery",
        prerequisites: ["Distributed systems expertise", "Message queue infrastructure", "Idempotency framework"],
        testImpact: "Full saga integration tests; chaos engineering for saga recovery",
      },
    ],
    recommended: "PROPER_FIX",
    reason: "Transaction boundary is the standard approach; Quick Patch adds technical debt without guaranteeing consistency under all failure modes.",
  },
  "Authorization Gap": {
    options: [
      {
        tier: "QUICK_PATCH",
        title: "Add ownership check before operation",
        description: "Add an if-statement checking that the requesting user owns or has permission to the target resource.",
        effort: { level: "LOW", hours: 1 },
        confidence: 90,
        regressionRisk: 5,
        implementationGuide: "1. Identify the resource ID from the request\n2. Query the resource's owner/tenant from the database\n3. Compare with the authenticated user's ID/tenant\n4. Return 403 if mismatch",
        prerequisites: ["Access to auth middleware context", "Resource-to-owner mapping in database"],
        testImpact: "Add authorization unit test; add IDOR test with cross-tenant IDs",
      },
      {
        tier: "PROPER_FIX",
        title: "Implement resource-level authorization middleware",
        description: "Create a reusable authorization middleware that verifies resource ownership for all CRUD operations.",
        effort: { level: "MEDIUM", hours: 6 },
        confidence: 95,
        regressionRisk: 3,
        implementationGuide: "1. Design authorization policy (who can access what)\n2. Implement middleware that resolves resource → owner\n3. Apply to all relevant routes\n4. Add audit logging for access decisions",
        prerequisites: ["Authorization policy defined", "Consistent resource ownership model"],
        testImpact: "Authorization middleware tests; cross-tenant penetration tests",
      },
      {
        tier: "EXPERT_REQUIRED",
        title: "Implement policy-based access control (PBAC/ABAC)",
        description: "Replace ad-hoc checks with a policy engine that evaluates access based on attributes of user, resource, and environment.",
        effort: { level: "HIGH", hours: 60 },
        confidence: 75,
        regressionRisk: 20,
        implementationGuide: "Requires security architecture expertise:\n1. Define attribute model (user attributes, resource attributes, environment)\n2. Select/implement policy engine (OPA, Cedar, Casbin)\n3. Migrate existing checks to policy rules\n4. Add policy testing framework",
        prerequisites: ["Security architecture review", "Policy engine evaluation", "Attribute taxonomy defined"],
        testImpact: "Full policy regression suite; attribute-based test matrix",
      },
    ],
    recommended: "PROPER_FIX",
    reason: "Middleware approach scales to all routes and prevents future gaps. Quick Patch is acceptable for urgent hotfix but creates tech debt.",
  },
  "Generic Finding": {
    options: [
      {
        tier: "QUICK_PATCH",
        title: "Minimal fix",
        description: "Address the immediate issue with the smallest safe change.",
        effort: { level: "LOW", hours: 2 },
        confidence: 70,
        regressionRisk: 20,
        implementationGuide: "1. Identify the exact line causing the issue\n2. Apply minimal change that resolves it\n3. Add a comment explaining the fix\n4. Run existing tests to verify no regression",
        prerequisites: ["Understanding of the affected code"],
        testImpact: "Verify existing tests still pass; add targeted test for the fix",
      },
      {
        tier: "PROPER_FIX",
        title: "Structural fix",
        description: "Address the root cause with a proper architectural change.",
        effort: { level: "MEDIUM", hours: 8 },
        confidence: 85,
        regressionRisk: 10,
        implementationGuide: "1. Analyze root cause\n2. Design structural solution\n3. Implement with tests\n4. Document the pattern to prevent recurrence",
        prerequisites: ["Architectural understanding of the system"],
        testImpact: "Add comprehensive tests for the fixed pattern",
      },
      {
        tier: "EXPERT_REQUIRED",
        title: "Domain expert review",
        description: "Escalate to domain expert for specialized analysis and fix design.",
        effort: { level: "HIGH", hours: 20 },
        confidence: 60,
        regressionRisk: 30,
        implementationGuide: "1. Document current behavior and desired behavior\n2. Escalate to domain expert with context\n3. Collaborate on solution design\n4. Implement and review together",
        prerequisites: ["Domain expert availability", "Clear problem statement"],
        testImpact: "Expert-designed test scenarios",
      },
    ],
    recommended: "QUICK_PATCH",
    reason: "Without specific category knowledge, the Quick Patch is the safest starting point. Elevate to Proper Fix if the issue recurs.",
  },
};

/**
 * Renders fix options as Markdown.
 */
export function renderFixOptionsMarkdown(fix: GeneratedFix): string {
  const tierLabels: Record<FixTier, string> = {
    QUICK_PATCH: "⚡ Quick Patch",
    PROPER_FIX: "🔧 Proper Fix",
    EXPERT_REQUIRED: "🧠 Expert Required",
  };

  const lines = [
    `### 🛠️ Fix Options — ${fix.findingCategory}`,
    ``,
    `> ${fix.summary}`,
    ``,
    `**Recommended**: ${tierLabels[fix.recommended]} — ${fix.recommendationReason}`,
    ``,
  ];

  for (const opt of fix.options) {
    const recommendedBadge = opt.tier === fix.recommended ? " ⭐ RECOMMENDED" : "";

    lines.push(
      `#### ${tierLabels[opt.tier]}${recommendedBadge}`,
      ``,
      `> ${opt.description}`,
      ``,
      `| Attribute | Value |`,
      `|-----------|-------|`,
      `| Effort | ${opt.effort.level} (~${opt.effort.hours}h) |`,
      `| Confidence | ${opt.confidence}% |`,
      `| Regression Risk | ${opt.regressionRisk}% |`,
      ``,
      `**How to implement**`,
      `\`\`\``,
      opt.implementationGuide,
      `\`\`\``,
      ``,
      `**Prerequisites**: ${opt.prerequisites.join("; ")}`,
      ``,
      `**Test impact**: ${opt.testImpact}`,
      ``,
      `---`,
      ``,
    );
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// 5. BUILD HEALTH PULSE
// ═══════════════════════════════════════════════════════════════

/**
 * Computes a single 0-100 Build Health Pulse score from all open PR data.
 *
 * This is the leadership/vibe-coder at-a-glance metric:
 * - 90-100: Healthy — low risk, high confidence
 * - 70-89: Watchful — some risk, manageable
 * - 50-69: Concerning — multiple risks, needs attention
 * - 30-49: Critical — significant risks, immediate action needed
 * - 0-29: Emergency — system health at risk, escalate
 */
export function computeBuildHealthPulse(
  openPRs: {
    prNumber: number;
    title: string;
    riskLevel: RiskLevel;
    blindSpotConfidence: number;
    unresolvedEscalations: number;
    reviewCoverage: number;
    adversarialPassRate: number;
  }[],
  history: number[] = [],
): BuildHealthPulse {
  if (openPRs.length === 0) {
    return {
      score: 100,
      trend: "STABLE",
      trendPoints: [...history, 100],
      components: {
        openRiskScore: 100,
        blindSpotConfidence: 100,
        unresolvedEscalations: 0,
        reviewCoverage: 100,
        adversarialPassRate: 100,
        regressionRate: 0,
      },
      topRisks: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Component 1: Open Risk Score (weight: 0.30)
  const riskWeights: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 25, MEDIUM: 50, LOW: 75 };
  const openRiskScore =
    openPRs.reduce((sum, pr) => sum + (riskWeights[pr.riskLevel] ?? 50), 0) / openPRs.length;

  // Component 2: Blind Spot Confidence (weight: 0.25)
  const blindSpotConfidence =
    openPRs.reduce((sum, pr) => sum + pr.blindSpotConfidence, 0) / openPRs.length;

  // Component 3: Unresolved Escalations (weight: 0.20)
  const totalEscalations = openPRs.reduce((sum, pr) => sum + pr.unresolvedEscalations, 0);
  const escalationScore = Math.max(0, 100 - totalEscalations * 15);

  // Component 4: Review Coverage (weight: 0.15)
  const reviewCoverage =
    openPRs.reduce((sum, pr) => sum + pr.reviewCoverage, 0) / openPRs.length;

  // Component 5: Adversarial Pass Rate (weight: 0.10)
  const adversarialPassRate =
    openPRs.reduce((sum, pr) => sum + pr.adversarialPassRate, 0) / openPRs.length;

  // Weighted aggregate
  const score = Math.round(
    openRiskScore * 0.30 +
      blindSpotConfidence * 0.25 +
      escalationScore * 0.20 +
      reviewCoverage * 0.15 +
      adversarialPassRate * 0.10,
  );

  // Trend detection
  const trendPoints = [...history, score];
  let trend: BuildHealthPulse["trend"] = "STABLE";
  if (trendPoints.length >= 3) {
    const recent = trendPoints.slice(-3);
    if (recent[2] > recent[0] + 5) trend = "IMPROVING";
    else if (recent[2] < recent[0] - 5) trend = "DEGRADING";
  }

  // Top risks
  const topRisks = openPRs
    .filter((pr) => pr.riskLevel === "CRITICAL" || pr.riskLevel === "HIGH")
    .sort((a, b) => a.blindSpotConfidence - b.blindSpotConfidence)
    .slice(0, 3)
    .map((pr) => ({
      prNumber: pr.prNumber,
      title: pr.title,
      riskLevel: pr.riskLevel,
      impact: pr.unresolvedEscalations > 0 ? `${pr.unresolvedEscalations} unresolved escalations` : "Confidence below threshold",
    }));

  return {
    score: Math.max(0, Math.min(100, score)),
    trend,
    trendPoints,
    components: {
      openRiskScore: Math.round(openRiskScore),
      blindSpotConfidence: Math.round(blindSpotConfidence),
      unresolvedEscalations: totalEscalations,
      reviewCoverage: Math.round(reviewCoverage),
      adversarialPassRate: Math.round(adversarialPassRate),
      regressionRate: 0, // Would be populated from regret minimizer
    },
    topRisks,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Renders the Build Health Pulse as a Markdown card.
 */
export function renderHealthPulseMarkdown(pulse: BuildHealthPulse): string {
  const colorEmoji =
    pulse.score >= 90 ? "🟢" : pulse.score >= 70 ? "🟡" : pulse.score >= 50 ? "🟠" : pulse.score >= 30 ? "🔴" : "💀";

  const statusLabel =
    pulse.score >= 90 ? "Healthy" : pulse.score >= 70 ? "Watchful" : pulse.score >= 50 ? "Concerning" : pulse.score >= 30 ? "Critical" : "Emergency";

  const trendEmoji =
    pulse.trend === "IMPROVING" ? "📈" : pulse.trend === "DEGRADING" ? "📉" : "➡️";

  return [
    `## ${colorEmoji} Build Health Pulse — ${pulse.score}/100 (${statusLabel})`,
    ``,
    `${trendEmoji} **Trend**: ${pulse.trend}`,
    ``,
    `| Component | Score | Weight |`,
    `|-----------|-------|--------|`,
    `| Open Risk Score | ${pulse.components.openRiskScore}% | 30% |`,
    `| Blind Spot Confidence | ${pulse.components.blindSpotConfidence}% | 25% |`,
    `| Unresolved Escalations | ${pulse.components.unresolvedEscalations} (${Math.max(0, 100 - pulse.components.unresolvedEscalations * 15)}%) | 20% |`,
    `| Review Coverage | ${pulse.components.reviewCoverage}% | 15% |`,
    `| Adversarial Pass Rate | ${pulse.components.adversarialPassRate}% | 10% |`,
    ``,
    pulse.topRisks.length > 0
      ? [
          `**Top Risks**`,
          ...pulse.topRisks.map(
            (r) =>
              `- 🔴 PR #${r.prNumber}: "${r.title}" (${r.riskLevel}) — ${r.impact}`,
          ),
          ``,
        ].join("\n")
      : `> ✅ No critical or high-risk PRs currently open.`,
    ``,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Zod Schemas
// ═══════════════════════════════════════════════════════════════

export const LineConfidenceSchema = z.object({
  line: z.number().int().positive(),
  tier: z.enum(["GREEN", "YELLOW", "RED"]),
  score: z.number().min(0).max(100),
  validatedBy: z.array(z.string()),
  blindSpots: z.array(z.string()),
  needsHumanReview: z.boolean(),
  findingIds: z.array(z.string()),
});

export const BuildHealthPulseSchema = z.object({
  score: z.number().min(0).max(100),
  trend: z.enum(["IMPROVING", "STABLE", "DEGRADING"]),
  trendPoints: z.array(z.number()),
  components: z.object({
    openRiskScore: z.number(),
    blindSpotConfidence: z.number(),
    unresolvedEscalations: z.number(),
    reviewCoverage: z.number(),
    adversarialPassRate: z.number(),
    regressionRate: z.number(),
  }),
  topRisks: z.array(z.object({
    prNumber: z.number(),
    title: z.string(),
    riskLevel: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    impact: z.string(),
  })),
  generatedAt: z.string(),
});

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

export { SIMULATION_TEMPLATES, FIX_TEMPLATES, selectAttackTechnique };
