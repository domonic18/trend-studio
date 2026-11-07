import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Select, Space, Spin, Tag, Typography } from 'antd'
import { useEffect } from 'react'
import { listConcepts, listMediaAssets, putSection } from '../../api'
import { contentErrorText } from '../../lib/contentErrors'
import { qk } from '../../lib/queryKeys'
import type { Section } from '../../types'

interface SectionForm {
  title: string
  position: number
  summary?: string
  conceptRefs: string[]
  sourceAssetIds: string[]
}

/** 节编辑抽屉：标题 / 摘要 / 序位 / 关联术语 / 来源素材。改动落草稿，已签批内容需重新签批。 */
export function SectionDrawer({
  courseId,
  section,
  open,
  onClose,
}: {
  courseId: string
  section: Section | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm<SectionForm>()

  const concepts = useQuery({
    queryKey: qk.concepts(courseId),
    queryFn: () => listConcepts(courseId),
    enabled: open,
  })
  const assets = useQuery({
    queryKey: qk.assets(courseId),
    queryFn: () => listMediaAssets({ courseId, limit: 200 }),
    enabled: open,
  })

  useEffect(() => {
    if (!open || section === null) return
    form.setFieldsValue({
      title: section.title,
      position: section.position,
      summary: section.summary ?? '',
      conceptRefs: section.conceptRefs,
      sourceAssetIds: section.sourceAssetIds,
    })
  }, [form, open, section])

  const save = useMutation({
    mutationFn: (values: SectionForm) => {
      if (section === null) throw new Error('未选中节')
      const summary = values.summary?.trim()
      return putSection({
        sectionId: section.sectionId,
        courseId: section.courseId,
        chapterId: section.chapterId,
        title: values.title,
        position: values.position,
        ...(summary === undefined || summary === '' ? {} : { summary }),
        conceptRefs: values.conceptRefs,
        sourceAssetIds: values.sourceAssetIds,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.sections(courseId) })
      await queryClient.invalidateQueries({ queryKey: qk.readiness(courseId) })
      void message.success('节已更新（内容变更后需重新签批）')
      onClose()
    },
    onError: error => void message.error(contentErrorText(error, '保存节失败')),
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(620px, 94vw)"
      destroyOnHidden
      title={
        <Space wrap>
          <span>编辑节</span>
          {section === null ? null : <Tag bordered={false}>{section.sectionId}</Tag>}
        </Space>
      }
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() => void form.validateFields().then(values => save.mutate(values))}
        >
          保存
        </Button>
      }
    >
      {section === null ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="改动落草稿"
            description="节标题、摘要、术语引用与素材源都会进内容指纹；已签批的课程改动后需重新签批才能发布。"
          />
          <Form<SectionForm> form={form} layout="vertical" preserve={false}>
            <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入节标题' }]}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item
              name="position"
              label="序位"
              rules={[{ required: true, message: '请输入序位' }]}
            >
              <InputNumber min={1} max={10_000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="summary" label="摘要">
              <Input.TextArea rows={4} maxLength={2000} placeholder="学员端可见的一句话概述" />
            </Form.Item>
            <Form.Item name="conceptRefs" label="关联术语">
              <Select
                mode="multiple"
                allowClear
                optionFilterProp="label"
                placeholder="正文 glossary 按名称/别名匹配，术语改名请走归档 + 新建"
                options={(concepts.data ?? []).map(concept => ({
                  value: concept.conceptId,
                  label: `${concept.name}${concept.status === 'archived' ? '（已归档）' : ''}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="sourceAssetIds" label="来源素材">
              <Select
                mode="multiple"
                allowClear
                optionFilterProp="label"
                placeholder="节所引用的原片素材（用于片段窗与标注时间码）"
                options={(assets.data?.assets ?? []).map(asset => ({
                  value: asset.assetId,
                  label: `${asset.title ?? asset.assetId}（${asset.status}）`,
                }))}
              />
            </Form.Item>
          </Form>
          <Typography.Text type="secondary">
            术语 {concepts.data?.length ?? 0} 条 · 素材 {assets.data?.assets.length ?? 0} 个
          </Typography.Text>
        </Space>
      )}
    </Drawer>
  )
}
