from app.ise.client import get_ise_client
from app.services.endpoint_service import EndpointService


def get_endpoint_service() -> EndpointService:
    return EndpointService(get_ise_client())
