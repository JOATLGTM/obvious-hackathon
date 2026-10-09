"""Auth stub — hardcoded demo identities, no login.

A real deployment would hang the provider identity off a session or JWT.
The order builder pre-fills the demo provider/patient from here. Swapping
in real auth means replacing these two functions; the data model already
records provider and patient per order.
"""

DEMO_PROVIDER = "Dr. Dana Demo, MD"
DEMO_PATIENT = "Demo Patient"


def current_provider() -> str:
    return DEMO_PROVIDER


def current_patient() -> str:
    return DEMO_PATIENT
