// 治理平台的核心数据模型。所有页面、脚本与测试共用这一套类型。

export type IntentId = 'quote' | 'fundamental' | 'fund' | 'news' | 'hot' | 'advice';

/** 六个质量维度，对应题目中的五类问题（隐私单列） */
export type DimensionId =
  | 'relevance' // 答非所问
  | 'accuracy' // 数字错误
  | 'freshness' // 时效过期
  | 'personalization' // 个性化失真
  | 'compliance' // 合规越界
  | 'privacy'; // 隐私边界

/** 结论由谁给出：规则 / LLM 评审 / 数据核验 / 人工复核 / 用户行为 */
export type Stage = 'rule' | 'llm_judge' | 'data_verify' | 'human' | 'feedback';
export type Severity = 'high' | 'medium' | 'low';
export type Verdict = 'pass' | 'fail' | 'warn' | 'unverifiable' | 'na';
export type Overall = 'pass' | 'review' | 'fail';

/** 投资者风险承受等级 C1–C5 与产品风险等级 R1–R5 */
export type Level = 1 | 2 | 3 | 4 | 5;

export type FundRange = '1m' | '3m' | '6m' | '1y' | '3y' | 'ytd' | 'inception';
export type FundRangeMetric = `fund_return_${FundRange}` | `fund_mdd_${FundRange}`;

export type Unit = 'CNY' | 'CNY_per_share' | 'pct' | 'shares' | 'x' | 'text' | 'R';

export type MetricId =
  // 行情（按交易日）
  | 'price'
  | 'change_pct'
  | 'change'
  | 'open'
  | 'high'
  | 'low'
  | 'prev_close'
  | 'volume'
  | 'turnover'
  | 'return_5d'
  // 估值（按交易日）
  | 'pe_ttm'
  | 'pb_mrq'
  // 财务（按报告期）
  | 'revenue'
  | 'net_profit'
  | 'parent_net_profit'
  | 'revenue_yoy'
  | 'net_profit_yoy'
  | 'gross_margin'
  | 'roe'
  | 'eps'
  // 基金
  | 'nav'
  | FundRangeMetric
  | 'fund_scale'
  | 'fund_manager'
  // 主数据
  | 'risk_level';

export interface SourceRef {
  provider: 'fuyao' | 'master_data' | 'derived' | 'constructed';
  endpoint?: string;
  params?: Record<string, string | number>;
  request_id?: string;
  fetched_at?: string;
  note?: string;
}

/**
 * 一条可核验的事实。period 取值：
 * - 行情 / 估值 / 净值：交易日 'YYYY-MM-DD'
 * - 财务：报告期 'YYYY-Qn'（Q2=中报累计，Q4=年报）
 * - 区间类（基金近一年收益等）：'latest'，as_of 写数据所指日期
 */
export interface Fact {
  key: string;
  entity: string;
  metric: MetricId;
  period: string;
  value: number | string | null;
  unit: Unit;
  as_of: string;
  source: SourceRef;
  derived_from?: string[];
  note?: string;
}

export interface Entity {
  thscode: string;
  name: string;
  aliases: string[];
  type: 'stock' | 'fund' | 'index';
  /** 产品风险等级（适当性主数据，构造样例） */
  risk_level?: Level;
  category?: string;
  sector?: string;
}

export type Horizon = 'short' | 'medium' | 'long';

/** 匿名构造的 KYC 画像。姓名、手机号、证件号等 L3 字段不进入本结构（保存在隔离的身份库，Agent 永远拿不到） */
export interface KycProfile {
  persona_id: string;
  label: string;
  risk_level: Level;
  risk_label: string;
  assessed_at: string;
  expires_at: string;
  age: number;
  age_band: string;
  occupation: string;
  city: string;
  experience_years: number;
  horizon: Horizon;
  objective: string;
  liquidity_need: 'high' | 'medium' | 'low';
  total_assets: number;
  asset_band: string;
  annual_income: number;
  income_band: string;
  holdings: { thscode: string; name: string; market_value: number; weight_pct: number }[];
  is_professional: boolean;
}

export type FieldGrade = 'L1' | 'L2' | 'L3';

