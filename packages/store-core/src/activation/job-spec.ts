/**
 * The store job-spec shape pinned on-chain by post-hire activation (WP-B1).
 *
 * A hire mints a Task; the task is CLAIMABLE only after the creator pins a
 * job-spec pointer via `set_task_job_spec` (hash + URI), which itself requires
 * a CLEAN task-moderation attestation for that exact hash. The templates hire
 * "as listed": the default job spec is derived from the listing the buyer
 * hired, with an optional buyer brief. The canonical JSON + sha-256 hash are
 * computed server-side by the activation route with the SDK's
 * `values.canonicalJobSpecJson` / `values.canonicalJobSpecHash` so the pinned
 * hash always matches the hosted document byte-for-byte.
 *
 * @module activation/job-spec
 */

/** The schema marker of a store-template job spec. */
export const STORE_JOB_SPEC_SCHEMA = "agenc.store.jobSpec.v1" as const;

/** Bounds enforced when normalizing an untrusted job-spec input. */
export const JOB_SPEC_LIMITS = {
  titleChars: 160,
  itemChars: 280,
  items: 12,
  notesChars: 2_000,
} as const;

/**
 * The client-side job-spec draft: what the buyer's browser sends to the
 * activation route. `taskPda`/`listing` are supplied by the flow, not the
 * draft.
 */
export interface StoreJobSpecDraft {
  /** Short work title (defaults to the listing name). */
  title: string;
  /** What the worker must deliver. */
  deliverables: string[];
  /** How the buyer will judge the result. */
  acceptanceCriteria: string[];
  /** Optional freeform buyer brief. */
  notes?: string;
}

/** The full, normalized payload that is canonicalized + hashed + hosted. */
export interface StoreJobSpecPayload extends StoreJobSpecDraft {
  /** Schema marker. */
  schema: typeof STORE_JOB_SPEC_SCHEMA;
  /** The minted Task PDA this spec activates. */
  taskPda: string;
  /** The ServiceListing PDA the buyer hired. */
  listing: string;
}

/**
 * Build the default "as listed" job-spec draft for a hire.
 *
 * @param input - Listing display data (+ optional buyer brief).
 * @returns A {@link StoreJobSpecDraft} describing the listed service.
 */
export function buildListingJobSpec(input: {
  /** The listing display name. */
  listingName: string;
  /** The listing's published spec URI (referenced in the deliverable). */
  specUri?: string | undefined;
  /** Optional freeform buyer brief. */
  brief?: string | undefined;
}): StoreJobSpecDraft {
  const name = input.listingName.trim() || "the listed service";
  const draft: StoreJobSpecDraft = {
    title: `Deliver "${name}" as listed`.slice(0, JOB_SPEC_LIMITS.titleChars),
    deliverables: [
      input.specUri
        ? `Deliver the service exactly as described by the listing spec (${input.specUri}).`
        : "Deliver the service exactly as described in the on-chain listing.",
    ],
    acceptanceCriteria: [
      "The result matches the listing's published spec and scope.",
      "The buyer reviews and accepts the submission (CreatorReview settlement).",
    ],
  };
  const brief = input.brief?.trim();
  if (brief) draft.notes = brief.slice(0, JOB_SPEC_LIMITS.notesChars);
  return draft;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  if (trimmed.length > max) {
    throw new Error(`${field} must be ${max} characters or less.`);
  }
  return trimmed;
}

function boundedStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings.`);
  }
  const strings = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (strings.length === 0) throw new Error(`${field} needs at least one item.`);
  if (strings.length > JOB_SPEC_LIMITS.items) {
    throw new Error(`${field} supports at most ${JOB_SPEC_LIMITS.items} items.`);
  }
  for (const item of strings) {
    if (item.length > JOB_SPEC_LIMITS.itemChars) {
      throw new Error(
        `${field} items must be ${JOB_SPEC_LIMITS.itemChars} characters or less.`,
      );
    }
  }
  return strings;
}

/**
 * Normalize an untrusted job-spec draft into the canonical
 * {@link StoreJobSpecPayload}. Every field is validated and bounded — the
 * result is what gets canonicalized, hashed, hosted, and attested.
 *
 * @param taskPda - The minted Task PDA (validated by the route).
 * @param listing - The hired ServiceListing PDA (validated by the route).
 * @param draft - The untrusted draft from the request body.
 * @returns The normalized payload.
 * @throws when any field is missing, mis-typed, or over its bound.
 */
export function normalizeStoreJobSpec(
  taskPda: string,
  listing: string,
  draft: unknown,
): StoreJobSpecPayload {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new Error("jobSpec must be an object.");
  }
  const source = draft as Record<string, unknown>;
  const payload: StoreJobSpecPayload = {
    schema: STORE_JOB_SPEC_SCHEMA,
    taskPda,
    listing,
    title: boundedString(source.title, "jobSpec.title", JOB_SPEC_LIMITS.titleChars),
    deliverables: boundedStringArray(source.deliverables, "jobSpec.deliverables"),
    acceptanceCriteria: boundedStringArray(
      source.acceptanceCriteria,
      "jobSpec.acceptanceCriteria",
    ),
  };
  if (typeof source.notes === "string" && source.notes.trim()) {
    const notes = source.notes.trim();
    if (notes.length > JOB_SPEC_LIMITS.notesChars) {
      throw new Error(
        `jobSpec.notes must be ${JOB_SPEC_LIMITS.notesChars} characters or less.`,
      );
    }
    payload.notes = notes;
  }
  return payload;
}
