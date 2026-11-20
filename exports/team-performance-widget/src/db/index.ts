import * as schemaModule from "./schema";
import { api } from "../lib/api";

export const schema = schemaModule;
export const dbReady: Promise<void> = Promise.resolve();

type Primitive = string | number | boolean | null;
type Filter = Record<string, Primitive>;

interface ListOptions {
  filter?: Filter;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
}

function buildQuery(opts?: ListOptions): string {
  if (!opts) return "";
  const params = new URLSearchParams();
  if (opts.filter) {
    for (const [key, value] of Object.entries(opts.filter)) {
      params.set(`filter.${key}`, value === null ? "null" : String(value));
    }
  }
  if (opts.orderBy) {
    params.set("orderBy", opts.orderBy.column);
    params.set("orderDir", opts.orderBy.ascending === false ? "desc" : "asc");
  }
  if (opts.limit != null) params.set("limit", String(opts.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function filterQuery(filter?: Filter, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      params.set(`filter.${key}`, value === null ? "null" : String(value));
    }
  }
  if (extra) for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

type TableClient<T> = {
  list(opts?: ListOptions): Promise<T[]>;
  insert(values: Partial<T> | Partial<T>[]): Promise<T[]>;
  insertBulk(values: Partial<T>[]): Promise<{ count: number }>;
  updateById(id: number, patch: Partial<T>): Promise<T>;
  deleteById(id: number): Promise<void>;
  deleteWhere(filter: Filter): Promise<void>;
  deleteAll(): Promise<void>;
};

function tableClient<T>(name: string): TableClient<T> {
  return {
    list: (opts) => api.get<T[]>(`/api/${name}${buildQuery(opts)}`),
    insert: (values) => api.post<T[]>(`/api/${name}`, { values: Array.isArray(values) ? values : [values] }),
    insertBulk: (values) => api.post<{ count: number }>(`/api/${name}?minimal=true`, { values }),
    updateById: (id, patch) => api.patch<T>(`/api/${name}/${id}`, patch),
    deleteById: (id) => api.delete<{ ok: true }>(`/api/${name}/${id}`).then(() => undefined),
    deleteWhere: (filter) => api.delete<{ ok: true }>(`/api/${name}${filterQuery(filter)}`).then(() => undefined),
    deleteAll: () => api.delete<{ ok: true }>(`/api/${name}?all=true`).then(() => undefined),
  };
}

type PerformanceImportRow = typeof schema.performance_imports.$inferSelect;
type PerformanceMetricRow = typeof schema.performance_metrics.$inferSelect;
type MetricDisputeRow = typeof schema.metric_disputes.$inferSelect;

export const db = {
  performance_imports: tableClient<PerformanceImportRow>("performance_imports"),
  performance_metrics: tableClient<PerformanceMetricRow>("performance_metrics"),
  metric_disputes: tableClient<MetricDisputeRow>("metric_disputes"),
};
