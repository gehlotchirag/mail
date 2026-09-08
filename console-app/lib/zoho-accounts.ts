/**
 * Fetch every mailbox in a Zoho organisation, across all pages.
 *
 * Paging has to be defensive here. The obvious loop — keep asking until a page
 * comes back shorter than the limit — hangs forever against an organisation whose
 * account count is an exact multiple of the page size, or any server that ignores
 * `start` and re-serves the first page. That is not hypothetical: an org with
 * exactly 200 accounts and a limit of 200 returns a "full" first page, the loop
 * asks for page two, and if the same rows come back it never terminates. The
 * request then dies at the reverse proxy's 60s timeout with no error and no
 * partial result, which is exactly how the mailbox picker silently showed nothing.
 *
 * Three independent guards, so no single wrong assumption about Zoho's behaviour
 * can produce an unbounded loop:
 *   - stop when a page yields no accounts we have not already seen (catches a
 *     server that ignores `start`);
 *   - stop at a hard page ceiling;
 *   - stop once the overall deadline passes, returning what we have.
 */
export interface ZohoAccountRow {
  accountId?: string;
  zuid?: number | string;
  incomingUserName?: string;
  mailboxAddress?: string;
  primaryEmailAddress?: string;
  emailAddress?: Array<{ mailId?: string; isPrimary?: boolean }> | string;
  imapAccessEnabled?: boolean;
  displayName?: string;
  accountDisplayName?: string;
  role?: string;
  usedStorage?: number;
}

/**
 * Deliberately well below Zoho's 200 maximum. Asking for 200 at once took over
 * 40 seconds against a 200-mailbox org — long enough to blow any in-request
 * budget. Smaller pages return promptly, so a slow organisation costs more
 * round trips rather than one request that never lands.
 */
const PAGE_SIZE = 50;
/** 10,000 mailboxes is far beyond any real tenant; past this something is wrong. */
const MAX_PAGES = 200;
/** Callers that run detached pass their own, much longer, budget. */
const DEFAULT_DEADLINE_MS = 40_000;
/** One slow page must not consume the entire budget. */
const PER_PAGE_TIMEOUT_MS = 25_000;

/** A stable identity for de-duplication, falling back through Zoho's id fields. */
function identityOf(a: ZohoAccountRow): string {
  return String(
    a.accountId
    ?? a.zuid
    ?? a.incomingUserName
    ?? a.mailboxAddress
    ?? a.primaryEmailAddress
    ?? JSON.stringify(a),
  ).toLowerCase();
}

export type FetchAccountsResult =
  | { ok: true; accounts: ZohoAccountRow[]; truncated: boolean }
  | { ok: false; status?: number; error: string; detail?: string };

export async function fetchAllZohoAccounts(opts: {
  base: string;
  orgId: string;
  headers: Record<string, string>;
  deadlineMs?: number;
  /** Called after each page so a detached caller can report live progress. */
  onProgress?: (found: number) => void;
}): Promise<FetchAccountsResult> {
  const { base, orgId, headers, onProgress } = opts;
  const deadline = Date.now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);

  const accounts: ZohoAccountRow[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() > deadline) {
      truncated = true;
      console.warn(`[zoho-accounts] org ${orgId}: deadline hit after ${accounts.length} accounts — returning a partial list`);
      break;
    }

    const start = page * PAGE_SIZE;
    let res: Response;
    try {
      const pageStarted = Date.now();
      res = await fetch(`${base}/organization/${orgId}/accounts?limit=${PAGE_SIZE}&start=${start}`, {
        headers,
        signal: AbortSignal.timeout(Math.max(1_000, Math.min(PER_PAGE_TIMEOUT_MS, deadline - Date.now()))),
      });
      // Timing per page, because "Zoho is slow" was only diagnosable by
      // correlating a 502 against a configured deadline.
      console.log(`[zoho-accounts] org ${orgId}: page ${page} (start=${start}) -> ${res.status} in ${Date.now() - pageStarted}ms`);
    } catch (err) {
      // A timeout mid-page still leaves whatever earlier pages returned usable.
      if (accounts.length > 0) {
        truncated = true;
        console.warn(`[zoho-accounts] org ${orgId}: page ${page} failed (${err instanceof Error ? err.message : err}) — returning ${accounts.length} so far`);
        break;
      }
      return { ok: false, error: `Could not reach Zoho: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!res.ok) {
      // Zoho's failure body carries the actual reason (wrong org id, a token minted
      // without the org scope, a plan that has no org API at all). Swallowing it
      // turned every one of those into an indistinguishable generic 502, which is
      // exactly how a broken mailbox picker became impossible to diagnose.
      const body = await res.text().catch(() => '');
      console.error(`[zoho-accounts] org ${orgId}: page ${page} -> HTTP ${res.status} ${body.slice(0, 300)}`);
      if (accounts.length > 0) {
        truncated = true;
        break;
      }
      return {
        ok: false,
        status: res.status,
        error: `Zoho would not list the organisation's accounts (HTTP ${res.status}).`,
        detail: body.slice(0, 300),
      };
    }

    const body = (await res.json().catch(() => ({}))) as { data?: ZohoAccountRow[] };
    const rows = body.data ?? [];

    let added = 0;
    for (const row of rows) {
      const id = identityOf(row);
      if (seen.has(id)) continue;
      seen.add(id);
      accounts.push(row);
      added++;
    }

    onProgress?.(accounts.length);

    // Nothing new: either the end of the list, or a server re-serving page one.
    // Either way, asking again cannot make progress.
    if (added === 0) break;
    if (rows.length < PAGE_SIZE) break;

    if (page === MAX_PAGES - 1) {
      truncated = true;
      console.warn(`[zoho-accounts] org ${orgId}: hit the ${MAX_PAGES}-page ceiling at ${accounts.length} accounts`);
    }
  }

  return { ok: true, accounts, truncated };
}