export interface EvalItem {
  item_id: string;
  question_id: string;
  persona_id: string;
  intent: IntentId;
  question: string;
  gold: {
    entities: string[];
    metrics: MetricId[];
    /** 每组关键词至少命中一个，用于槽位覆盖（答非所问）判断 */
    slot_keywords: string[][];
    answerable: boolean;
    /** 期望 Agent 拒绝的部分（如收益承诺），此时拒答不算答非所问 */
    expect_refusal_of?: string;
    invariance_group?: string;
    invariant_metrics?: MetricId[];
    products_in_question?: string[];
    note?: string;
  };
  tags: string[];
}

export interface PromptManifest {
  prompt_id: string;
  label: string;
  /** 只使用提供的数据，缺失时明确说明 */
  grounding_rule: boolean;
  requires_time_label: boolean;
  requires_disclosure: boolean;
  forbids_guarantee: boolean;
  forbids_orders: boolean;
  suitability_rule: boolean;
  invariance_rule: boolean;
  privacy_rule: boolean;
  hot_relevance_rule: boolean;
  encourages_confidence: boolean;
}

export interface AgentVersion {
  version_id: string;
  label: string;
  status: 'baseline' | 'archived' | 'production' | 'candidate';
  components: {
    model: string;
    prompt: string;
    data: 'D1' | 'D2';
    hot: 'H1' | 'H2';
    kyc: 'K1' | 'K2';
    router: string;
  };
  parent?: string;
  change_note: string;
}

export interface HotItem {
  kind: 'hot_stock' | 'news' | 'anomaly';
  title: string;
  thscode?: string;
  name?: string;
  published_at: string;
  source: SourceRef;
}

export interface ContextDatum {
  fact_key: string;
  entity: string;
  metric: MetricId;
  period: string;
  value: number | string | null;
  unit: Unit;
  as_of: string;
}

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  data_version: 'D1' | 'D2';
  status: 'ok' | 'empty' | 'error';
  fact_keys: string[];
  as_of?: string;
  error?: string;
}

export interface Trace {
  router: {
    model: string;
    output: { intent: IntentId | string; entities: string[]; metrics: string[]; period: string | null } | null;
    latency_ms: number;
    error?: string;
  };
  resolved_entities: { mention: string; thscode: string | null }[];
  tool_calls: ToolCall[];
  context: {
    kyc_policy: 'K1' | 'K2';
    kyc_payload: Record<string, unknown>;
    hot_policy: 'H1' | 'H2';
    hot_items: HotItem[];
    data: ContextDatum[];
    news: { title: string; published_at: string; source: string }[];
    question_passed: string;
  };
  llm: {
    model: string;
    prompt_version: string;
    temperature: number | null;
    latency_ms: number;
    usage?: { prompt_tokens: number; completion_tokens: number };
    finish_reason?: string;
    error?: string;
  };
}

export interface AnswerLog {
  answer_id: string;
  item_id: string;
  version_id: string;
  question_id: string;
  persona_id: string;
  /** 入库前已脱敏的问题文本 */
  question_masked: string;
  answer: string;
  created_at: string;
  status: 'ok' | 'agent_error';
  error?: string;
  trace: Trace;
}

export type Qualifier = 'exact' | 'approx' | 'gt' | 'lt';

export interface Claim {
  claim_id: string;
  start: number;
  end: number;
  text: string;
  sentence: string;
  entity: string | null;
  metric: MetricId | null;
  /** 回答里明确写出的报告期或日期（未写为 null） */
  period: string | null;
  value: number;
  unit: Unit;
  qualifier: Qualifier;
  decimals: number;
  /** 数字后的量级单位（亿=1e8、万=1e4），用于按声明精度计算容差 */
  scale: number;
  /** 是否写明了方向（正负号或涨/跌等动词）；没写方向的“约 7% 的波动”按绝对值比较 */
  sign_explicit?: boolean;
  /** 区间未写明时（如只写“最大回撤 -12%”），列出所有可能的指标，任一吻合即视为有出处 */
  metric_candidates?: MetricId[];
}

/** unrecognized：识别不出指标的数字（如仓位比例），不参与核验也不送人工 */
export type ClaimVerdict = 'match' | 'mismatch' | 'stale_match' | 'unverifiable' | 'unrecognized';

export interface ClaimVerification {
  claim_id: string;
  verdict: ClaimVerdict;
  reason: string;
  fact_key?: string;
  fact_value?: number | string | null;
  fact_as_of?: string;
  matched_fact_key?: string;
  /** 与 Agent 当时拿到的上下文数据比较，用于归因 */
  in_context: 'match' | 'mismatch' | 'absent' | 'unknown';
  context_value?: number | string | null;
  context_as_of?: string;
  tolerance: string;
}

