"""Tests for parallel page-fetching i IseEndpointRepository.list_all()
og IseEndpointGroupRepository.list_all().

Mocker list_page / _list_groups_page direkte — ingen ISE-forbindelser.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.ise.endpoints import IseEndpointGroupRepository, IseEndpointRepository


def _mock_client() -> MagicMock:
    return MagicMock()


def _make_resources(start: int, count: int) -> list[dict]:
    return [{"id": str(start + i), "mac": f"AA:BB:CC:DD:{start+i:02X}:00"} for i in range(count)]


# ------------------------------------------------------------------ #
# IseEndpointRepository.list_all                                       #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_list_all_single_page_no_parallel():
    """≤100 endpoints: kun ét list_page-kald (ingen parallel fetch)."""
    repo = IseEndpointRepository(_mock_client())
    resources = _make_resources(0, 50)

    repo.list_page = AsyncMock(return_value=(resources, 50))
    result = await repo.list_all()

    assert len(result) == 50
    assert repo.list_page.call_count == 1


@pytest.mark.asyncio
async def test_list_all_exact_one_page():
    """Præcis 100 endpoints: stadig kun ét kald."""
    repo = IseEndpointRepository(_mock_client())
    resources = _make_resources(0, 100)

    repo.list_page = AsyncMock(return_value=(resources, 100))
    result = await repo.list_all()

    assert len(result) == 100
    assert repo.list_page.call_count == 1


@pytest.mark.asyncio
async def test_list_all_250_uses_parallel_pages():
    """250 endpoints → side 1 + 2 parallelle sider (2+3) = 3 kald i alt."""
    repo = IseEndpointRepository(_mock_client())

    async def mock_list_page(page: int, size: int = 100, filters=None):
        if page == 1:
            return _make_resources(0, 100), 250
        if page == 2:
            return _make_resources(100, 100), 250
        if page == 3:
            return _make_resources(200, 50), 250
        return [], 250

    repo.list_page = AsyncMock(side_effect=mock_list_page)
    result = await repo.list_all()

    assert len(result) == 250
    assert repo.list_page.call_count == 3
    # Alle ID'er er unikke
    ids = {r["id"] for r in result}
    assert len(ids) == 250


@pytest.mark.asyncio
async def test_list_all_1000_correct_page_count():
    """1000 endpoints → 10 sider, alle returneret."""
    repo = IseEndpointRepository(_mock_client())

    async def mock_list_page(page: int, size: int = 100, filters=None):
        start = (page - 1) * 100
        count = min(100, 1000 - start)
        return _make_resources(start, count), 1000

    repo.list_page = AsyncMock(side_effect=mock_list_page)
    result = await repo.list_all()

    assert len(result) == 1000
    assert repo.list_page.call_count == 10


@pytest.mark.asyncio
async def test_list_all_with_filters_passed_through():
    """filters-argument videregives til alle list_page-kald."""
    repo = IseEndpointRepository(_mock_client())
    captured_filters = []

    async def mock_list_page(page: int, size: int = 100, filters=None):
        captured_filters.append(filters)
        if page == 1:
            return _make_resources(0, 100), 150
        return _make_resources(100, 50), 150

    repo.list_page = AsyncMock(side_effect=mock_list_page)
    await repo.list_all(filters=["mac.STARTSWITH.AA"])

    assert all(f == ["mac.STARTSWITH.AA"] for f in captured_filters)


# ------------------------------------------------------------------ #
# IseEndpointGroupRepository.list_all                                  #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_groups_list_all_single_page():
    """≤100 grupper: ét kald."""
    repo = IseEndpointGroupRepository(_mock_client())
    groups = [{"id": str(i), "name": f"Group-{i}"} for i in range(20)]

    repo._list_groups_page = AsyncMock(return_value=(groups, 20))
    result = await repo.list_all()

    assert len(result) == 20
    assert repo._list_groups_page.call_count == 1


@pytest.mark.asyncio
async def test_groups_list_all_multipage():
    """>100 grupper: parallel fetch af resterende sider."""
    repo = IseEndpointGroupRepository(_mock_client())

    async def mock_groups_page(page: int):
        if page == 1:
            return [{"id": str(i)} for i in range(100)], 120
        return [{"id": str(100 + i)} for i in range(20)], 120

    repo._list_groups_page = AsyncMock(side_effect=mock_groups_page)
    result = await repo.list_all()

    assert len(result) == 120
    assert repo._list_groups_page.call_count == 2
