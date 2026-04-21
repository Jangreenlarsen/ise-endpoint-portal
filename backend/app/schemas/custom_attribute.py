from pydantic import BaseModel, Field


class CustomAttributeValues(BaseModel):
    """One attribute with its allowed values."""
    name: str
    values: list[str] = Field(default_factory=list)


class AllCustomAttributes(BaseModel):
    """All managed custom attributes with their values."""
    attributes: list[CustomAttributeValues]


class AddValueRequest(BaseModel):
    value: str = Field(..., min_length=1, max_length=200)


class SyncResult(BaseModel):
    scanned_endpoints: int = 0
    new_values_found: dict[str, list[str]] = Field(default_factory=dict)
    definitions_ensured: dict[str, bool] = Field(default_factory=dict)


class RemoveValueResult(BaseModel):
    """Result of removing a value: the updated attribute list plus the
    number of ISE endpoints where the value was cleared."""
    attributes: list[CustomAttributeValues]
    scanned_endpoints: int = 0
    cleared_endpoints: int = 0


class PlatformSyncResult(BaseModel):
    """Outcome of a MnT-based PlatformType sync."""
    active_sessions: int = 0
    matched_endpoints: int = 0
    updated_endpoints: int = 0
    skipped_existing: int = 0
    skipped_unmapped: int = 0
    new_values_found: list[str] = Field(default_factory=list)
    unmapped_raw: list[str] = Field(default_factory=list)
    unmatched_macs: int = 0


class PlatformMappingRow(BaseModel):
    """One mapping from an ISE raw value to a local label + CoA action."""
    raw: str
    local: str = ""
    coa: str = "reauth"


class PlatformMapping(BaseModel):
    """Full PlatformType mapping (one row per known raw value)."""
    mappings: list[PlatformMappingRow] = Field(default_factory=list)
