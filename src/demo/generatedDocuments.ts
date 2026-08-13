import type { IngestFile } from '../model/types';
import { textToPdfBytes } from './pdfWriter';

/**
 * 36 committed samples + 64 generated records = 100 demo documents — all PDF.
 *
 * Every record is written as a real PDF and parsed back out by pdf.js on
 * load, which costs far more per document than the plain-text corpus this
 * replaced — hence a corpus sized in the hundreds, not thousands.
 *
 * Floor: must stay >= THEMES.length * 3 (60). The cross-reference math below
 * reaches `index + THEMES.length * 2` for early indexes, so a smaller count
 * would emit citations to records that do not exist. Covered by the
 * "keeps every cross-reference inside the corpus" test.
 */
export const GENERATED_DEMO_DOCUMENT_COUNT = 64;
export const BENCHMARK_DEMO_DOCUMENT_COUNT = 2000;
export const GENERATED_DEMO_FILENAME_PREFIX = 'knowledge-record-';

type DemoTheme = {
  slug: string;
  title: string;
  team: string;
  focus: string;
  measures: string;
  systems: string[];
  incidents: string[];
  actions: string[];
  risks: string[];
  artifacts: string[];
};

const THEMES: DemoTheme[] = [
  {
    slug: 'platform-reliability',
    title: 'Platform Reliability',
    team: 'Reliability Engineering',
    focus: 'regional failover, error-budget review, and service recovery',
    measures: 'availability, recovery time, and incident response',
    systems: ['edge-router-west', 'checkout-api', 'session-store', 'failover-orchestrator', 'health-probe-farm'],
    incidents: ['partial regional brownout', 'cascading retry storm', 'cold-start thundering herd', 'stale readiness probe', 'split-brain cache eviction'],
    actions: ['raise error-budget burn alert', 'rehearse multi-region failover', 'tune circuit-breaker thresholds', 'expand synthetic canaries', 'freeze risky deploys'],
    risks: ['single-AZ dependency', 'untested rollback path', 'noisy neighbor saturation', 'secret rotation lag', 'runbook drift'],
    artifacts: ['failover playbook', 'error-budget scorecard', 'postmortem draft', 'capacity forecast', 'SLO burn chart'],
  },
  {
    slug: 'data-platform',
    title: 'Data Platform',
    team: 'Data Infrastructure',
    focus: 'warehouse ingestion, query latency, and retention controls',
    measures: 'freshness, query cost, and pipeline completion',
    systems: ['ingest-bus', 'lakehouse-bronze', 'cube-mart', 'compaction-worker', 'catalog-service'],
    incidents: ['late partition arrival', 'skewed shuffle stage', 'catalog ACL mismatch', 'orphan snapshot retention', 'warehouse slot exhaustion'],
    actions: ['rebalance warehouse slots', 'backfill missing partitions', 'tighten retention TTL', 'rewrite expensive views', 'quarantine dirty batches'],
    risks: ['unchecked schema drift', 'unbounded historical reload', 'PII landing in bronze', 'stale dbt tests', 'cost spike from full scans'],
    artifacts: ['pipeline DAG map', 'freshness SLA sheet', 'cost attribution report', 'schema contract', 'backfill ticket'],
  },
  {
    slug: 'application-security',
    title: 'Application Security',
    team: 'Product Security',
    focus: 'threat modeling, access reviews, and vulnerability remediation',
    measures: 'patch age, control coverage, and audit findings',
    systems: ['vuln-scanner', 'secrets-vault', 'waf-edge', 'sast-pipeline', 'access-review-bot'],
    incidents: ['critical CVE in transitive dep', 'over-privileged service account', 'missing CSP on admin UI', 'stale OAuth client secret', 'unscoped S3 policy'],
    actions: ['patch transitive dependency', 'revoke unused tokens', 'complete threat model review', 'enforce branch protection', 'close audit finding'],
    risks: ['shadow IT integrations', 'unsigned container images', 'shared break-glass accounts', 'incomplete SBOM', 'unlogged admin actions'],
    artifacts: ['threat model', 'vuln backlog', 'access review packet', 'control evidence binder', 'remediation plan'],
  },
  {
    slug: 'customer-success',
    title: 'Customer Success',
    team: 'Customer Operations',
    focus: 'enterprise onboarding, adoption milestones, and escalation follow-up',
    measures: 'time to value, satisfaction, and resolution time',
    systems: ['crm-workspace', 'onboarding-checklist', 'health-score-engine', 'escalation-desk', 'adoption-dashboard'],
    incidents: ['stalled executive sponsor', 'integration kickoff slip', 'training no-show streak', 'renewal risk signal', 'support backlog spike'],
    actions: ['schedule value workshop', 'assign technical account owner', 'reset adoption milestones', 'open executive bridge', 'ship enablement pack'],
    risks: ['champion attrition', 'unclear success criteria', 'competing vendor pilot', ' unpaid professional services', 'feature gap on must-have'],
    artifacts: ['QBR brief', 'adoption roadmap', 'escalation timeline', 'renewal forecast', 'customer health memo'],
  },
  {
    slug: 'developer-experience',
    title: 'Developer Experience',
    team: 'Developer Productivity',
    focus: 'build performance, local environments, and release automation',
    measures: 'build duration, deployment frequency, and developer feedback',
    systems: ['ci-fleet', 'devcontainer-registry', 'artifact-cache', 'preview-environments', 'release-bot'],
    incidents: ['cache stampede after purge', 'flaky e2e suite', 'local env drift', 'queue backlog on PR checks', 'broken codegen step'],
    actions: ['shard the test suite', 'warm remote caches', 'publish golden templates', 'cut flaky tests', 'automate preview teardown'],
    risks: ['mac-only scripts', 'undocumented make targets', 'oversized Docker layers', 'secret leakage in logs', 'manual hotfix culture'],
    artifacts: ['build flamegraph', 'DX survey digest', 'CI budget report', 'template changelog', 'flaky test ledger'],
  },
  {
    slug: 'network-services',
    title: 'Network Services',
    team: 'Cloud Networking',
    focus: 'traffic routing, private connectivity, and capacity forecasting',
    measures: 'packet loss, latency, and utilization',
    systems: ['anycast-edge', 'transit-gateway', 'dns-control-plane', 'private-link-hub', 'flow-log-analyzer'],
    incidents: ['asymmetric routing after cutover', 'DNS TTL mismatch', 'saturated interconnect', 'MTU blackhole', 'BGP flap storm'],
    actions: ['reweight traffic pools', 'expand interconnect capacity', 'normalize DNS TTLs', 'capture flow samples', 'validate failover path'],
    risks: ['single transit provider', 'stale firewall rules', 'unmonitored private endpoints', 'IPv6 dual-stack gaps', 'over-permissive NACLs'],
    artifacts: ['traffic engineering plan', 'latency heatmap', 'capacity model', 'cutover checklist', 'flow anomaly report'],
  },
  {
    slug: 'identity-access',
    title: 'Identity and Access',
    team: 'Identity Engineering',
    focus: 'single sign-on, privileged access, and account lifecycle controls',
    measures: 'provisioning time, review completion, and authentication success',
    systems: ['sso-broker', 'pam-vault', 'scim-bridge', 'mfa-gateway', 'directory-sync'],
    incidents: ['SCIM deprovision lag', 'MFA fatigue spike', 'orphan admin role', 'broken Just-In-Time group map', 'passwordless enrollment drop'],
    actions: ['close orphan accounts', 'enforce phishing-resistant MFA', 'shorten PAM session TTL', 'reconcile group mappings', 'audit break-glass use'],
    risks: ['shared service principals', 'manual joiner/mover/leaver', 'over-broad OAuth scopes', 'stale contractor access', 'unowned app registrations'],
    artifacts: ['access certification pack', 'SSO runbook', 'PAM exception log', 'identity topology map', 'lifecycle KPI sheet'],
  },
  {
    slug: 'billing-operations',
    title: 'Billing Operations',
    team: 'Revenue Systems',
    focus: 'invoice accuracy, payment workflows, and revenue reconciliation',
    measures: 'payment success, dispute rate, and close duration',
    systems: ['invoice-engine', 'payment-orchestrator', 'tax-calculator', 'revenue-ledger', 'dunning-service'],
    incidents: ['tax jurisdiction mismatch', 'double-charge after retry', 'credit memo backlog', 'FX rate stale feed', 'usage meter undercount'],
    actions: ['reissue corrected invoices', 'reconcile ledger variance', 'tune dunning cadence', 'freeze suspect SKUs', 'backfill usage meters'],
    risks: ['manual spreadsheet overrides', 'untested price book change', 'missing tax exemption certs', 'delayed dispute responses', 'partial refunds stuck'],
    artifacts: ['close checklist', 'dispute aging report', 'price book diff', 'reconciliation workbook', 'dunning experiment note'],
  },
  {
    slug: 'product-analytics',
    title: 'Product Analytics',
    team: 'Analytics Engineering',
    focus: 'event quality, experiment reporting, and customer behavior analysis',
    measures: 'event completeness, report freshness, and experiment confidence',
    systems: ['event-collector', 'identity-graph', 'experiment-service', 'metric-store', 'funnel-builder'],
    incidents: ['duplicate pageview flood', 'broken experiment assignment', 'null user_id spike', 'stale cohort definition', 'dashboard join explosion'],
    actions: ['quarantine bad events', 'rebuild identity stitches', 're-run experiment analysis', 'document metric ownership', 'fix funnel steps'],
    risks: ['shadow tracking pixels', 'undefined success metrics', 'PII in event props', 'underpowered experiments', 'conflicting source-of-truth'],
    artifacts: ['event dictionary', 'experiment readout', 'funnel QA notes', 'metric ownership map', 'tracking plan diff'],
  },
  {
    slug: 'compliance-program',
    title: 'Compliance Program',
    team: 'Governance Risk and Compliance',
    focus: 'evidence collection, policy attestations, and control testing',
    measures: 'evidence freshness, control completion, and audit readiness',
    systems: ['control-register', 'evidence-locker', 'policy-portal', 'audit-workspace', 'attestation-bot'],
    incidents: ['expired SOC evidence', 'incomplete access attestations', 'control owner vacancy', 'policy version skew', 'sampling gap in ITGC'],
    actions: ['refresh control evidence', 'reassign control owners', 'close sampling gaps', 'publish policy update', 'prep auditor walkthrough'],
    risks: ['screenshot-only evidence', 'untested compensating controls', 'vendor questionnaire lag', 'scope creep into new products', 'stale risk register'],
    artifacts: ['control test sheet', 'evidence index', 'auditor Q&A log', 'policy attestation report', 'risk treatment plan'],
  },
  {
    slug: 'mobile-experience',
    title: 'Mobile Experience',
    team: 'Mobile Engineering',
    focus: 'application startup, offline behavior, and release quality',
    measures: 'crash-free sessions, startup time, and store rating',
    systems: ['mobile-cdn', 'offline-sync-engine', 'crash-reporter', 'feature-flag-sdk', 'store-release-pipeline'],
    incidents: ['cold-start regression on mid-tier phones', 'offline queue corruption', 'ANR after push open', 'store metadata mismatch', 'feature flag sticky cohort'],
    actions: ['trim startup work', 'repair sync conflict resolver', 'stage phased rollout', 'refresh store screenshots', 'reset sticky flags'],
    risks: ['untested offline paths', 'binary size creep', 'OS version fragmentation', 'unchecked third-party SDK', 'manual release checklist'],
    artifacts: ['startup profile', 'crash triage board', 'rollout gate report', 'store review digest', 'offline test matrix'],
  },
  {
    slug: 'search-relevance',
    title: 'Search Relevance',
    team: 'Search Engineering',
    focus: 'index health, ranking evaluation, and query performance',
    measures: 'successful searches, relevance score, and p95 latency',
    systems: ['indexer-fleet', 'query-planner', 'ranking-model-svc', 'synonym-service', 'relevance-judge'],
    incidents: ['stale index shard', 'ranking model skew', 'synonym loop', 'zero-result surge', 'autocomplete latency cliff'],
    actions: ['reindex dirty shards', 'retrain ranking features', 'prune bad synonyms', 'add offline judgment set', 'cache hot queries'],
    risks: ['training/serving skew', 'unlabeled evaluation set', 'language analyzer mismatch', 'overfitting to head queries', 'missing click privacy filters'],
    artifacts: ['NDCG scorecard', 'zero-result analysis', 'synonym change log', 'latency flamegraph', 'judgment set notes'],
  },
  {
    slug: 'infrastructure-cost',
    title: 'Infrastructure Cost',
    team: 'FinOps',
    focus: 'resource efficiency, commitment planning, and spend attribution',
    measures: 'unit cost, forecast variance, and savings realized',
    systems: ['cost-exporter', 'commitment-planner', 'rightsizing-bot', 'tagging-enforcer', 'budget-alerts'],
    incidents: ['untagged GPU spend spike', 'idle cluster overnight', 'commitment coverage gap', 'egress surprise bill', 'orphan volumes after delete'],
    actions: ['apply missing cost tags', 'purchase commitment coverage', 'rightsize idle nodes', 'delete orphan volumes', 'cap egress-heavy jobs'],
    risks: ['shared account without owners', 'forecast ignores seasonality', 'savings plans misaligned', 'shadow environments', 'chargeback disputes'],
    artifacts: ['unit economics sheet', 'commitment plan', 'rightsizing backlog', 'budget variance memo', 'tagging compliance report'],
  },
  {
    slug: 'partner-integrations',
    title: 'Partner Integrations',
    team: 'Ecosystem Engineering',
    focus: 'connector reliability, API compatibility, and partner launch readiness',
    measures: 'integration success, API errors, and launch completion',
    systems: ['connector-runtime', 'webhook-dispatcher', 'partner-sandbox', 'contract-test-suite', 'marketplace-listing'],
    incidents: ['breaking partner schema change', 'webhook delivery backlog', 'oauth consent screen reject', 'sandbox data wipe', 'rate-limit deadlock'],
    actions: ['pin partner API version', 'replay failed webhooks', 'expand contract tests', 'refresh sandbox fixtures', 'coordinate launch checklist'],
    risks: ['undocumented partner quirks', 'shared credentials across tenants', 'missing idempotency keys', 'slow partner support SLA', 'marketplace review delays'],
    artifacts: ['connector status board', 'contract test report', 'launch readiness pack', 'partner escalation log', 'API deprecation notice'],
  },
  {
    slug: 'privacy-engineering',
    title: 'Privacy Engineering',
    team: 'Privacy Engineering',
    focus: 'data minimization, deletion workflows, and consent enforcement',
    measures: 'deletion completion, consent coverage, and data inventory accuracy',
    systems: ['deletion-orchestrator', 'consent-ledger', 'data-map-service', 'retention-enforcer', 'dsar-intake'],
    incidents: ['stuck deletion job', 'consent flag desync', 'undocumented derived dataset', 'DSAR backlog breach', 'retention policy conflict'],
    actions: ['replay failed deletions', 'reconcile consent ledger', 'extend data map coverage', 'prioritize DSAR queue', 'align retention TTLs'],
    risks: ['shadow analytics exports', 'vendor subprocessors unlisted', 'hard-deleted audit trails', 'consent UX dark patterns', 'cross-border transfer gaps'],
    artifacts: ['deletion SLA report', 'data map excerpt', 'DSAR aging board', 'consent coverage chart', 'subprocessor review'],
  },
  {
    slug: 'support-automation',
    title: 'Support Automation',
    team: 'Support Systems',
    focus: 'case routing, knowledge coverage, and automated resolution',
    measures: 'deflection rate, first response, and escalation volume',
    systems: ['case-router', 'knowledge-base', 'macro-engine', 'chatbot-runtime', 'sla-monitor'],
    incidents: ['misrouted enterprise cases', 'stale knowledge article', 'chatbot hallucination', 'macro loop on refunds', 'SLA breach cluster'],
    actions: ['retune routing rules', 'refresh top articles', 'constrain bot answers', 'disable risky macros', 'staff surge queue'],
    risks: ['KB coverage holes', 'over-automation on billing', 'unclear escalation ownership', 'language detection misses', 'CSAT drop after bot'],
    artifacts: ['routing decision tree', 'deflection scorecard', 'article freshness audit', 'bot transcript review', 'SLA breach postmortem'],
  },
  {
    slug: 'release-management',
    title: 'Release Management',
    team: 'Release Engineering',
    focus: 'change approvals, rollout safety, and rollback preparedness',
    measures: 'release success, change lead time, and rollback rate',
    systems: ['change-calendar', 'progressive-delivery', 'rollback-controller', 'approval-gate', 'release-notes-bot'],
    incidents: ['blocked production freeze', 'canary false negative', 'rollback artifact missing', 'approval bypass exception', 'notes omit breaking change'],
    actions: ['stage canary gates', 'rebuild rollback artifacts', 'tighten approval policy', 'publish change calendar', 'document freeze exceptions'],
    risks: ['manual prod hotfixes', 'unowned release trains', 'incomplete blast-radius maps', 'Friday deploy culture', 'unsigned release artifacts'],
    artifacts: ['release train board', 'canary analysis', 'rollback drill log', 'change advisory minutes', 'freeze exception form'],
  },
  {
    slug: 'workforce-planning',
    title: 'Workforce Planning',
    team: 'People Operations',
    focus: 'hiring capacity, onboarding readiness, and skills development',
    measures: 'time to hire, onboarding completion, and staffing coverage',
    systems: ['ats-pipeline', 'onboarding-portal', 'skills-graph', 'headcount-model', 'mentor-matching'],
    incidents: ['offer accept rate dip', 'onboarding buddy gap', 'critical role vacancy', 'skills taxonomy drift', 'interview loop overload'],
    actions: ['open surge requisitions', 'assign onboarding buddies', 'refresh skills taxonomy', 'rebalance interview load', 'fund targeted upskilling'],
    risks: ['hiring manager bandwidth', 'comp band misalignment', 'knowledge silos after attrition', 'contractor conversion lag', 'uneven leveling'],
    artifacts: ['headcount plan', 'onboarding completion report', 'skills gap analysis', 'interview capacity model', 'offer funnel review'],
  },
  {
    slug: 'observability',
    title: 'Observability',
    team: 'Observability Engineering',
    focus: 'telemetry coverage, alert quality, and diagnostic workflows',
    measures: 'signal coverage, alert precision, and mean time to diagnose',
    systems: ['metrics-gateway', 'trace-collector', 'log-lake', 'alert-manager', 'runbook-linker'],
    incidents: ['alert flapping', 'missing RED metrics', 'trace sampling drop', 'cardinality explosion', 'orphan dashboards'],
    actions: ['dedupe noisy alerts', 'instrument critical paths', 'raise sampling on errors', 'cap high-cardinality labels', 'archive unused dashboards'],
    risks: ['dashboard-driven ops', 'unlinked runbooks', 'vendor lock-in exporters', 'PII in span attributes', 'alert ownership voids'],
    artifacts: ['alert quality scorecard', 'coverage heatmap', 'cardinality budget', 'runbook index', 'MTTR trend note'],
  },
  {
    slug: 'api-governance',
    title: 'API Governance',
    team: 'API Platform',
    focus: 'contract consistency, versioning policy, and consumer communication',
    measures: 'breaking changes, adoption rate, and documentation coverage',
    systems: ['schema-registry', 'gateway-policy', 'consumer-portal', 'lint-pipeline', 'deprecation-tracker'],
    incidents: ['unannounced breaking field', 'version skew across regions', 'docs out of date', 'consumer stuck on v1', 'gateway auth inconsistency'],
    actions: ['publish deprecation notice', 'lint OpenAPI diffs', 'migrate lagging consumers', 'align gateway policies', 'refresh portal examples'],
    risks: ['shadow APIs outside registry', 'permanent beta endpoints', 'inconsistent error envelopes', 'missing changelog ownership', 'overly chatty payloads'],
    artifacts: ['API catalog entry', 'breaking-change review', 'consumer adoption chart', 'deprecation timeline', 'OpenAPI lint report'],
  },
];

