from pydantic import BaseModel, Field


class EndpointSummary(BaseModel):
    id: str
    name: str
    description: str | None = None


class EndpointGroupSummary(BaseModel):
    id: str
    name: str
    description: str | None = None


class CreateEndpointRequest(BaseModel):
    mac: str = Field(..., description="MAC address, e.g. AA:BB:CC:DD:EE:FF")
    group_id: str
    description: str = ""
