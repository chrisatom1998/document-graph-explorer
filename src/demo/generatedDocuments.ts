import type { IngestFile } from '../model/types';

/** 36 committed samples + 1,964 generated records = 2,000 demo documents. */
export const GENERATED_DEMO_DOCUMENT_COUNT = 1964;
export const GENERATED_DEMO_FILENAME_PREFIX = 'knowledge-record-';

type DemoTheme = {
  slug: string;
  title: string;
  team: string;
  focus: string;
  measures: string;
};

const THEMES: DemoTheme[] = [
  { slug: 'platform-reliability', title: 'Platform Reliability', team: 'Reliability Engineering', focus: 'regional failover, error-budget review, and service recovery', measures: 'availability, recovery time, and incident response' },
  { slug: 'data-platform', title: 'Data Platform', team: 'Data Infrastructure', focus: 'warehouse ingestion, query latency, and retention controls', measures: 'freshness, query cost, and pipeline completion' },
  { slug: 'application-security', title: 'Application Security', team: 'Product Security', focus: 'threat modeling, access reviews, and vulnerability remediation', measures: 'patch age, control coverage, and audit findings' },
  { slug: 'customer-success', title: 'Customer Success', team: 'Customer Operations', focus: 'enterprise onboarding, adoption milestones, and escalation follow-up', measures: 'time to value, satisfaction, and resolution time' },
  { slug: 'developer-experience', title: 'Developer Experience', team: 'Developer Productivity', focus: 'build performance, local environments, and release automation', measures: 'build duration, deployment frequency, and developer feedback' },
  { slug: 'network-services', title: 'Network Services', team: 'Cloud Networking', focus: 'traffic routing, private connectivity, and capacity forecasting', measures: 'packet loss, latency, and utilization' },
  { slug: 'identity-access', title: 'Identity and Access', team: 'Identity Engineering', focus: 'single sign-on, privileged access, and account lifecycle controls', measures: 'provisioning time, review completion, and authentication success' },
  { slug: 'billing-operations', title: 'Billing Operations', team: 'Revenue Systems', focus: 'invoice accuracy, payment workflows, and revenue reconciliation', measures: 'payment success, dispute rate, and close duration' },
  { slug: 'product-analytics', title: 'Product Analytics', team: 'Analytics Engineering', focus: 'event quality, experiment reporting, and customer behavior analysis', measures: 'event completeness, report freshness, and experiment confidence' },
  { slug: 'compliance-program', title: 'Compliance Program', team: 'Governance Risk and Compliance', focus: 'evidence collection, policy attestations, and control testing', measures: 'evidence freshness, control completion, and audit readiness' },
  { slug: 'mobile-experience', title: 'Mobile Experience', team: 'Mobile Engineering', focus: 'application startup, offline behavior, and release quality', measures: 'crash-free sessions, startup time, and store rating' },
  { slug: 'search-relevance', title: 'Search Relevance', team: 'Search Engineering', focus: 'index health, ranking evaluation, and query performance', measures: 'successful searches, relevance score, and p95 latency' },
  { slug: 'infrastructure-cost', title: 'Infrastructure Cost', team: 'FinOps', focus: 'resource efficiency, commitment planning, and spend attribution', measures: 'unit cost, forecast variance, and savings realized' },
  { slug: 'partner-integrations', title: 'Partner Integrations', team: 'Ecosystem Engineering', focus: 'connector reliability, API compatibility, and partner launch readiness', measures: 'integration success, API errors, and launch completion' },
  { slug: 'privacy-engineering', title: 'Privacy Engineering', team: 'Privacy Engineering', focus: 'data minimization, deletion workflows, and consent enforcement', measures: 'deletion completion, consent coverage, and data inventory accuracy' },
  { slug: 'support-automation', title: 'Support Automation', team: 'Support Systems', focus: 'case routing, knowledge coverage, and automated resolution', measures: 'deflection rate, first response, and escalation volume' },
  { slug: 'release-management', title: 'Release Management', team: 'Release Engineering', focus: 'change approvals, rollout safety, and rollback preparedness', measures: 'release success, change lead time, and rollback rate' },
  { slug: 'workforce-planning', title: 'Workforce Planning', team: 'People Operations', focus: 'hiring capacity, onboarding readiness, and skills development', measures: 'time to hire, onboarding completion, and staffing coverage' },
  { slug: 'observability', title: 'Observability', team: 'Observability Engineering', focus: 'telemetry coverage, alert quality, and diagnostic workflows', measures: 'signal coverage, alert precision, and mean time to diagnose' },
  { slug: 'api-governance', title: 'API Governance', team: 'API Platform', focus: 'contract consistency, versioning policy, and consumer communication', measures: 'breaking changes, adoption rate, and documentation coverage' },
];

export interface DemoManifestGenerated {
  count: number;
}

export function generatedDemoFilename(index: number): string {
  const theme = THEMES[(index - 1) % THEMES.length];
  return `${GENERATED_DEMO_FILENAME_PREFIX}${String(index).padStart(4, '0')}-${theme.slug}.txt`;
}

export function isGeneratedDemoFilename(name: string, count: number): boolean {
  const match = new RegExp(`^${GENERATED_DEMO_FILENAME_PREFIX}(\\d{4})-[a-z-]+\\.txt$`).exec(name);
  if (!match) return false;
  const index = Number(match[1]);
  return index >= 1 && index <= count && generatedDemoFilename(index) === name;
}

function generatedDemoText(index: number, theme: DemoTheme): string {
  const quarter = (index % 4) + 1;
  const week = (index % 52) + 1;
  const target = 80 + (index % 19);
  const completed = 62 + (index % 31);
  return `# ${theme.title} Working Record ${String(index).padStart(4, '0')}

Owner: ${theme.team}
Reporting period: 2026 Q${quarter}, week ${week}
Program reference: KNEB-${String(index).padStart(4, '0')}

## Objective
This working record tracks ${theme.focus}. The team is coordinating a repeatable operating plan with partner teams and documenting decisions for the next planning review.

## Current status
The latest review completed ${completed} of ${target} planned checkpoints. The remaining work is prioritized by customer impact, operational risk, and dependencies identified during the weekly review. Owners will validate the next milestone before the release window.

## Measures and follow-up
The scorecard covers ${theme.measures}. This record includes a unique program reference and reporting window so it can be connected to related planning, delivery, and retrospective documents in the knowledge graph.
`;
}

/** Build the synthetic, browser-local portion of the large demo corpus. */
export function createGeneratedDemoDocuments(count: number): IngestFile[] {
  const encoder = new TextEncoder();
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const theme = THEMES[offset % THEMES.length];
    const name = generatedDemoFilename(index);
    return {
      fileId: crypto.randomUUID(),
      name,
      path: `demo/generated/${name}`,
      fileType: 'txt',
      bytes: encoder.encode(generatedDemoText(index, theme)).buffer,
      // Rebuildable from index + theme, so ingest skips retaining the bytes.
      reconstructable: true,
    };
  });
}
