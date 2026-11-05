import { useQuery } from '@tanstack/react-query'
import { FileTextOutlined } from '@ant-design/icons'
import { Button, Empty, List, Space, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { listSections } from '../../api'
import { StatusTag } from '../../components/StatusTag'
import { qk } from '../../lib/queryKeys'
import type { Chapter } from '../../types'

/** 章内节导航：点击进入管理台节预览页（教材 + 课件 + 图示）。 */
export function SectionsList({ courseId, chapter }: { courseId: string; chapter: Chapter }) {
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
