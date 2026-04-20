from pydantic import BaseModel, Field

DACL_TYPES = ("IPV4", "IPV6", "IP_AGNOSTIC")


class DaclSummary(BaseModel):
    id: str
    name: str
    description: str = ""


class DaclDetail(BaseModel):
    id: str
    name: str
    description: str = ""
    dacl: str = ""
    dacl_type: str = "IPV4"


class DaclLineIssue(BaseModel):
    """A single problem detected in one ACL line."""
    line: int                # 1-based source line number
    text: str                # the offending source line (verbatim)
    severity: str            # "error" | "warning"
    message: str             # human-readable problem


class DaclValidationResult(BaseModel):
    ok: bool
    issues: list[DaclLineIssue] = Field(default_factory=list)


class CreateDaclRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    dacl: str = ""
    dacl_type: str = "IPV4"


class UpdateDaclRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    dacl: str | None = None
    dacl_type: str | None = None


class ValidateDaclRequest(BaseModel):
    dacl: str = ""
    dacl_type: str = "IPV4"