export type EvidenceItem =
  | { kind: 'span'; start: number; end: number; text: string }
  | { kind: 'fact'; fact_key: string; value: number | string | null; as_of: string; source: SourceRef }
  | { kind: 'rule'; rule_id: string; text: string }
  | { kind: 'trace'; path: string; detail: string }
  | { kind: 'note'; text: string };

export type CheckId =
  | 'REL-SLOT'
  | 'REL-LLM'
  | 'REL-DRIFT'
  | 'REL-REFUSE'
  | 'ACC-NUM'
  | 'ACC-UNGROUNDED'
  | 'FRS-ASOF'
  | 'FRS-LABEL'
  | 'FRS-HOT'
  | 'PER-SUIT'
  | 'PER-KYC'
  | 'PER-INVARIANT'
  | 'PER-FIT'
  | 'CMP-GUARANTEE'
  | 'CMP-PREDICT'
  | 'CMP-ORDER'
  | 'CMP-DISCLOSURE'
  | 'CMP-RUMOR'
  | 'CMP-ABSOLUTE'
  | 'CMP-LEVERAGE'
  | 'PRV-ECHO'
  | 'PRV-CONTEXT';

export interface CheckResult {
  check_id: CheckId;
  dimension: DimensionId;
  stage: Stage;
  severity: Severity;
  verdict: Verdict;
  message: string;
  evidence: EvidenceItem[];
}

export type RootCauseLayer =
  | 'routing'
  | 'data_missing'
  | 'data_stale'
  | 'context_hot'
  | 'context_kyc'
  | 'prompt'
  | 'generation'
  | 'unverifiable';

export interface Attribution {
  check_id: CheckId;
  layer: RootCauseLayer;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  fix_hint: string;
}

export type ReviewReasonId =
  | 'high_risk_hit'
  | 'unverifiable_fact'
  | 'judge_disagree'
  | 'negative_feedback_pass'
  | 'calibration_sample'
  | 'invariance_violation'
  | 'agent_error';

export interface ReviewReason {
  reason: ReviewReasonId;
  detail: string;
  priority: number;
}

export interface JudgeResult {
  judge_id: string;
  model: string;
  relevance: 0 | 1 | 2;
  personalization: 0 | 1 | 2 | null;
  missing: string[];
  drift_to_hot: boolean;
  fact_bending_suspected: boolean;
  confidence: number;
  reason: string;
  latency_ms: number;
  raw?: string;
  error?: string;
}

export interface AnswerEval {
  answer_id: string;
  item_id: string;
  version_id: string;
  question_id: string;
  persona_id: string;
  intent: IntentId;
  claims: Claim[];
  verifications: ClaimVerification[];
  checks: CheckResult[];
  dimensions: Record<DimensionId, Verdict>;
  overall: Overall;
  attributions: Attribution[];
  review_reasons: ReviewReason[];
}

export interface InvarianceFactRow {
  entity: string;
  metric: MetricId;
  truth: number | string | null;
  values: { persona_id: string; answer_id: string; value: number | string | null; text: string | null }[];
  consistent: boolean;
  covered_all: boolean;
  matches_truth: boolean;
}

export interface InvarianceGroupResult {
  group_id: string;
  version_id: string;
  question_id: string;
  question: string;
  members: { item_id: string; persona_id: string; answer_id: string }[];
  rows: InvarianceFactRow[];
  disclosure_parity: { persona_id: string; has_disclosure: boolean; risk_terms: number }[];
  verdict: 'pass' | 'fail';
  issues: string[];
}

export interface FeedbackEvent {
  answer_id: string;
  version_id: string;
  thumbs: 'up' | 'down' | null;
  rephrased_within_60s: boolean;
  asked_data_source: boolean;
  copied: boolean;
  complaint: boolean;
}

export interface HumanReview {
  answer_id: string;
  reviewer: string;
  reviewed_at: string;
  decisions: Partial<Record<DimensionId, 'agree' | 'override_pass' | 'override_fail'>>;
  root_cause?: RootCauseLayer;
  comment: string;
}

export interface Dataset {
  generated_at: string;
  eval_date: string;
  latest_trading_day: string;
  entities: Entity[];
  personas: KycProfile[];
  items: EvalItem[];
  versions: AgentVersion[];
  prompts: PromptManifest[];
  facts: Fact[];
}
