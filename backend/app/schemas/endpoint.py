from pydantic import BaseModel, Field


class EndpointSummary(BaseModel):
    id: str
    name: str
    description: str | None = None


class EndpointGroupSummary(BaseModel):
    id: str
    name: str
    description: str | None = None


class CustomAttrs(BaseModel):
    Owner: str = ""
    Location: str = ""
    AuthzVlan: str = ""


class CreateEndpointRequest(BaseModel):
    mac: str = Field(..., description="MAC address, e.g. AA:BB:CC:DD:EE:FF")
    group_id: str
    description: str = ""
    custom_attributes: CustomAttrs | None = None


class BulkCreateRequest(BaseModel):
    items: list[CreateEndpointRequest]


class BulkFailure(BaseModel):
    mac: str
    error: str


class BulkResult(BaseModel):
    succeeded: list[str] = Field(default_factory=list)
    failed: list[BulkFailure] = Field(default_factory=list)


class EndpointUpdate(BaseModel):
    description: str | None = None
    group_id: str | None = None
    custom_attributes: CustomAttrs | None = None
