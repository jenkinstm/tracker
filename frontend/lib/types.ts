export type Target = {
  id: string;
  project_id: string;
  engine: string;
  region_code: string;
  device: string;
  depth: number;
};

export type Run = {
  id: string;
  status: "queued" | "running" | "done" | "partial" | "failed";
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  keywords_total: number;
  keywords_done: number;
  keywords_pending: number;
  keywords_failed: number;
  cost_kopecks: number;
  trigger: string;
  mode: string;
  error: string | null;
};

export type Project = {
  id: string;
  name: string;
  domain: string;
  match_subdomains: boolean;
  fix_typos: boolean;
  schedule: "manual" | "weekly" | "daily";
  schedule_time: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  targets: Target[];
  keywords_count: number;
  last_run: Run | null;
};

export type Keyword = {
  id: string;
  phrase: string;
  group_id: string | null;
  group_name: string | null;
  target_url: string | null;
  is_active: boolean;
  freq_base: number | null;
  freq_collected_at: string | null;
};

export type ReportRow = {
  keyword_id: string;
  phrase: string;
  group_name: string | null;
  freq_base: number | null;
  position: number | null;
  previous_position: number | null;
  delta: number | null;
  url: string | null;
  target_url: string | null;
  url_mismatch: boolean;
};

export type Report = {
  items: ReportRow[];
  total: number;
  page: number;
  size: number;
  checked_on: string | null;
  previous_checked_on: string | null;
  depth: number;
};

export type Summary = {
  checked_on: string | null;
  keywords: number;
  in_top3: number;
  in_top10: number;
  in_top50: number;
  out_of_depth: number;
  average_position: number | null;
  median_position: number | null;
};

export type VisibilityPoint = {
  checked_on: string;
  top3: number;
  top10: number;
  top50: number;
};

export type Cost = {
  keywords: number;
  requests: number;
  mode: string;
  cost_kopecks: number;
  cost_rubles: number;
};

export type WordstatCost = Cost & { total_selected: number; fresh_skipped: number };

export type Group = {
  id: string;
  name: string;
  parent_id: string | null;
  keywords_count: number;
};

export type Usage = {
  month: string;
  requests: number;
  cost_kopecks: number;
  cost_rubles: number;
  request_limit: number;
  budget_kopecks: number;
  limit_reached: boolean;
  by_operation: { provider: string; operation: string; requests: number; cost_kopecks: number }[];
  by_project: { project_id: string; name: string; requests: number; cost_kopecks: number }[];
};

export type Region = { code: string; name: string; parent_code: string | null };

export type AppConfig = {
  serp_provider: string;
  wordstat_provider: string;
  search_mode: string;
  sync_max_keywords: number;
  wordstat_fresh_days: number;
  deferred_ttl_hours: number;
  depth: number;
};

export type ImportReport = {
  total_lines: number;
  added: number;
  duplicates_in_file: number;
  duplicates_in_project: number;
  empty: number;
  too_long: number;
};

export type Page<T> = { items: T[]; total: number; page: number; size: number };
