from app.ise.client import get_ise_client
from app.services.custom_attribute_service import CustomAttributeService
from app.services.endpoint_service import EndpointService


def get_endpoint_service() -> EndpointService:
    return EndpointService(get_ise_client())


def get_custom_attribute_service() -> CustomAttributeService:
    return CustomAttributeService(get_ise_client())
