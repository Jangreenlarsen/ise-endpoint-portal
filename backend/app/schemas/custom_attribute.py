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