const PEOPLE = [
  'Amina Cole', 'Jordan Blake', 'Priya Nair', 'Sam Okonkwo', 'Elena Vasquez',
  'Marcus Chen', 'Riley Hoffman', 'Noah Berg', 'Sofia Alvarez', 'Kenji Watanabe',
  'Harper Quinn', 'Diego Morales', 'Leah Kim', 'Owen Patel', 'Maya Rostami',
  'Chris Delgado', 'Ivy Fontaine', 'Theo Andersson', 'Nadia Rahman', 'Victor Lau',
];

const SITES = [
  'us-east-1a', 'eu-west-2b', 'ap-southeast-1c', 'us-central lab', 'toronto NOC',
  'dublin edge', 'singapore POP', 'são paulo AZ', 'sydney DR site', 'frankfurt hub',
];

const CUSTOMERS = [
  'Northwind Logistics', 'Contoso Health', 'Fabrikam Retail', 'Adventure Works',
  'Wide World Importers', 'Litware Media', 'Tailspin Toys', 'Woodgrove Bank',
  'Proseware Analytics', 'Alpine Ski House',
];

const OUTCOMES = [
  'stabilized within the maintenance window',
  'reduced customer-visible impact by half',
  'unblocked the dependent launch train',
  'restored the scorecard to green',
  'cleared the audit exception path',
  'cut mean handling time below target',
  'removed a single point of failure',
  'brought the forecast back inside tolerance',
];

