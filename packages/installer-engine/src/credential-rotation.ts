import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);

export const CredentialRotationPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  rotationId: id,
  credentialClass: z.enum(['service-api-token']),
  consumerId: id,
  historicalVersionRef: z.string().regex(/^infisical:\/\/[a-zA-Z0-9._~:/-]+#[a-zA-Z0-9._-]+$/),
  candidateVersionRef: z.string().regex(/^infisical:\/\/[a-zA-Z0-9._~:/-]+#[a-zA-Z0-9._-]+$/),
  historicalDigest: digest,
  candidateDigest: digest,
  expiresAt: timestamp,
}).superRefine((value, context) => {
  if (value.historicalVersionRef === value.candidateVersionRef || value.historicalDigest === value.candidateDigest) {
    context.addIssue({ code: 'custom', message: 'candidate and historical credential versions must be distinct' });
  }
});

export const CredentialRotationStateSchema = z.strictObject({
  schemaVersion: z.literal(1), rotationId: id,
  phase: z.enum(['staged', 'candidate-reloaded', 'candidate-verified', 'rolled-back', 'historical-retired']),
  activeDigest: digest, historicalDigest: digest, candidateDigest: digest,
  reloadEvidenceDigest: digest.nullable(), verificationEvidenceDigest: digest.nullable(), rollbackEvidenceDigest: digest.nullable(),
  historicalRetained: z.boolean(), updatedAt: timestamp,
}).superRefine((value, context) => {
  if (value.phase === 'historical-retired' && value.historicalRetained) context.addIssue({ code: 'custom', message: 'retired historical credential cannot remain retained' });
  if (value.phase !== 'historical-retired' && !value.historicalRetained) context.addIssue({ code: 'custom', message: 'historical credential must remain until retirement is proven safe' });
  if (['candidate-reloaded','candidate-verified','historical-retired'].includes(value.phase) && !value.reloadEvidenceDigest) context.addIssue({ code: 'custom', message: 'candidate reload evidence is required' });
  if (['candidate-verified','historical-retired'].includes(value.phase) && !value.verificationEvidenceDigest) context.addIssue({ code: 'custom', message: 'candidate verification evidence is required' });
  if (value.phase === 'rolled-back' && (!value.rollbackEvidenceDigest || value.activeDigest !== value.historicalDigest)) context.addIssue({ code: 'custom', message: 'rollback must prove the historical credential is active' });
});
export type CredentialRotationState = z.infer<typeof CredentialRotationStateSchema>;

export function beginCredentialRotation(planInput: unknown, nowInput: string): CredentialRotationState {
  const plan = CredentialRotationPlanSchema.parse(planInput); const now = timestamp.parse(nowInput);
  if (Date.parse(now) >= Date.parse(plan.expiresAt)) throw new Error('credential rotation plan is expired');
  return CredentialRotationStateSchema.parse({ schemaVersion: 1, rotationId: plan.rotationId, phase: 'staged', activeDigest: plan.historicalDigest,
    historicalDigest: plan.historicalDigest, candidateDigest: plan.candidateDigest, reloadEvidenceDigest: null,
    verificationEvidenceDigest: null, rollbackEvidenceDigest: null, historicalRetained: true, updatedAt: now });
}

export function advanceCredentialRotation(stateInput: unknown, input: {
  action: 'record-reload' | 'record-verification' | 'rollback' | 'retire-historical';
  at: string; evidenceDigest: string;
}): CredentialRotationState {
  const state = CredentialRotationStateSchema.parse(stateInput); const at = timestamp.parse(input.at); const evidence = digest.parse(input.evidenceDigest);
  if (Date.parse(at) <= Date.parse(state.updatedAt)) throw new Error('rotation evidence must advance monotonically');
  if (input.action === 'record-reload') {
    if (state.phase !== 'staged') throw new Error('candidate reload requires staged rotation');
    return CredentialRotationStateSchema.parse({ ...state, phase: 'candidate-reloaded', activeDigest: state.candidateDigest, reloadEvidenceDigest: evidence, updatedAt: at });
  }
  if (input.action === 'record-verification') {
    if (state.phase !== 'candidate-reloaded') throw new Error('candidate verification requires reload evidence');
    return CredentialRotationStateSchema.parse({ ...state, phase: 'candidate-verified', verificationEvidenceDigest: evidence, updatedAt: at });
  }
  if (input.action === 'rollback') {
    if (state.phase !== 'candidate-reloaded' && state.phase !== 'candidate-verified') throw new Error('rollback requires a reloaded candidate');
    return CredentialRotationStateSchema.parse({ ...state, phase: 'rolled-back', activeDigest: state.historicalDigest, rollbackEvidenceDigest: evidence, updatedAt: at });
  }
  if (state.phase !== 'candidate-verified') throw new Error('historical retirement requires verified consumer reload');
  return CredentialRotationStateSchema.parse({ ...state, phase: 'historical-retired', historicalRetained: false, updatedAt: at });
}

