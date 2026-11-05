/** 实体 ID 形状单一真相源：生成侧严格形（16 hex）与引用侧宽松形并存时各自具名导出。 */

export const ASSET_ID = /^asset_[0-9a-f]{16}$/
export const SOURCE_UNIT_ID = /^su_[0-9a-f]{16}$/
export const CONCEPT_ID = /^cpt_[0-9a-f]{16}$/
export const SECTION_ID = /^sec_[0-9a-f]{16}$/
export const WIDGET_ID = /^wgt_[0-9a-f]{16}$/
export const TRANSCRIPT_ID = /^tr_[0-9a-f]{16}$/
export const JOB_ID = /^job_[0-9a-f]{16}$/

/** 云端生成的 figure 主键（严格形）。 */
export const FIGURE_ID_STRICT = /^fig_[0-9a-f]{16}$/
/** DSL 属性中引用 figure 的宽松形（兼容人工输入与候选变体 ID）。 */
export const FIGURE_ID_REF = /^fig_[A-Za-z0-9._-]{1,60}$/

export const CONCEPT_EDGE_ID = /^ced_[0-9a-f]{16}$/
export const CASE_STOCK_REF_ID = /^cst_[0-9a-f]{16}$/
export const APPROVAL_ID = /^apr_[0-9a-f]{16}$/

/** DSL 内联案例股锚（交易所前缀 + 6 位数字）。 */
export const STOCK_CODE = /^(sz|sh|bj)\d{6}$/
/** 案例股写入的纯数字代码（交易所由独立枚举表达）。 */
export const STOCK_CODE_PLAIN = /^[0-9]{6}$/

export const DATE_STR = /^\d{4}-\d{2}-\d{2}$/
