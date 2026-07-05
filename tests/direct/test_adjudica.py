"""Direct-mode tests for the Adjudica intelligent contract.

Run: pytest tests/direct/ -v
These run the contract in-memory (leader path only); validator logic is exercised
against the network in integration/seeding, not here.
"""

import json

CONTRACT = "contracts/adjudica.py"

PROVIDER = "0x1111111111111111111111111111111111111111"
CLIENT = "0x2222222222222222222222222222222222222222"
CRITERIA = (
    "Deliver a synthesis report of at least 800 words covering all five source "
    "papers, with citations, before the deadline."
)


def _hex(addr):
    if isinstance(addr, str):
        return addr
    if isinstance(addr, (bytes, bytearray)):
        return "0x" + bytes(addr).hex()
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    return str(addr)


def _fulfilled_verdict():
    return json.dumps({
        "fulfilled": True,
        "fault_party": "none",
        "reasoning": "The report covers all five papers with citations and exceeds 800 words.",
        "confidence": 92,
    })


def _breach_verdict(fault="provider"):
    return json.dumps({
        "fulfilled": False,
        "fault_party": fault,
        "reasoning": "The report omits two of the five required papers and lacks citations.",
        "confidence": 88,
    })


# --------------------------- creation & reads ---------------------------

def test_create_and_read(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner

    cid = c.create_case("Research synthesis SLA", CRITERIA, PROVIDER, CLIENT, "2026-08-01")
    assert cid == 1
    assert c.get_case_count() == 1

    case = c.get_case(1)
    assert case["id"] == 1
    assert case["status"] == "OPEN"
    assert case["provider"].lower() == PROVIDER.lower()
    assert case["client"].lower() == CLIENT.lower()
    assert case["escrow_funded"] is False

    cfg = c.get_config()
    assert cfg["fee_bps"] == 100
    assert cfg["case_count"] == 1


def test_list_cases_newest_first(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    c.create_case("Case A", CRITERIA, PROVIDER, CLIENT, "")
    c.create_case("Case B", CRITERIA, PROVIDER, CLIENT, "")
    listed = c.list_cases(0, 10)
    assert [x["title"] for x in listed] == ["Case B", "Case A"]


def test_create_validations(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("provider and client must differ"):
        c.create_case("Same parties", CRITERIA, PROVIDER, PROVIDER, "")
    with direct_vm.expect_revert("criteria must be substantive"):
        c.create_case("Thin", "too short", PROVIDER, CLIENT, "")


# --------------------------- evidence ---------------------------

def test_submit_evidence_and_status(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    c.create_case("Case", CRITERIA, PROVIDER, CLIENT, "")

    c.submit_evidence(1, "provider", "Delivered report v3 (1120 words, 5 citations).", "", "abc123")
    case = c.get_case(1)
    assert case["status"] == "SUBMITTED"

    ev = c.get_evidence(1)
    assert len(ev) == 1
    assert ev[0]["role"] == "provider"
    assert ev[0]["content_hash"] == "abc123"


def test_submit_evidence_access_control(direct_vm, direct_deploy, direct_owner, direct_charlie):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    c.create_case("Case", CRITERIA, PROVIDER, CLIENT, "")

    direct_vm.sender = direct_charlie  # not a party
    with direct_vm.expect_revert("only case parties may submit evidence"):
        c.submit_evidence(1, "observer", "outsider note", "", "")


# --------------------------- adjudication ---------------------------

def test_adjudicate_fulfilled(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    c.create_case("Case", CRITERIA, PROVIDER, CLIENT, "")
    c.submit_evidence(1, "provider", "Report v3 covers all 5 papers with citations, 1120 words.", "", "h1")

    direct_vm.mock_llm(r"impartial adjudicator", _fulfilled_verdict())
    verdict = c.adjudicate(1)
    assert verdict["fulfilled"] is True
    assert verdict["fault_party"] == "none"

    case = c.get_case(1)
    assert case["status"] == "RESOLVED"
    assert case["fulfilled"] is True
    assert case["fault_party"] == "none"
    assert case["confidence"] == 92
    assert case["reasoning"]

    rep = c.get_reputation(PROVIDER)
    assert rep["fulfilled"] == 1
    assert rep["breached"] == 0
    assert rep["score"] == 100


def test_adjudicate_breach_assigns_fault(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    c.create_case("Case", CRITERIA, PROVIDER, CLIENT, "")
    c.submit_evidence(1, "provider", "Report v1 covers only 3 papers, no citations.", "", "h1")

    direct_vm.mock_llm(r"impartial adjudicator", _breach_verdict("provider"))
    verdict = c.adjudicate(1)
    assert verdict["fulfilled"] is False
    assert verdict["fault_party"] == "provider"

    case = c.get_case(1)
    assert case["status"] == "RESOLVED"
    assert case["fulfilled"] is False

    rep = c.get_reputation(PROVIDER)
    assert rep["breached"] == 1
    assert rep["fault"] == 1
    assert rep["score"] == 0


def test_adjudicate_requires_evidence(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    c.create_case("Case", CRITERIA, PROVIDER, CLIENT, "")
    direct_vm.mock_llm(r"impartial adjudicator", _fulfilled_verdict())
    with direct_vm.expect_revert("no evidence submitted"):
        c.adjudicate(1)


def test_cannot_adjudicate_twice(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    c.create_case("Case", CRITERIA, PROVIDER, CLIENT, "")
    c.submit_evidence(1, "provider", "Report delivered, all criteria met.", "", "h1")
    direct_vm.mock_llm(r"impartial adjudicator", _fulfilled_verdict())
    c.adjudicate(1)
    with direct_vm.expect_revert("already adjudicated"):
        c.adjudicate(1)


# --------------------------- escrow & settlement ---------------------------

def test_fund_and_settle_fulfilled_credits_provider(direct_vm, direct_deploy, direct_owner):
    # client == owner so the owner (creator) is allowed to fund escrow.
    c = direct_deploy(CONTRACT, 100, "")  # fee_recipient "" -> owner
    direct_vm.sender = direct_owner
    owner_hex = _hex(direct_owner)
    c.create_case("Escrowed SLA", CRITERIA, PROVIDER, owner_hex, "")

    direct_vm.value = 1000
    c.fund_escrow(1)
    direct_vm.value = 0

    case = c.get_case(1)
    assert case["escrow_funded"] is True
    assert case["escrow_atto"] == "1000"

    c.submit_evidence(1, "provider", "Delivered, all criteria satisfied.", "", "h1")
    direct_vm.mock_llm(r"impartial adjudicator", _fulfilled_verdict())
    c.adjudicate(1)
    res = c.settle(1)

    # fee = 1000 * 100 / 10000 = 10 ; payout = 990 to provider
    assert res["fee_atto"] == "10"
    assert res["payout_atto"] == "990"
    assert c.get_pending_withdrawal(PROVIDER) == "990"
    assert c.get_pending_withdrawal(owner_hex) == "10"  # fee recipient == owner

    case = c.get_case(1)
    assert case["status"] == "SETTLED"
    assert case["beneficiary"].lower() == PROVIDER.lower()


def test_breach_refunds_client_and_withdraw(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")  # fee_recipient "" -> owner
    direct_vm.sender = direct_owner
    owner_hex = _hex(direct_owner)
    # client == owner so refund + fee both land on owner and are withdrawable.
    c.create_case("Escrowed SLA", CRITERIA, PROVIDER, owner_hex, "")

    direct_vm.value = 1000
    c.fund_escrow(1)
    direct_vm.value = 0

    c.submit_evidence(1, "provider", "Report v1 incomplete, missing papers.", "", "h1")
    direct_vm.mock_llm(r"impartial adjudicator", _breach_verdict("provider"))
    c.adjudicate(1)
    c.settle(1)

    case = c.get_case(1)
    assert case["beneficiary"].lower() == owner_hex.lower()
    # payout 990 to client(owner) + fee 10 to fee_recipient(owner) = 1000
    assert c.get_pending_withdrawal(owner_hex) == "1000"

    out = c.withdraw()
    assert out["withdrawn_atto"] == "1000"
    assert c.get_pending_withdrawal(owner_hex) == "0"


def test_withdraw_nothing_reverts(direct_vm, direct_deploy, direct_owner, direct_charlie):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("nothing to withdraw"):
        c.withdraw()


def test_fund_escrow_requires_value(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, 100, "")
    direct_vm.sender = direct_owner
    owner_hex = _hex(direct_owner)
    c.create_case("Case", CRITERIA, PROVIDER, owner_hex, "")
    direct_vm.value = 0
    with direct_vm.expect_revert("escrow value must be positive"):
        c.fund_escrow(1)
