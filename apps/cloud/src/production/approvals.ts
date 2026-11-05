/** 审批记录（M3b）：审批 = 对课程内容指纹的签名；同课程同门禁幂等重批。 */

import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import type { ApprovalGate, ApprovalItem } from '@trend/contracts'

interface ApprovalRow {
  approval_id: string
  course_id: string
  gate: ApprovalGate
  digest: string
  digest_sections: unknown
  approved_by: string
  approved_at: Date
}

function toApprovalItem(row: ApprovalRow): ApprovalItem {
  return {
    approvalId: row.approval_id,
    courseId: row.course_id,
    gate: row.gate,
    digest: row.digest,
    digestSections: (row.digest_sections ?? {}) as Record<string, string>,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at.toISOString(),
  }
}

export function approvalIdFor(): string {
  return `apr_${randomBytes(8).toString('hex')}`
}

export async function upsertCourseApproval(
  pool: Pool,
  input: {
    courseId: string
    gate: ApprovalGate
    digest: string
    digestSections: Record<string, string>
    approvedBy: string
  },
): Promise<ApprovalItem> {
  const { rows } = await pool.query<ApprovalRow>(
    `INSERT INTO content_approvals
       (approval_id, course_id, gate, digest, digest_sections, approved_by, approved_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
     ON CONFLICT (course_id, gate) DO UPDATE
       SET approval_id = EXCLUDED.approval_id,
           digest = EXCLUDED.digest,
           digest_sections = EXCLUDED.digest_sections,
           approved_by = EXCLUDED.approved_by,
           approved_at = now()
     RETURNING approval_id, course_id, gate, digest, digest_sections, approved_by, approved_at`,
    [
      approvalIdFor(),
      input.courseId,
      input.gate,
      input.digest,
      JSON.stringify(input.digestSections),
      input.approvedBy,
    ],
  )
  const row = rows[0]
  if (row === undefined) throw new Error('approval upsert returned no row')
  return toApprovalItem(row)
}

export async function listCourseApprovals(pool: Pool, courseId: string): Promise<ApprovalItem[]> {
  const { rows } = await pool.query<ApprovalRow>(
    `SELECT approval_id, course_id, gate, digest, digest_sections, approved_by, approved_at
       FROM content_approvals WHERE course_id = $1 ORDER BY gate`,
    [courseId],
  )
  return rows.map(toApprovalItem)
}
