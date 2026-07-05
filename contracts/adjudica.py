# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# Adjudica — trustless SLA and responsibility adjudication for multi-agent workflows.
#
# Autonomous agents (or their operators) register a service-level agreement with
# natural-language fulfillment criteria, commit evidence on-chain, and ask the
# network to adjudicate. GenLayer validators independently evaluate the same
# tamper-evident evidence against the criteria and reach consensus on a structured
# verdict (fulfilled + fault attribution). The verdict drives escrow settlement and
# reputation, so the outcome is enforceable rather than advisory.
#
# The consensus-critical decision is the verdict. Evidence is stored on-chain, so
# every validator adjudicates over identical data; the only non-determinism is the
# judgment itself, resolved by a custom equivalence principle that compares the
# decision fields (fulfilled, fault_party) and tolerates differing prose.

from genlayer import *

import json
import typing
from dataclasses import dataclass
from datetime import datetime, timezone

# Error classes let validators compare failures correctly (see equivalence docs).
ERROR_EXPECTED = "[EXPECTED]"   # business-logic error, deterministic, must match
ERROR_LLM = "[LLM_ERROR]"       # malformed model output, force leader rotation

_STATUS_OPEN = "OPEN"
_STATUS_SUBMITTED = "SUBMITTED"
_STATUS_RESOLVED = "RESOLVED"
_STATUS_SETTLED = "SETTLED"

_FAULT_PROVIDER = "provider"
_FAULT_CLIENT = "client"
_FAULT_NONE = "none"
_ALLOWED_FAULT = (_FAULT_PROVIDER, _FAULT_CLIENT, _FAULT_NONE)

_ONE_GEN = 1_000_000_000_000_000_000  # 1 GEN in atto (wei), for reference


@allow_storage
@dataclass
class Evidence:
    case_id: u256
    submitter: Address
    role: str          # "provider" | "client" | "observer"
    summary: str       # inline evidence text: agent log excerpt, output, note
    uri: str           # optional human/agent pointer (not fetched by consensus)
    content_hash: str  # caller-supplied integrity anchor (e.g. sha256 hex)
    submitted_at: str  # ISO 8601


@allow_storage
@dataclass
class Case:
    id: u256
    title: str
    criteria: str          # natural-language SLA fulfillment criteria
    client: Address        # commissioned + funds escrow; refunded on provider fault
    provider: Address      # performs the work; paid on fulfillment
    created_by: Address
    created_at: str
    deadline: str          # informational ISO 8601 deadline ("" if none)
    status: str
    escrow_atto: u256      # locked escrow in atto-GEN
    escrow_funded: bool
    # verdict
    fulfilled: bool
    fault_party: str       # provider | client | none | "" (before resolution)
    reasoning: str
    confidence: u256       # 0-100
    resolved_at: str
    # settlement
    settled_at: str
    beneficiary: Address   # who received the payout credit
    payout_atto: u256
    fee_atto: u256


# ---------------------------------------------------------------------------
# LLM output helpers (module-level: safe to call inside non-deterministic blocks)
# ---------------------------------------------------------------------------

