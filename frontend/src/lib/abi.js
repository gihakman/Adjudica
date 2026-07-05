// Method schema for the interactive console. Mirrors the deployed Adjudica ABI.
// Each param: { name, type, placeholder, kind } where kind coerces the input.
// kind: "int" (Number), "atto" (GEN string -> bigint value, for payable), "str".

export const READ_METHODS = [
  { name: "get_config", label: "get_config()", params: [] },
  { name: "get_case_count", label: "get_case_count()", params: [] },
  {
    name: "get_case",
    label: "get_case(case_id)",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
  },
  {
    name: "list_cases",
    label: "list_cases(offset, limit)",
    params: [
      { name: "offset", type: "number", placeholder: "0", kind: "int" },
      { name: "limit", type: "number", placeholder: "20", kind: "int" },
    ],
  },
  {
    name: "get_evidence",
    label: "get_evidence(case_id)",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
  },
  {
    name: "get_reputation",
    label: "get_reputation(address)",
    params: [{ name: "address", type: "text", placeholder: "0x…", kind: "str" }],
  },
  {
    name: "get_pending_withdrawal",
    label: "get_pending_withdrawal(address)",
    params: [{ name: "address", type: "text", placeholder: "0x…", kind: "str" }],
  },
];

export const WRITE_METHODS = [
  {
    name: "create_case",
    label: "create_case · open a new SLA",
    params: [
      { name: "title", type: "text", placeholder: "Research synthesis SLA", kind: "str" },
      { name: "criteria", type: "textarea", placeholder: "Natural-language fulfillment criteria (>= 12 chars)…", kind: "str" },
      { name: "provider", type: "text", placeholder: "0x… provider (performs work)", kind: "str" },
      { name: "client", type: "text", placeholder: "0x… client (commissions/funds)", kind: "str" },
      { name: "deadline", type: "text", placeholder: "2026-08-01 (optional)", kind: "str" },
    ],
  },
  {
    name: "submit_evidence",
    label: "submit_evidence · commit evidence on-chain",
    params: [
      { name: "case_id", type: "number", placeholder: "1", kind: "int" },
      { name: "role", type: "text", placeholder: "provider | client | observer", kind: "str" },
      { name: "summary", type: "textarea", placeholder: "Agent log excerpt, output, or note…", kind: "str" },
      { name: "uri", type: "text", placeholder: "optional pointer (not fetched)", kind: "str" },
      { name: "content_hash", type: "text", placeholder: "optional integrity hash", kind: "str" },
    ],
  },
  {
    name: "adjudicate",
    label: "adjudicate · request a validator verdict",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
    note: "Runs LLM consensus across validators. May take up to a minute.",
  },
  {
    name: "settle",
    label: "settle · release escrow & credit parties",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
  },
  {
    name: "fund_escrow",
    label: "fund_escrow · lock GEN in escrow (payable)",
    params: [
      { name: "case_id", type: "number", placeholder: "1", kind: "int" },
      { name: "amount", type: "text", placeholder: "0.01 (GEN to lock)", kind: "atto" },
    ],
    payableParam: "amount",
  },
  {
    name: "withdraw",
    label: "withdraw · pull your settled credit",
    params: [],
  },
];