/** Freeform vocabulary used only to diversify embeddings across same-theme clones. */
const DETAIL_VERBS = [
  'rehearsed', 'quantified', 'isolated', 'instrumented', 'renegotiated', 'shadowed',
  'replayed', 'throttled', 'catalogued', 'benchmarked', 'untangled', 'forecasted',
  'serialized', 'partitioned', 'validated', 'annotated', 'diffed', 'triaged',
];
const DETAIL_NOUNS = [
  'handoff', 'cohort', 'runbook', 'fixture', 'canary', 'ledger', 'backlog', 'topology',
  'checklist', 'heatmap', 'quota', 'sidecar', 'playbook', 'snapshot', 'manifest', 'throttle',
  'digest', 'bridge', 'buffer', 'contract', 'sampler', 'watchdog', 'shard', 'rollup',
];
const DETAIL_ADJECTIVES = [
  'brittle', 'noisy', 'latent', 'asymmetric', 'stale', 'bursty', 'opaque', 'fragile',
  'saturated', 'orphaned', 'skewed', 'idempotent', 'chatty', 'dormant', 'recursive', 'spiky',
];
const DETAIL_OBJECTS = [
  'retry budget', 'ownership matrix', 'traffic mirror', 'config drift', 'cold path',
  'warm pool', 'exception ledger', 'feature cohort', 'capacity envelope', 'error taxonomy',
  'release train', 'signal dictionary', 'dependency graph', 'control sample', 'failover drill',
];

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function pickUnique<T>(rng: () => number, items: readonly T[], count: number): T[] {
  const pool = items.slice();
  const chosen: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]!);
  }
  return chosen;
}

