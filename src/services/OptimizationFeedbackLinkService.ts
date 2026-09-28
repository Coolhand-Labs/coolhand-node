import { BulkLinkFeedbackResult, LinkFeedbackOptions, OptimizationFeedbackLink } from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface OptimizationFeedbackLinkServiceConfig extends BaseServiceConfig {}

// Server-side cap on `feedback_ids` per call (more is a 422).
const BULK_LINK_BATCH_SIZE = 100;

/**
 * Attach feedback to an optimization as evidence, via
 * `POST /api/v2/optimizations/{optimization_id}/feedback_links` (single and bulk modes share that
 * one route; the body picks the mode) and `DELETE .../feedback_links/{id}`.
 *
 * Requires the client's **private** API key — the public key is write-only and gets a `401`. Like
 * the read services, every method throws on failure rather than logging and returning `null`. The
 * only `null`/no-op result is `dryRun` mode, where no request is sent.
 */
export class OptimizationFeedbackLinkService extends BaseService {
  constructor(config: OptimizationFeedbackLinkServiceConfig) {
    super(config, '/api/v2/optimizations');
  }

  /**
   * Link one feedback to an optimization.
   *
   * @param optimizationId Optimization hashid.
   * @param feedbackId Feedback hashid.
   * @param options Optional `note` explaining the link.
   * @returns The created link (its `id` is what {@link unlinkFeedback} takes), or `null` in
   *   `dryRun` mode, where no request is sent.
   * @throws Error if an id is blank. {@link HttpError} with `status` on a non-2xx response: `422`
   *   if the feedback is already linked or `note` is too long, `404` for an unknown optimization
   *   or feedback (or one belonging to another client), `401` for a missing/public key.
   */
  public async linkFeedback(
    optimizationId: string,
    feedbackId: string,
    options: LinkFeedbackOptions = {}
  ): Promise<OptimizationFeedbackLink | null> {
    this.assertId(feedbackId, 'linkFeedback: feedbackId must be a non-empty string');
    const url = this.linksUrl(optimizationId, 'linkFeedback');
    if (this.skipForDryRun('linkFeedback', optimizationId)) {return null;}
    return this.postLinks<OptimizationFeedbackLink>(url, {
      feedback_id: feedbackId,
      ...this.noteField(options)
    });
  }

  /**
   * Link many feedbacks to an optimization. Lists longer than 100 are split into batches of 100
   * (the server's per-call cap) and the results merged: counts are summed and `not_found`
   * concatenated. Ids are sent as given, so a duplicate across batches counts as `already_linked`.
   *
   * Already-linked ids are counted in `already_linked`, not treated as errors, so a failed run can
   * simply be repeated. If a later batch throws, earlier batches have already been applied.
   *
   * @param optimizationId Optimization hashid.
   * @param feedbackIds One or more feedback hashids.
   * @param options Optional `note`, applied to every link created.
   * @returns The merged counts, or `null` in `dryRun` mode, where no request is sent.
   * @throws Error if `feedbackIds` is empty or contains a blank id. {@link HttpError} with
   *   `status` on a non-2xx response: `404` for an unknown optimization, `422` for invalid input
   *   or a too-long `note`, `401` for a missing/public key.
   */
  public async bulkLinkFeedback(
    optimizationId: string,
    feedbackIds: string[],
    options: LinkFeedbackOptions = {}
  ): Promise<BulkLinkFeedbackResult | null> {
    if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) {
      throw new Error('bulkLinkFeedback: feedbackIds must be a non-empty array');
    }
    feedbackIds.forEach((id) => this.assertId(id, 'bulkLinkFeedback: every feedback id must be a non-empty string'));

    const url = this.linksUrl(optimizationId, 'bulkLinkFeedback');
    if (this.skipForDryRun('bulkLinkFeedback', optimizationId)) {return null;}

    const total: BulkLinkFeedbackResult = { linked: 0, already_linked: 0, errored: 0, not_found: [] };
    for (let i = 0; i < feedbackIds.length; i += BULK_LINK_BATCH_SIZE) {
      const result = await this.postLinks<BulkLinkFeedbackResult>(url, {
        feedback_ids: feedbackIds.slice(i, i + BULK_LINK_BATCH_SIZE),
        ...this.noteField(options)
      });
      // Validate the shape so a malformed body fails loudly here instead of turning the totals
      // into NaN or throwing a TypeError mid-run, after earlier batches were already applied.
      if (
        !Number.isFinite(result.linked) ||
        !Number.isFinite(result.already_linked) ||
        !Number.isFinite(result.errored) ||
        !Array.isArray(result.not_found)
      ) {
        throw new Error(`Feedback link response was not a valid bulk result: ${JSON.stringify(result).slice(0, 2000)}`);
      }
      total.linked += result.linked;
      total.already_linked += result.already_linked;
      total.errored += result.errored;
      total.not_found.push(...result.not_found);
    }
    return total;
  }

  /**
   * Remove a feedback link from an optimization.
   *
   * @param optimizationId Optimization hashid.
   * @param linkId The link's hashid — the `id` returned by {@link linkFeedback}, not the feedback id.
   * @returns Resolves without sending a request in `dryRun` mode.
   * @throws Error if an id is blank. {@link HttpError} with `status` on a non-2xx response: `404`
   *   if the link does not exist, `401` for a missing/public key.
   */
  public async unlinkFeedback(optimizationId: string, linkId: string): Promise<void> {
    this.assertId(linkId, 'unlinkFeedback: linkId must be a non-empty string');
    const url = `${this.linksUrl(optimizationId, 'unlinkFeedback')}/${encodeURIComponent(linkId)}`;
    if (this.skipForDryRun('unlinkFeedback', optimizationId)) {return;}
    await this.fetchOrThrow(
      url,
      { method: 'DELETE', headers: { Accept: 'application/json', 'X-API-Key': this.apiKey } },
      'Feedback link request failed'
    );
  }

  private noteField(options: LinkFeedbackOptions): { note?: string | null } {
    return options.note === undefined ? {} : { note: options.note };
  }

  // Dot-segments would be resolved away by URL parsing and silently retarget the request, so they
  // are rejected along with blank ids (same guard as BaseService#buildResourceUrl).
  private assertId(id: unknown, message: string): void {
    if (typeof id !== 'string' || id.trim() === '' || id === '.' || id === '..') {
      throw new Error(message);
    }
  }

  private linksUrl(optimizationId: string, method: string): string {
    this.assertId(optimizationId, `${method}: optimizationId must be a non-empty string`);
    return `${this.apiEndpoint}/${encodeURIComponent(optimizationId)}/feedback_links`;
  }

  // Callers validate ids first, so a dry run still rejects the input a live run would.
  private skipForDryRun(method: string, optimizationId: string): boolean {
    if (!this.dryRun) {return false;}
    this.log(`🚫 DRY RUN: Skipping ${method} for optimization ${optimizationId}`);
    return true;
  }

  private async postLinks<T>(url: string, payload: Record<string, unknown>): Promise<T> {
    const text = await this.fetchOrThrow(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': this.apiKey },
        body: JSON.stringify(payload)
      },
      'Feedback link request failed'
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Feedback link response was not valid JSON: ${text.slice(0, 2000)}`);
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error(`Feedback link response was not a JSON object: ${text.slice(0, 2000)}`);
    }
    return parsed as T;
  }
}
