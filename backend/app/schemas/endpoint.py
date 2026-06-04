# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
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
    registret_by: str = ""
    guest_registration: str = ""
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
    # Unix-timestamp (float) — første gang portalen observerede dette endpoint.
    # Sættes af first_seen_store ved cache-prewarm og create. None = endnu ikke set.
    first_seen_at: float | None = None
    # Dekommissionerings-status fra HypervisionStatus CA. "" = aktivt.
    status: str = ""
    # Aktivitetsstatus fra HypervisionActive CA. "Aktiv" / "Inaktiv" / "" = ukendt.
    active_status: str = ""


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
    RegistretBy: str = ""
    GuestRegistration: str = ""
    HypervisionRoles: str = ""
    HypervisionStatus: str | None = None
    HypervisionActive: str | None = None
    PSK_Mode: str | None = None
    PSK_Key: str | None = None


class CreateEndpointRequest(BaseModel):
    mac: str = Field(..., description="MAC address, e.g. AA:BB:CC:DD:EE:FF")
    group_id: str = ""
    description: str = ""
    static_group_assignment: bool | None = None
    custom_attributes: CustomAttrs | None = None


class BulkCreateRequest(BaseModel):
    items: list[CreateEndpointRequest] = Field(..., max_length=5_000)
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


class BulkApplyTemplateRequest(BaseModel):
    endpoint_ids: list[str] = Field(..., max_length=200)
    template_id: str


class BulkDecommissionRequest(BaseModel):
    endpoint_ids: list[str] = Field(..., max_length=200)


class EndpointGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field("", max_length=500)
    parent_id: str | None = Field(None, max_length=64)


class EndpointGroupCreated(BaseModel):
    id: str
    name: str
