/**
 * `@tetsuo-ai/store-core/sections` — the shared page COMPONENTS every template
 * consumes (PLAN_2 C3). All protocol/hire logic lives here + in
 * `marketplace-react`; templates differ ONLY in routing + curation config (the
 * C1 architecture rule that makes C7 instance-updates a dep bump).
 *
 * Sections:
 * - {@link StoreShell} — the layout shell (header/footer/disclosure).
 * - {@link CatalogSection} — the `/` catalog grid (curation applied).
 * - {@link ListingDetailSection} — the `/listings/[pda]` body (hire→activation).
 * - {@link HireActivationButton} — the connected hire + `set_task_job_spec` CTA.
 * - {@link DashboardTaskSection} — one buyer task on `/dashboard`.
 * - {@link EarningsSection} — the owner `/earnings` view (on-chain referral earnings).
 * - {@link TrustSection} — the `/trust` explainer + fee disclosure.
 * - the specced empty/error states (`states.ts`).
 *
 * @module sections
 */
export {
  StoreShell,
  brandingColorVars,
  type StoreShellProps,
  type StoreNavLink,
} from "./StoreShell.js";

export { CatalogSection, type CatalogSectionProps } from "./CatalogSection.js";
export {
  ListingDetailSection,
  type ListingDetailSectionProps,
} from "./ListingDetailSection.js";
export {
  HireActivationButton,
  type HireActivationButtonProps,
  type HireLandedContext,
  type StoreHireInput,
} from "./HireActivationButton.js";
export {
  TaskActivationRepair,
  type TaskActivationRepairProps,
  type TaskActivationRepairResult,
} from "./TaskActivationRepair.js";
export {
  DashboardTaskSection,
  type DashboardTaskSectionProps,
} from "./DashboardSection.js";
export { EarningsSection, type EarningsSectionProps } from "./EarningsSection.js";
export {
  TrustSection,
  DEFAULT_CREDIBLE_EXIT_HREF,
  type TrustSectionProps,
} from "./TrustSection.js";

export {
  SurfaceNotDeployedSection,
  EmptyCatalogSection,
  ZeroMatchSection,
  IndexerUnreachableSection,
} from "./states.js";
