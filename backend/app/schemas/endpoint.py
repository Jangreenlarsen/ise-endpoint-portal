from pydantic import BaseModel, Field


class EndpointSummary(BaseModel):
    id: str
    name: str
    description: str | None = None
    vendor: str = ""


class EndpointDetail(BaseModel):
    id: str
    name: str
    mac: str = ""
    description: str | None = None
    group_id: str | None = None
    group_name: str = ""
    static_group: bool = False
    endpoint_type: str = ""
    owner: str = ""
    lokation: str = ""
    authz_vlan: str = ""
    authz_acl: str = ""
    platform_type: str = ""
    hypervision: str = ""
    roles: list[str] = Field(default_factory=list)
    profile_id: str = ""
    profiler_name: str = ""
    static_profile: bool = False
    portal_user: str = ""
    identity_store: str = ""
    identity_store_id: str = ""
    vendor: str = ""
    psk_mode: bool = False
    psk_key: str = ""
    cache_stale: bool = False
    # Timestamps: ISO 8601 string fra ISE Open API createTime/updateTime,
    # eller HypervisionRegisteredAt custom attr i ERS-mode.
    create_time: str = ""
    update_time: str = ""


class EndpointGroupSummary(BaseModel):
    id: str
    name: str
    description: str | None = None


class CustomAttrs(BaseModel):
    Type: str = ""
    Owner: str = ""
    Lokation: str = ""
    AuthzVlan: str = ""
    AuthzACL: str = ""
    PlatformType: str = ""
    HypervisionRoles: str = ""
    PSK_Mode: str | None = None
    PSK_Key: str | None = None


class CreateEndpointRequest(BaseModel):
    mac: str = Field(..., description="MAC address, e.g. AA:BB:CC:DD:EE:FF")
    group_id: str = ""
    description: str = ""
    static_group_assignment: bool | None = None
    custom_attributes: CustomAttrs | None = None


class BulkCreateRequest(BaseModel):
    items: list[CreateEndpointRequest]
    overwrite: bool = False


class BulkFailure(BaseModel):
    mac: str
    error: str


class BulkResult(BaseModel):
    succeeded: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    overwritten: list[str] = Field(default_factory=list)
    failed: list[BulkFailure] = Field(default_factory=list)


class EndpointUpdate(BaseModel):
    description: str | None = None
    group_id: str | None = None
    static_group_assignment: bool | None = None
    custom_attributes: CustomAttrs | None = None


class PaginatedEndpointDetails(BaseModel):
    items: list[EndpointDetail] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    size: int = 100


class CoaReauthResponse(BaseModel):
    ok: bool
    mac: str
    message: str = ""


class AncPoliciesResponse(BaseModel):
    policies: list[str]


class AncStatusResponse(BaseModel):
    mac: str
    policy: str | None
    quarantined: bool


class AncQuarantineRequest(BaseModel):
    policy_name: str


class AncActionResponse(BaseModel):
    ok: bool
    mac: str
    message: str = ""