function dayOfYear(index: number): string {
  const day = ((index * 17) % 365) + 1;
  const date = new Date(Date.UTC(2026, 0, day));
  return date.toISOString().slice(0, 10);
}

export function generatedDemoFilename(index: number, count = GENERATED_DEMO_DOCUMENT_COUNT): string {
  const theme = THEMES[(index - 1) % THEMES.length]!;
  const paddedIndex = String(index).padStart(Math.max(4, String(count).length), '0');
  return `${GENERATED_DEMO_FILENAME_PREFIX}${paddedIndex}-${theme.slug}.pdf`;
}

export function isGeneratedDemoFilename(name: string, count: number): boolean {
  const match = new RegExp(`^${GENERATED_DEMO_FILENAME_PREFIX}(\\d+)-[a-z-]+\\.pdf$`).exec(name);
  if (!match) return false;
  const index = Number(match[1]);
  return index >= 1 && index <= count && generatedDemoFilename(index, count) === name;
}

/**
 * Committed sample PDFs each generated record can cite as its "canonical
 * binder" — bridges the synthetic clusters to the hand-written samples so
 * reference edges connect both halves of the demo corpus. Keys are theme
 * slugs; values are filenames from public/demo/manifest.json.
 */
const SAMPLE_CITATIONS: Record<string, string[]> = {
  'platform-reliability': ['incident-2026-04-outage-report.pdf', 'incident-post-mortem-2026-05.pdf', 'disaster-recovery-plan.pdf'],
  'data-platform': ['postgres-performance-tuning.pdf', 'postgres-upgrade-plan.pdf', 'migration-checklist.pdf'],
  'application-security': ['penetration-test-report.pdf', 'security-audit-report.pdf', 'incident-response-training.pdf'],
  'customer-success': ['customer-case-study-acme.pdf', 'sla-agreement-enterprise.pdf', 'quarterly-business-review.pdf'],
  'developer-experience': ['load-test-results.pdf', 'kubernetes-training-handout.pdf', 'weekly-eng-sync-notes.pdf'],
  'network-services': ['network-architecture-overview.pdf', 'capacity-planning-notes.pdf'],
  'identity-access': ['security-audit-report.pdf', 'soc2-type2-audit-letter.pdf'],
  'billing-operations': ['vendor-contract-summary.pdf', 'quarterly-business-review.pdf'],
  'product-analytics': ['api-gateway-benchmark.pdf', 'load-test-results.pdf'],
  'compliance-program': ['soc2-type2-audit-letter.pdf', 'compliance-certificate-iso27001.pdf', 'gdpr-dpia-assessment.pdf'],
  'mobile-experience': ['feature-flag-cleanup-log.pdf', 'q3-platform-roadmap-review.pdf'],
  'search-relevance': ['api-gateway-benchmark.pdf', 'load-test-results.pdf'],
  'infrastructure-cost': ['cloud-cost-analysis.pdf', 'capacity-planning-notes.pdf'],
  'partner-integrations': ['vendor-review-notes.pdf', 'api-style-guide.pdf'],
  'privacy-engineering': ['gdpr-dpia-assessment.pdf', 'data-privacy-policy.pdf'],
  'support-automation': ['customer-support-escalations.pdf', 'sla-agreement-enterprise.pdf'],
  'release-management': ['q3-platform-roadmap-review.pdf', 'migration-checklist.pdf', 'feature-flag-cleanup-log.pdf'],
  'workforce-planning': ['hiring-plan-h2-2026.pdf', 'employee-benefits-overview.pdf', 'onboarding-checklist.pdf', 'team-offsite-summary.pdf'],
  observability: ['oncall-handoff-notes.pdf', 'incident-2026-04-outage-report.pdf'],
  'api-governance': ['api-style-guide.pdf', 'api-gateway-benchmark.pdf', 'architecture-all-hands.pdf'],
};