def _coerce_bool(value: typing.Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1", "fulfilled", "y")
    return False


def _coerce_fault(value: typing.Any) -> str:
    text = str(value).strip().lower()
    if text in _ALLOWED_FAULT:
        return text
    if text in ("provider", "seller", "agent", "worker"):
        return _FAULT_PROVIDER
    if text in ("client", "buyer", "commissioner", "orchestrator"):
        return _FAULT_CLIENT
    return _FAULT_NONE


def _coerce_confidence(value: typing.Any) -> int:
    try:
        n = int(round(float(str(value).strip())))
    except (ValueError, TypeError):
        return 50
    return max(0, min(100, n))


def _loads_lenient(text: str) -> typing.Any:
    """Parse JSON that may be wrapped in prose or markdown fences."""
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1 or last < first:
        raise gl.vm.UserError(f"{ERROR_LLM} no JSON object in model output")
    return json.loads(text[first:last + 1])


def _normalize_verdict(raw: typing.Any) -> dict:
    """Turn arbitrary LLM output into a validated verdict dict, or raise."""
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", "replace")
    if isinstance(raw, str):
        raw = _loads_lenient(raw)
    if not isinstance(raw, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} verdict is not a JSON object: {type(raw)}")

    fulfilled_raw = raw.get("fulfilled")
    if fulfilled_raw is None:
        for alt in ("is_fulfilled", "met", "satisfied", "passed"):
            if alt in raw:
                fulfilled_raw = raw[alt]
                break
    if fulfilled_raw is None:
        raise gl.vm.UserError(f"{ERROR_LLM} missing 'fulfilled'. keys: {list(raw.keys())}")

    fulfilled = _coerce_bool(fulfilled_raw)

    fault_raw = raw.get("fault_party")
    if fault_raw is None:
        for alt in ("fault", "responsible", "at_fault", "blame"):
            if alt in raw:
                fault_raw = raw[alt]
                break
    fault = _FAULT_NONE if fault_raw is None else _coerce_fault(fault_raw)
    # A fulfilled SLA has no fault; a breached SLA must attribute fault.
    if fulfilled:
        fault = _FAULT_NONE
    elif fault == _FAULT_NONE:
        fault = _FAULT_PROVIDER

    reasoning = str(raw.get("reasoning", raw.get("reason", ""))).strip()
    if len(reasoning) > 1200:
        reasoning = reasoning[:1200]

    confidence = _coerce_confidence(raw.get("confidence", 50))

    return {
        "fulfilled": fulfilled,
        "fault_party": fault,
        "reasoning": reasoning,
        "confidence": confidence,
    }


def _handle_leader_error(leaders_res: typing.Any, leader_fn) -> bool:
    """Validator response when the leader raised instead of returning."""
    leader_msg = getattr(leaders_res, "message", "") or ""
    try:
        leader_fn()
        return False  # leader errored but we succeeded -> disagree
    except gl.vm.UserError as e:
        validator_msg = getattr(e, "message", None) or str(e)
        # Deterministic business errors must match exactly to agree.
        if validator_msg.startswith(ERROR_EXPECTED) and leader_msg.startswith(ERROR_EXPECTED):
            return validator_msg == leader_msg
        # LLM/unknown errors -> disagree to force a fresh leader.
        return False
    except Exception:
        return False


class Adjudica(gl.Contract):
    # config
    owner: Address
    fee_bps: u256           # protocol fee in basis points (100 = 1.00%)
    fee_recipient: Address
    next_id: u256
    # data
    cases: TreeMap[u256, Case]
    case_ids: DynArray[u256]
    evidence: DynArray[Evidence]
    pending_withdrawals: TreeMap[Address, u256]
    # reputation counters (per party address)
    rep_fulfilled: TreeMap[Address, u256]
    rep_breached: TreeMap[Address, u256]
    rep_fault: TreeMap[Address, u256]
    rep_cases: TreeMap[Address, u256]

    def __init__(self, fee_bps: u256, fee_recipient: str):
        self.owner = gl.message.sender_address
        capped = fee_bps if int(fee_bps) <= 1000 else u256(1000)  # cap at 10%
        self.fee_bps = capped
        recipient = fee_recipient.strip() if isinstance(fee_recipient, str) else ""
        self.fee_recipient = Address(recipient) if recipient else gl.message.sender_address
        self.next_id = u256(1)

    # -------------------------- writes --------------------------

    @gl.public.write
    def create_case(
        self,
        title: str,
        criteria: str,
        provider: str,
        client: str,
        deadline: str,
    ) -> int:
        if not title.strip():
            raise gl.vm.UserError(f"{ERROR_EXPECTED} title is required")
        if len(criteria.strip()) < 12:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} criteria must be substantive")
        provider_addr = Address(provider)
        client_addr = Address(client)
        if provider_addr == client_addr:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} provider and client must differ")

        cid = self.next_id
        now = self._now()
        self.cases[cid] = Case(
            id=cid,
            title=title.strip(),
            criteria=criteria.strip(),
            client=client_addr,
            provider=provider_addr,
            created_by=gl.message.sender_address,
            created_at=now,
            deadline=deadline.strip(),
            status=_STATUS_OPEN,
            escrow_atto=u256(0),
            escrow_funded=False,
            fulfilled=False,
            fault_party="",
            reasoning="",
            confidence=u256(0),
            resolved_at="",
            settled_at="",
            beneficiary=Address("0x0000000000000000000000000000000000000000"),
            payout_atto=u256(0),
            fee_atto=u256(0),
        )
        self.case_ids.append(cid)
        self._bump(self.rep_cases, client_addr)
        self._bump(self.rep_cases, provider_addr)
        self.next_id = u256(int(cid) + 1)
        return int(cid)

    @gl.public.write.payable
    def fund_escrow(self, case_id: int) -> None:
        c = self._get(case_id)
        if c.status in (_STATUS_RESOLVED, _STATUS_SETTLED):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} case already adjudicated")
        sender = gl.message.sender_address
        if sender != c.client and sender != c.created_by:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only client or creator may fund escrow")
        v = gl.message.value
        if int(v) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} escrow value must be positive")
        c.escrow_atto = u256(int(c.escrow_atto) + int(v))
        c.escrow_funded = True

    @gl.public.write
    def submit_evidence(
        self,
        case_id: int,
        role: str,
        summary: str,
        uri: str,
        content_hash: str,
    ) -> None:
        c = self._get(case_id)
        if c.status in (_STATUS_RESOLVED, _STATUS_SETTLED):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} case already adjudicated")
        sender = gl.message.sender_address
        if sender not in (c.client, c.provider, c.created_by):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only case parties may submit evidence")
        if not summary.strip():
            raise gl.vm.UserError(f"{ERROR_EXPECTED} evidence summary is required")
        norm_role = role.strip().lower()
        if norm_role not in ("provider", "client", "observer"):
            norm_role = "observer"
        self.evidence.append(Evidence(
            case_id=u256(int(case_id)),
            submitter=sender,
            role=norm_role,
            summary=summary.strip(),
            uri=uri.strip(),
            content_hash=content_hash.strip(),
            submitted_at=self._now(),
        ))
        if c.status == _STATUS_OPEN:
            c.status = _STATUS_SUBMITTED

    @gl.public.write
    def adjudicate(self, case_id: int) -> typing.Any:
        c = self._get(case_id)
        if c.status in (_STATUS_RESOLVED, _STATUS_SETTLED):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} case already adjudicated")

        # Gather on-chain evidence into a stable, validator-identical prompt.
        cid = int(case_id)
        lines = []
        idx = 0
        for e in self.evidence:
            if int(e.case_id) == cid:
                idx += 1
                lines.append(
                    f"[{idx}] role={e.role} submitter={e.submitter.as_hex} "
                    f"hash={e.content_hash or 'n/a'}\n    {e.summary}"
                )
        if idx == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} no evidence submitted for this case")

        evidence_block = "\n".join(lines)
        prompt = (
            "You are an impartial adjudicator resolving a service-level agreement "
            "(SLA) dispute between two autonomous agents in a multi-agent workflow.\n\n"
            f"SLA TITLE: {c.title}\n\n"
            "FULFILLMENT CRITERIA (natural language):\n"
            f"{c.criteria}\n\n"
            "PARTIES:\n"
            f"- provider (performs the work): {c.provider.as_hex}\n"
            f"- client (commissioned and funded the work): {c.client.as_hex}\n\n"
            "SUBMITTED EVIDENCE (committed on-chain, tamper-evident):\n"
            f"{evidence_block}\n\n"
            "TASK: Decide strictly from the criteria and evidence whether the provider "
            "fulfilled the SLA. Assign fault only when it was not fulfilled.\n\n"
            "Respond ONLY as JSON with exactly this schema:\n"
            '{"fulfilled": true or false, '
            '"fault_party": "provider" or "client" or "none", '
            '"reasoning": "2-3 sentences citing specific evidence", '
            '"confidence": integer 0-100}\n'
            'Rules: "fault_party" must be "none" when "fulfilled" is true; '
            "base the decision only on the provided criteria and evidence."
        )

        def leader_fn() -> dict:
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return _normalize_verdict(raw)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            mine = leader_fn()
            theirs = leaders_res.calldata
            try:
                return (
                    _coerce_bool(theirs["fulfilled"]) == mine["fulfilled"]
                    and str(theirs["fault_party"]) == mine["fault_party"]
                )
            except (KeyError, TypeError):
                return False

        verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        # Consensus reached -> apply deterministic state changes.
        c.status = _STATUS_RESOLVED
        c.fulfilled = bool(verdict["fulfilled"])
        c.fault_party = str(verdict["fault_party"])
        c.reasoning = str(verdict["reasoning"])
        c.confidence = u256(int(verdict["confidence"]))
        c.resolved_at = self._now()

        # Reputation update.
        self._bump(self.rep_cases, c.provider)  # count adjudicated participation
        if c.fulfilled:
            self._bump(self.rep_fulfilled, c.provider)
        else:
            self._bump(self.rep_breached, c.provider)
            if c.fault_party == _FAULT_PROVIDER:
                self._bump(self.rep_fault, c.provider)
            elif c.fault_party == _FAULT_CLIENT:
                self._bump(self.rep_fault, c.client)

        return verdict

    @gl.public.write
    def settle(self, case_id: int) -> typing.Any:
        c = self._get(case_id)
        if c.status != _STATUS_RESOLVED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} case must be adjudicated before settlement")

        # Beneficiary policy:
        # fulfilled            -> provider is paid
        # breach, client fault -> provider is compensated
        # breach, otherwise    -> client is refunded
        if c.fulfilled or c.fault_party == _FAULT_CLIENT:
            beneficiary = c.provider
        else:
            beneficiary = c.client

        escrow = int(c.escrow_atto)
        fee = (escrow * int(self.fee_bps)) // 10000 if escrow > 0 else 0
        payout = escrow - fee

        if escrow > 0:
            self.pending_withdrawals[beneficiary] = u256(
                int(self.pending_withdrawals.get(beneficiary, u256(0))) + payout
            )
            if fee > 0:
                self.pending_withdrawals[self.fee_recipient] = u256(
                    int(self.pending_withdrawals.get(self.fee_recipient, u256(0))) + fee
                )

        c.status = _STATUS_SETTLED
        c.beneficiary = beneficiary
        c.payout_atto = u256(payout)
        c.fee_atto = u256(fee)
        c.settled_at = self._now()

        return {
            "beneficiary": beneficiary.as_hex,
            "payout_atto": str(payout),
            "fee_atto": str(fee),
        }

    @gl.public.write
    def withdraw(self) -> typing.Any:
        sender = gl.message.sender_address
        amount = int(self.pending_withdrawals.get(sender, u256(0)))
        if amount == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} nothing to withdraw")
        # Zero the credit before sending (checks-effects-interactions).
        self.pending_withdrawals[sender] = u256(0)
        _Payee(sender).emit_transfer(value=u256(amount))
        return {"withdrawn_atto": str(amount)}

    # -------------------------- views --------------------------

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "owner": self.owner.as_hex,
            "fee_bps": int(self.fee_bps),
            "fee_recipient": self.fee_recipient.as_hex,
            "case_count": len(self.case_ids),
        }

    @gl.public.view
    def get_case_count(self) -> int:
        return len(self.case_ids)

    @gl.public.view
    def get_case(self, case_id: int) -> dict:
        return self._case_to_dict(self._get(case_id))

    @gl.public.view
    def list_cases(self, offset: int, limit: int) -> list:
        total = len(self.case_ids)
        start = max(0, int(offset))
        count = int(limit) if int(limit) > 0 else 20
        # newest first
        ordered = [int(self.case_ids[i]) for i in range(total - 1, -1, -1)]
        window = ordered[start:start + count]
        return [self._case_to_dict(self.cases[u256(cid)]) for cid in window]

    @gl.public.view
    def get_evidence(self, case_id: int) -> list:
        cid = int(case_id)
        out = []
        for e in self.evidence:
            if int(e.case_id) == cid:
                out.append({
                    "case_id": int(e.case_id),
                    "submitter": e.submitter.as_hex,
                    "role": e.role,
                    "summary": e.summary,
                    "uri": e.uri,
                    "content_hash": e.content_hash,
                    "submitted_at": e.submitted_at,
                })
        return out

    @gl.public.view
    def get_reputation(self, address: str) -> dict:
        addr = Address(address)
        fulfilled = int(self.rep_fulfilled.get(addr, u256(0)))
        breached = int(self.rep_breached.get(addr, u256(0)))
        fault = int(self.rep_fault.get(addr, u256(0)))
        cases = int(self.rep_cases.get(addr, u256(0)))
        adjudicated = fulfilled + breached
        score = int(round((fulfilled * 100) / adjudicated)) if adjudicated > 0 else 0
        return {
            "address": addr.as_hex,
            "fulfilled": fulfilled,
            "breached": breached,
            "fault": fault,
            "cases": cases,
            "adjudicated": adjudicated,
            "score": score,
        }

    @gl.public.view
    def get_pending_withdrawal(self, address: str) -> str:
        return str(int(self.pending_withdrawals.get(Address(address), u256(0))))

    # -------------------------- internals --------------------------

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _get(self, case_id: int) -> Case:
        cid = u256(int(case_id))
        if cid not in self.cases:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown case id {int(case_id)}")
        return self.cases[cid]

    def _bump(self, table: TreeMap[Address, u256], addr: Address) -> None:
        table[addr] = u256(int(table.get(addr, u256(0))) + 1)

    def _case_to_dict(self, c: Case) -> dict:
        return {
            "id": int(c.id),
            "title": c.title,
            "criteria": c.criteria,
            "client": c.client.as_hex,
            "provider": c.provider.as_hex,
            "created_by": c.created_by.as_hex,
            "created_at": c.created_at,
            "deadline": c.deadline,
            "status": c.status,
            "escrow_atto": str(int(c.escrow_atto)),
            "escrow_funded": bool(c.escrow_funded),
            "fulfilled": bool(c.fulfilled),
            "fault_party": c.fault_party,
            "reasoning": c.reasoning,
            "confidence": int(c.confidence),
            "resolved_at": c.resolved_at,
            "settled_at": c.settled_at,
            "beneficiary": c.beneficiary.as_hex,
            "payout_atto": str(int(c.payout_atto)),
            "fee_atto": str(int(c.fee_atto)),
        }


@gl.evm.contract_interface
class _Payee:
    """Minimal interface used only to send GEN to an externally owned account."""
    class View:
        pass

    class Write:
        pass
