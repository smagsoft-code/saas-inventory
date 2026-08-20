/**
 * Re-exports the shared role-template source of truth — moved to packages/shared in Prompt 04 so
 * both this seed script and apps/api/src/auth (self-service tenant provisioning) consume the same
 * definition instead of maintaining two copies. See packages/shared/src/index.ts for the full
 * template and its rationale.
 */
export {
  DEFAULT_ROLE_TEMPLATE_NAMES,
  DEFAULT_ROLE_TEMPLATES,
  type DefaultRoleTemplateName,
} from '@saas-inventory/shared';