const LEADS = [
  'Opened after an external escalation',
  'Captured during a weekly operating review',
  'Spawned from an automated anomaly ticket',
  'Written up after a tabletop exercise',
  'Filed when a partner integration stalled',
  'Started from a customer advisory board question',
];

const PRESSURES = [
  'a hard external deadline',
  'an executive visibility spike',
  'a contractual audit window',
  'a launch freeze approaching',
  'a sudden traffic mix shift',
  'a staffing gap on the on-call rotation',
];

/**
 * Deterministic, per-index body text. Same-theme records intentionally diverge
 * in entities, narrative, and numbers so embedding cosine stays below the
 * duplicate threshold used by Insights.
 */
export function generatedDemoText(
  index: number,
  theme: DemoTheme = THEMES[(index - 1) % THEMES.length]!,
  count = GENERATED_DEMO_DOCUMENT_COUNT,
): string {
  const rng = mulberry32(index * 2654435761);
  const owner = pick(rng, PEOPLE);
  const reviewer = pick(rng, PEOPLE.filter((p) => p !== owner));
  const witness = pick(rng, PEOPLE.filter((p) => p !== owner && p !== reviewer));
  const site = pick(rng, SITES);
  const altSite = pick(rng, SITES.filter((s) => s !== site));
  const customer = pick(rng, CUSTOMERS);
  const altCustomer = pick(rng, CUSTOMERS.filter((c) => c !== customer));
  const systems = pickUnique(rng, theme.systems, 3);
  const incidents = pickUnique(rng, theme.incidents, 2);
  const actions = pickUnique(rng, theme.actions, 3);
  const risks = pickUnique(rng, theme.risks, 2);
  const artifacts = pickUnique(rng, theme.artifacts, 2);
  const outcome = pick(rng, OUTCOMES);
  const lead = pick(rng, LEADS);
  const pressure = pick(rng, PRESSURES);
  const week = ((index * 7) % 52) + 1;
  const quarter = ((index + 2) % 4) + 1;
  const severity = 1 + (index % 4);
  const impactHours = 1 + ((index * 3) % 37);
  const scoreBefore = 40 + ((index * 11) % 45);
  const scoreAfter = Math.min(99, scoreBefore + 8 + (index % 17));
  const budget = 12_000 + ((index * 997) % 88_000);
  const tickets = 3 + ((index * 13) % 41);
  const samples = 20 + ((index * 19) % 180);
  const latencyMs = 40 + ((index * 23) % 900);
  const date = dayOfYear(index);
  const ref = `KNEB-${String(index).padStart(Math.max(4, String(count).length), '0')}`;
  const alias = `${theme.slug.slice(0, 3).toUpperCase()}-${(index * 41) % 9000 + 1000}`;
  const metricA = theme.measures.split(',')[0]!.trim();
  const metricB = theme.measures.split(',')[1]?.trim() ?? theme.measures;

  const openings = [
    `${lead}: ${owner} logged ${ref} when ${customer} hit ${incidents[0]} on ${systems[0]} in ${site}.`,
    `${lead}: ${reviewer} asked ${owner} to capture ${alias} after ${incidents[0]} bled into ${altSite}.`,
    `${lead}: ${witness} paged ${theme.team} about ${incidents[1]}; ${owner} turned the thread into ${ref}.`,
  ];
  const contexts = [
    `The trigger sat next to ${pressure}, so ${theme.team} treated SEV-${severity} work as interrupt-driven rather than backlog grooming.`,
    `Because ${altCustomer} saw a quieter echo of the same pattern, the write-up keeps both ${customer} and ${altCustomer} in the account trail.`,
    `${site} carried ${impactHours}h of degraded ${metricA} while ${altSite} stayed mostly clean, which narrowed the blast-radius story.`,
  ];
  const evidence = [
    `${samples} sampled traces around ${systems[1]} showed p95 near ${latencyMs}ms; ${artifacts[0]} was updated with the raw excerpts.`,
    `${witness} attached ${artifacts[1]} plus ${tickets} linked tickets. The noisy neighbor was ${systems[2]}, not the first suspect ${systems[0]}.`,
    `Budget pressure landed near $${budget.toLocaleString('en-US')} if ${risks[0]} compounds; ${reviewer} wants that number in the next steering pack.`,
  ];
  const moves = [
    `Committed sequence for ${alias}: ${actions[0]}, then ${actions[1]}, with ${actions[2]} gated on ${customer} sign-off.`,
    `${owner} owns ${actions[0]} in ${site}; ${reviewer} owns ${actions[2]} only if ${metricB} stays below ${scoreAfter}.`,
    `Parking ${actions[1]} until ${date} avoids stacking change risk on top of ${incidents[1]}.`,
  ];
  const closes = [
    `Exit when ${metricA} climbs from ${scoreBefore} toward ${scoreAfter} and ${outcome}.`,
    `Keep ${risks[1]} on the watchlist for ${7 + (index % 14)} days; mention ${incidents[1]} in the ${customer} update.`,
    `Stamp for graph joins: ${ref}/${alias}/${theme.slug}/w${week}-q${quarter}/${index}.`,
  ];

  // Deterministic cross-references — exact filenames of sibling records, so
  // the reference-edge pass (mentions in body text) yields real, predictable
  // connections: chains within a theme, bridges across themes, and citations
  // into the committed sample PDFs.
  const prevInTheme =
    count > THEMES.length * 2
      ? index - THEMES.length >= 1
        ? index - THEMES.length
        : index + THEMES.length * 2
      : ((index - THEMES.length - 1 + count) % count) + 1;
  const nextInTheme =
    count > THEMES.length * 2
      ? index + THEMES.length <= count
        ? index + THEMES.length
        : index - THEMES.length * 2
      : ((index + THEMES.length - 1) % count) + 1;
  let partner = ((index * 137 + 71) % count) + 1;
  if (partner === index || (partner - index + count) % THEMES.length === 0) {
    partner = (partner % count) + 1;
  }
  const partnerTheme = THEMES[(partner - 1) % THEMES.length]!;
  const citations = SAMPLE_CITATIONS[theme.slug] ?? [];
  const citation = citations.length > 0 && index % 2 === 0 ? citations[index % citations.length]! : null;
  // Wording rotates on a private stream (not the body rng) so same-theme
  // records rarely share citation phrasing — keeps the near-duplicate guard
  // honest while the filenames themselves stay deterministic.
  const relRng = mulberry32(index * 96487 + 17);
  const prevLine = pick(relRng, [
    `- Continuity: ${generatedDemoFilename(prevInTheme, count)} carries the prior cycle of this ${theme.title} thread.`,
    `- Earlier chapter: ${generatedDemoFilename(prevInTheme, count)} holds where this stood last cycle.`,
    `- Backstory lives in ${generatedDemoFilename(prevInTheme, count)}, the previous pass over the same ground.`,
  ]);
  const nextLine = pick(relRng, [
    `- Follow-up: ${generatedDemoFilename(nextInTheme, count)} picks up the open actions in the next cycle.`,
    `- Next in line: ${generatedDemoFilename(nextInTheme, count)} inherits whatever stays unresolved here.`,
    `- Handoff lands in ${generatedDemoFilename(nextInTheme, count)} once this record closes out.`,
  ]);
  const partnerLine = pick(relRng, [
    `- Cross-team view: ${generatedDemoFilename(partner, count)} reads the same pressure from the ${partnerTheme.title} side.`,
    `- Sibling signal: ${generatedDemoFilename(partner, count)} watches a parallel symptom inside ${partnerTheme.title}.`,
    `- Outside angle: ${generatedDemoFilename(partner, count)} frames this from ${partnerTheme.title}'s vantage.`,
  ]);
  const citationLine = citation
    ? pick(relRng, [
        `- Canonical binder: ${citation} stays the source of record for ${theme.team}.`,
        `- Reference shelf: ${citation} anchors the evidence set ${theme.team} audits against.`,
        `- Standing doc: ${citation} keeps the durable version of this program.`,
      ])
    : null;
  const relatedLines = [prevLine, nextLine, partnerLine, ...(citationLine ? [citationLine] : [])];

  const sectionTitles = [
    ['## What happened', '## What we know', '## What we will do', '## How we close it'],
    ['## Trigger', '## Evidence', '## Commitments', '## Exit criteria'],
    ['## Context', '## Signals', '## Plan', '## Residual risk'],
  ][index % 3]!;

  // Extra freeform lines keep same-theme embeddings from collapsing: each index
  // draws a private mix of verbs/nouns that does not recur on the theme cycle.
  const detailLines = Array.from({ length: 5 }, (_, line) => {
    const verb = pick(rng, DETAIL_VERBS);
    const adj = pick(rng, DETAIL_ADJECTIVES);
    const noun = pick(rng, DETAIL_NOUNS);
    const object = pick(rng, DETAIL_OBJECTS);
    const other = pick(rng, DETAIL_NOUNS);
    return `Detail ${index}.${line + 1}: ${owner.split(' ')[0]} ${verb} a ${adj} ${noun} against the ${object}, then filed notes under ${alias}-${other}-${(index * (line + 3)) % 997}.`;
  });

  return `# ${theme.title} — ${alias} (record ${String(index).padStart(4, '0')})

${ref} · ${date} · ${owner} / ${reviewer} · ${theme.team}
Focus lens: ${theme.focus}
Locale mix: ${site} + ${altSite}

${sectionTitles[0]}
${openings[index % openings.length]}
${contexts[(index + 1) % contexts.length]}
Secondary symptom tracked as ${incidents[1]} while ${systems.join(' / ')} stayed in the investigation set.

${sectionTitles[1]}
${evidence[index % evidence.length]}
${evidence[(index + 1) % evidence.length]}
Hypothesis peculiar to this note: ${systems[0]} and ${systems[1]} only collide when ${customer} traffic includes the ${alias} cohort shape.

${sectionTitles[2]}
${moves[(index + 2) % moves.length]}
${moves[(index + 1) % moves.length]}
Out of scope here: renaming ${systems[2]}, rewriting unrelated ${metricB} dashboards, and expanding into ${altCustomer}'s unrelated backlog.

${sectionTitles[3]}
${closes[index % closes.length]}
${closes[(index + 2) % closes.length]}
Artifact trail: ${artifacts.join('; ')}. Residual concerns: ${risks.join('; ')}.

## Related records
${relatedLines.join('\n')}

## Field scratchpad
${detailLines.join('\n')}
`;
}

/** Build the synthetic, browser-local portion of the large demo corpus — real PDFs. */
export function createGeneratedDemoDocuments(count: number): IngestFile[] {
  const effectiveCount = Math.max(GENERATED_DEMO_DOCUMENT_COUNT, count);
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const theme = THEMES[offset % THEMES.length]!;
    const name = generatedDemoFilename(index, effectiveCount);
    const text = generatedDemoText(index, theme, effectiveCount);
    const title = text.split('\n')[0]!.replace(/^#\s*/, '');
    return {
      fileId: crypto.randomUUID(),
      name,
      path: `demo/generated/${name}`,
      fileType: 'pdf',
      bytes: textToPdfBytes(title, text),
      // Originals ARE retained (no `reconstructable` flag): the side panel's
      // PDF preview and "Open original file" need the real bytes, and at 64
      // records × ~4KB the IndexedDB cost is trivial — the skip-retention
      // optimization was sized for the old 1,964-doc text corpus.
    };
  });
}

export function createBenchmarkDemoDocuments(count = BENCHMARK_DEMO_DOCUMENT_COUNT): IngestFile[] {
  return createGeneratedDemoDocuments(count);
}
