import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { AppRole, CreatorTier } from '@/lib/auth/auth-context';
import type { ApplicationStatus } from '@/lib/auth/useApplication';

/**
 * The review queue.
 *
 * Paginated in the database, never in the browser. This list grows without a
 * ceiling, so `select('*')` and "fetch everything then filter" are both banned
 * here: the first thousand applications would make the page unusable and there
 * is no version of that we would want to fix later under pressure.
 *
 * Row level security still decides what comes back. A non-staff token running
 * this exact query gets its own row and nothing else, so the filters below are
 * a convenience for admins, not a security control.
 */

export const PAGE_SIZE = 20;

export type StatusFilter = 'all' | ApplicationStatus;
export type SortOrder = 'newest' | 'oldest';

export interface QueueFilters {
  status: StatusFilter;
  /** True narrows to people Wurx has already worked with, for fast-tracking. */
  workedWithWurx: boolean;
  search: string;
  sort: SortOrder;
  page: number;
}

export interface QueueRow {
  id: string;
  tiktok_handle: string;
  niche: string;
  niche_other: string | null;
  worked_with_wurx: boolean;
  status: ApplicationStatus;
  created_at: string;
  reviewed_at: string | null;
  applicant: {
    id: string;
    email: string;
    display_name: string | null;
    role: AppRole;
    tier: CreatorTier | null;
  } | null;
}

/**
 * PostgREST puts filter values straight into the query string, where a comma or
 * a bracket changes the meaning of the filter rather than being matched
 * literally. Handles are alphanumerics, dots and underscores, so anything else
 * is dropped before it can become part of the query.
 */
const sanitiseSearch = (raw: string) =>
  raw
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 64);

const COLUMNS =
  'id, tiktok_handle, niche, niche_other, worked_with_wurx, status, created_at, reviewed_at, ' +
  // Two foreign keys point at profiles (user_id and reviewed_by), so the
  // constraint name is required or PostgREST cannot tell which one we mean.
  'applicant:profiles!applications_user_id_fkey (id, email, display_name, role, tier)';

export function useApplications(filters: QueueFilters) {
  const search = sanitiseSearch(filters.search);

  return useQuery({
    queryKey: ['admin', 'applications', { ...filters, search }],
    // Keep the previous page on screen while the next one loads. Without this
    // every page change flashes an empty table, which reads as a bug.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async (): Promise<{ rows: QueueRow[]; total: number }> => {
      const from = (filters.page - 1) * PAGE_SIZE;

      let q = getSupabase().from('applications').select(COLUMNS, { count: 'exact' });

      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.workedWithWurx) q = q.eq('worked_with_wurx', true);
      if (search) q = q.ilike('tiktok_handle', `%${search}%`);

      const { data, error, count } = await q
        .order('created_at', { ascending: filters.sort === 'oldest' })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      return { rows: (data ?? []) as unknown as QueueRow[], total: count ?? 0 };
    },
  });
}

interface ApplicationCounts extends Record<ApplicationStatus, number> {
  /** Pending AND previously worked with Wurx, the fast-track pile. */
  pendingKnown: number;
}

/**
 * Counts for the dashboard tiles and the queue's tabs.
 *
 * `head: true` means PostgREST returns the count in a header and no rows at
 * all, so this stays cheap however many applications exist. Counting in the
 * browser would mean downloading the table.
 */
export function useApplicationCounts() {
  return useQuery({
    queryKey: ['admin', 'application-counts'],
    staleTime: 30_000,
    queryFn: async (): Promise<ApplicationCounts> => {
      const supabase = getSupabase();
      const statuses: ApplicationStatus[] = ['pending', 'approved', 'rejected'];

      const [statusResults, known] = await Promise.all([
        Promise.all(
          statuses.map((s) =>
            supabase
              .from('applications')
              .select('id', { count: 'exact', head: true })
              .eq('status', s)
          )
        ),
        supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .eq('worked_with_wurx', true),
      ]);

      const counts: ApplicationCounts = {
        pending: 0,
        approved: 0,
        rejected: 0,
        pendingKnown: 0,
      };
      statusResults.forEach((r, i) => {
        if (r.error) throw r.error;
        counts[statuses[i]!] = r.count ?? 0;
      });
      if (known.error) throw known.error;
      counts.pendingKnown = known.count ?? 0;

      return counts;
    },
  });
}
