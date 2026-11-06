// Compatibility boundary for consumers that have not yet migrated to aid-core.
// The implementation and security policy have exactly one owner.
export { createStreamingSecretRedactor, redactSecrets } from '../../aid-core/src/redaction.ts';
