from pydantic import BaseModel, Field


class EndpointSummary(BaseModel):
    id: str
    name: str
    description: str | None = None


class EndpointDetail(BaseModel):
    id: str
    name: str
    mac: str = ""
    description: str | None = None
    group_id: str | None = None
    group_name: str = ""
    endpoint_type: str = ""
    owner: str = ""
    lokation: str = ""
    authz_vlan: str = ""
    hypervision: str = ""


class EndpointGroupSummary(BaseModel):
    id: str
    name: str
    description: str | None = None


class CustomAttrs(BaseModel):
    Type: str = ""
    Owner: str = ""
    Lokation: str = ""
    AuthzVlan: str = ""


class CreateEndpointRequest(BaseModel):
    mac: str = Field(..., description="MAC address, e.g. AA:BB:CC:DD:EE:FF")
    group_id: str = ""
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
    static_group_assignment: bool | None = None
    custom_attributes: CustomAttrs | None = None
