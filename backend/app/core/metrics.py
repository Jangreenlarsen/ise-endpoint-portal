"""Prometheus metrics for HyperVision ISE Portal.

All metric objects are module-level singletons — import and call directly.
The /metrics endpoint (api/metrics_api.py) exposes them for scraping.

Metric naming convention: ise_portal_<subsystem>_<name>_<unit>
"""
from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

# ------------------------------------------------------------------ #
# Cache metrics                                                        #
# ------------------------------------------------------------------ #

CACHE_HITS = Counter(
    "ise_portal_cache_hits_total",
    "Number of endpoint detail cache hits (fresh entry served).",
)
CACHE_MISSES = Counter(
    "ise_portal_cache_misses_total",
    "Number of endpoint detail cache misses (ISE fetch triggered).",
)
CACHE_STALE_SERVES = Counter(
    "ise_portal_cache_stale_serves_total",
    "Stale-while-revalidate: stale entry served, background refresh spawned.",
)
CACHE_EVICTIONS = Counter(
    "ise_portal_cache_evictions_total",
    "Number of FIFO evictions triggered by cache_max_entries limit.",
)
CACHE_ENTRIES = Gauge(
    "ise_portal_cache_entries",
    "Current number of endpoint detail entries in the in-memory cache.",
)
CACHE_DISK_STALE = Gauge(
    "ise_portal_cache_disk_stale_entries",
    "Number of cache entries loaded from disk (marked stale, pending live refresh).",
)

# ------------------------------------------------------------------ #
# ISE API metrics                                                      #
# ------------------------------------------------------------------ #

ISE_REQUESTS = Counter(
    "ise_portal_ise_requests_total",
    "Total ISE API requests by HTTP method and outcome.",
    ["method", "outcome"],  # outcome: 2xx | 4xx | 5xx | error
)
ISE_REQUEST_DURATION = Histogram(
    "ise_portal_ise_request_duration_seconds",
    "ISE API request round-trip duration (including retries).",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0],
)
ISE_RETRIES = Counter(
    "ise_portal_ise_retries_total",
    "Number of ISE API retry attempts due to transport errors.",
)

# ------------------------------------------------------------------ #
# Bulk operation metrics                                               #
# ------------------------------------------------------------------ #

BULK_ITEMS = Counter(
    "ise_portal_bulk_items_total",
    "Bulk create/import item outcomes.",
    ["outcome"],  # succeeded | skipped | overwritten | failed
)
