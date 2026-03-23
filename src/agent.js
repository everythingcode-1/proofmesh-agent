import crypto from 'node:crypto';

export function runAgentWorkflow(input) {
  const startedAt = new Date().toISOString();

  const normalized = {
    title: input.title?.trim() || 'Untitled task',
    description: input.description?.trim() || '',
    budget: Number(input.budget || 0),
    urgency: String(input.urgency || 'medium').toLowerCase(),
    impact: String(input.impact || 'medium').toLowerCase()
  };

  const urgencyScore = { low: 1, medium: 2, high: 3 }[normalized.urgency] ?? 2;
  const impactScore = { low: 1, medium: 2, high: 3 }[normalized.impact] ?? 2;
  const budgetScore = normalized.budget > 10000 ? 3 : normalized.budget > 1000 ? 2 : 1;

  const total = urgencyScore + impactScore + budgetScore;
  const decision = total >= 7 ? 'APPROVE' : total >= 5 ? 'REVIEW' : 'REJECT';

  const confidence = Math.min(0.98, 0.45 + total * 0.07);

  const plan = decision === 'APPROVE'
    ? ['Allocate execution owner', 'Trigger implementation sprint', 'Track KPI daily']
    : decision === 'REVIEW'
      ? ['Collect additional evidence', 'Run risk review', 'Re-score in 24h']
      : ['Archive request', 'Send rationale summary', 'Suggest alternative scope'];

  const endedAt = new Date().toISOString();

  return {
    normalized,
    scoring: { urgencyScore, impactScore, budgetScore, total },
    decision,
    confidence: Number(confidence.toFixed(2)),
    plan,
    runMeta: {
      runId: crypto.randomUUID(),
      startedAt,
      endedAt
    }
  };
}
