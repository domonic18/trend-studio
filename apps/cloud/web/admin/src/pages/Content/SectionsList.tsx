import { useQuery } from '@tanstack/react-query'
import { EditOutlined, FileTextOutlined, StockOutlined } from '@ant-design/icons'
import { Button, Empty, List, Space, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { listSections } from '../../api'
import { StatusTag } from '../../components/StatusTag'
import { qk } from '../../lib/queryKeys'
import type { Chapter, Section } from '../../types'

/** 章内节导航：点击进入管理台节预览页（教材 + 课件 + 图示）；可编辑时给出节与案例股入口。 */
export function SectionsList({
  courseId,
  chapter,
  canEdit = false,
  onEditSection,
  onEditCaseStocks,
}: {
  courseId: string
  chapter: Chapter
  canEdit?: boolean
  onEditSection?: (section: Section) => void
  onEditCaseStocks?: (section: Section) => void
}) {
  const navigate = useNavigate()
  const sections = useQuery({
    queryKey: qk.sections(courseId, chapter.chapterId),
    queryFn: () => listSections(courseId, chapter.chapterId),
  })
  const data = sections.data ?? []

  return (
    <div className="section-list">
      <div className="section-list-head">
        <Typography.Text strong>节（{data.length}）</Typography.Text>
      </div>
      {sections.isLoading ? (
        <Typography.Text type="secondary">加载节列表…</Typography.Text>
      ) : data.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本章暂无节" />
      ) : (
        <List
          size="small"
          dataSource={data}
          renderItem={section => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  type="link"
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => navigate(`/courses/${courseId}/sections/${section.sectionId}`)}
                >
                  预览
                </Button>,
                ...(canEdit && onEditSection !== undefined
                  ? [
                    <Button
                      key="edit"
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => onEditSection(section)}
                    >
                      编辑节
                    </Button>,
                  ]
                  : []),
                ...(canEdit && onEditCaseStocks !== undefined
                  ? [
                    <Button
                      key="stocks"
                      type="link"
                      size="small"
                      icon={<StockOutlined />}
                      onClick={() => onEditCaseStocks(section)}
                    >
                      案例股
                    </Button>,
                  ]
                  : []),
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <span>{section.title}</span>
                    <Tag bordered={false}>{section.sectionId}</Tag>
                    <StatusTag value={section.status} />
                    {section.conceptRefs.length > 0 ? (
                      <Tag color="blue">{section.conceptRefs.length} 概念</Tag>
                    ) : null}
                  </Space>
                }
                description={
                  <Typography.Text type="secondary">
                    位置 {section.position} · {section.sourceAssetIds.length} 个素材源
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  )
}
