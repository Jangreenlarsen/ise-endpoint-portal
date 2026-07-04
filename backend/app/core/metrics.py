# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
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
    "Number of FIFO evictions triggered by cache_max_entries or cache_max_memory_mb limit.",
)
CACHE_MEMORY_BYTES = Gauge(
    "ise_portal_cache_memory_bytes",
    "Estimated memory used by endpoint detail entries (sum of JSON-serialised sizes).",
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
# Cache vedligehold / drip-refresh metrics                            #
# ------------------------------------------------------------------ #

CACHE_DRIP_REFRESHED = Counter(
    "ise_portal_cache_drip_refreshed_total",
    "Endpoints refreshed by the continuous drip-refresh loop since last restart.",
)
CACHE_DRIP_SKIPPED = Counter(
    "ise_portal_cache_drip_skipped_total",
    "Endpoints skipped by drip-refresh because they were still fresh (age <= TTL).",
)
CACHE_DRIP_SLEEP_S = Gauge(
    "ise_portal_cache_drip_sleep_seconds",
    "Current drip-refresh sleep interval between individual endpoint refreshes (interval / total).",
)
CACHE_DRIP_CYCLE_S = Gauge(
    "ise_portal_cache_drip_cycle_seconds",
    "Estimated time to rotate through all cached endpoints once at the current drip rate.",
)
CACHE_OLDEST_AGE_S = Gauge(
    "ise_portal_cache_oldest_entry_age_seconds",
    "Age in seconds of the oldest cached endpoint entry.",
)
CACHE_AVG_AGE_S = Gauge(
    "ise_portal_cache_avg_entry_age_seconds",
    "Average age in seconds of all cached endpoint entries.",
)
CACHE_STALE_COUNT = Gauge(
    "ise_portal_cache_stale_entries",
    "Number of cached entries with age greater than TTL (needing refresh).",
)
CACHE_STALE_PCT = Gauge(
    "ise_portal_cache_stale_pct",
    "Percentage of cached entries that are stale (age > TTL).",
)

# ------------------------------------------------------------------ #
# Adaptiv styring (6.22.0726 drip-hastighed + 6.24.0728 aktivitets-TTL) #
# ------------------------------------------------------------------ #

CACHE_ADAPTIVE_SPEED_FACTOR = Gauge(
    "ise_portal_cache_adaptive_speed_factor",
    "Adaptive drip speed factor (AIMD ISE-congestion control): 1.0=baseline, "
    "<1 slower (ISE stressed), >1 faster (ISE healthy).",
)
CACHE_EFFECTIVE_TTL_S = Gauge(
    "ise_portal_cache_effective_ttl_seconds",
    "Activity-driven effective cache TTL used by the drip loop; ramps from base "
    "TTL up to adaptive_ttl_max_seconds while the portal is idle.",
)
PORTAL_IDLE_S = Gauge(
    "ise_portal_portal_idle_seconds",
    "Seconds since the last authenticated portal activity (drives adaptive TTL).",
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

# ------------------------------------------------------------------ #
# Circuit-breaker metrics                                              #
# ------------------------------------------------------------------ #

CIRCUIT_STATE = Gauge(
    "ise_portal_circuit_breaker_state",
    "ISE circuit breaker state: 0=closed, 1=half_open, 2=open.",
)

# ------------------------------------------------------------------ #
# Rate-limit metrics                                                   #
# ------------------------------------------------------------------ #

RATE_LIMIT_BLOCKED = Counter(
    "ise_portal_rate_limit_blocked_total",
    "Requests blocked by the per-IP rate limiter (429).",
)

# ------------------------------------------------------------------ #
# Bulk operation metrics                                               #
# ------------------------------------------------------------------ #

BULK_ITEMS = Counter(
    "ise_portal_bulk_items_total",
    "Bulk create/import item outcomes.",
    ["outcome"],  # succeeded | skipped | overwritten | failed
)
