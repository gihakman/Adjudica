// Method schema for the interactive console. Mirrors the deployed Adjudica ABI.
// Each param: { name, type, placeholder, kind } where kind coerces the input.
// kind: "int" (Number), "atto" (GEN string -> bigint value, for payable), "str".
//
// examples: curated one-click presets that prefill the form. Token values are
// resolved at fill time: "{wallet}" -> the connected address, "{latestCaseId}" ->
// the newest case id read from the contract. Two coherent storylines run end to end:
//   - Fulfilled path: research synthesis that clearly meets the brief.
//   - Breach path: an ETL delivery that clearly fails, with you as the funding client
//     so you can also test escrow and withdraw.

export const READ_METHODS = [
  { name: "get_config", label: "get_config()", params: [] },
  { name: "get_case_count", label: "get_case_count()", params: [] },
  {
    name: "get_case",
    label: "get_case(case_id)",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
    examples: [{ label: "Your latest case", values: { case_id: "{latestCaseId}" } }],
  },
  {
    name: "list_cases",
    label: "list_cases(offset, limit)",
    params: [
      { name: "offset", type: "number", placeholder: "0", kind: "int" },
      { name: "limit", type: "number", placeholder: "20", kind: "int" },
    ],
    examples: [{ label: "Newest 20", values: { offset: "0", limit: "20" } }],
  },
  {
    name: "get_evidence",
    label: "get_evidence(case_id)",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
    examples: [{ label: "Your latest case", values: { case_id: "{latestCaseId}" } }],
  },
  {
    name: "get_reputation",
    label: "get_reputation(address)",
    params: [{ name: "address", type: "text", placeholder: "0x…", kind: "str" }],
    examples: [
      { label: "Your address", values: { address: "{wallet}" } },
      { label: "Sample provider", values: { address: "0x1111111111111111111111111111111111111111" } },
    ],
  },
  {
    name: "get_pending_withdrawal",
    label: "get_pending_withdrawal(address)",
    params: [{ name: "address", type: "text", placeholder: "0x…", kind: "str" }],
    examples: [{ label: "Your address", values: { address: "{wallet}" } }],
  },
];

const FULFILLED_CASE = {
  title: "Literature synthesis: five-paper review",
  criteria:
    "Provider must deliver a synthesis report of at least 800 words that summarizes all five assigned papers, includes at least one inline citation per paper, and is submitted before the 2026-09-01 deadline.",
  provider: "0x1111111111111111111111111111111111111111",
  client: "0x2222222222222222222222222222222222222222",
  deadline: "2026-09-01",
};

const BREACH_CASE = {
  title: "ETL pipeline delivery: normalized events dataset",
  criteria:
    "Provider must deliver a normalized events dataset covering the full 30-day window with zero null primary keys and an attached validation report, before the 2026-09-01 deadline.",
  provider: "0x1111111111111111111111111111111111111111",
  client: "{wallet}",
  deadline: "2026-09-01",
};

export const WRITE_METHODS = [
  {
    name: "create_case",
    label: "create_case · open a new SLA",
    params: [
      { name: "title", type: "text", placeholder: "Report delivery SLA", kind: "str" },
      { name: "criteria", type: "textarea", placeholder: "Natural-language fulfillment criteria (>= 12 chars)…", kind: "str" },
      { name: "provider", type: "text", placeholder: "0x… provider (performs work)", kind: "str" },
      { name: "client", type: "text", placeholder: "0x… client (commissions/funds)", kind: "str" },
      { name: "deadline", type: "text", placeholder: "2026-09-01 (optional)", kind: "str" },
    ],
    examples: [
      { label: "Fulfilled path · research synthesis", values: FULFILLED_CASE },
      { label: "Breach path · ETL pipeline (you are the client)", values: BREACH_CASE },
    ],
  },
  {
    name: "fund_escrow",
    label: "fund_escrow · lock GEN in escrow (payable)",
    params: [
      { name: "case_id", type: "number", placeholder: "1", kind: "int" },
      { name: "amount", type: "text", placeholder: "0.01 (GEN to lock)", kind: "atto" },
    ],
    payableParam: "amount",
    examples: [{ label: "Lock 0.01 GEN on your latest case", values: { case_id: "{latestCaseId}", amount: "0.01" } }],
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
    examples: [
      {
        label: "Fulfilled · provider",
        values: {
          case_id: "{latestCaseId}", role: "provider", uri: "", content_hash: "",
          summary: "Delivered synthesis_report.md (1,240 words) summarizing all five assigned papers, with 12 inline citations (at least one per paper). Submitted 2026-07-07, before the deadline.",
        },
      },
      {
        label: "Fulfilled · client",
        values: {
          case_id: "{latestCaseId}", role: "client", uri: "", content_hash: "",
          summary: "Reviewed the report: all five papers are summarized and cited inline, and the length exceeds 800 words. The deliverable meets the agreed criteria.",
        },
      },
      {
        label: "Breach · provider",
        values: {
          case_id: "{latestCaseId}", role: "provider", uri: "", content_hash: "",
          summary: "Delivered a partial dataset covering only 11 of the required 30 days, with no validation report. The job aborted on day 12 and was not retried.",
        },
      },
      {
        label: "Breach · client",
        values: {
          case_id: "{latestCaseId}", role: "client", uri: "", content_hash: "",
          summary: "Reviewed the delivery: 11 of 30 days only, 4,182 rows with null primary keys, and no validation report. It fails the criteria. All required inputs were supplied on time, so the shortfall is on the provider.",
        },
      },
    ],
  },
  {
    name: "adjudicate",
    label: "adjudicate · request a validator verdict",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
    note: "Runs validator consensus over the evidence. May take up to a minute.",
    examples: [{ label: "Adjudicate your latest case", values: { case_id: "{latestCaseId}" } }],
  },
  {
    name: "settle",
    label: "settle · release escrow & credit parties",
    params: [{ name: "case_id", type: "number", placeholder: "1", kind: "int" }],
    examples: [{ label: "Settle your latest case", values: { case_id: "{latestCaseId}" } }],
  },
  {
    name: "withdraw",
    label: "withdraw · pull your settled credit",
    params: [],
  },
];
