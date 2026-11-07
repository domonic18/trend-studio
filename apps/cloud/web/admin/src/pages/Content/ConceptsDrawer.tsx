import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Drawer, Empty, Form, Input, Select, Space, Spin, Tag, Typography } from 'antd'
import { useEffect } from 'react'
import { listConcepts, updateConcept } from '../../api'
import { contentErrorText } from '../../lib/contentErrors'
import { qk } from '../../lib/queryKeys'

interface ConceptForm {
  name: string
  aliases: string[]
  definition?: string
}

interface ConceptsForm {
  concepts: ConceptForm[]
}

/**
 * 术语抽屉：别名 / 定义 / 归档。
 *
 * 术语名是正文 glossary 的匹配键，改名走「归档 + 新建」；归档可逆（置回 draft 即恢复）。
 * 归档会改变正文标注的术语校验，因此也进内容指纹——改完需重新签批。
 */
export function ConceptsDrawer({
  courseId,
  open,
  onClose,
}: {
  courseId: string
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm<ConceptsForm>()

  const concepts = useQuery({
    queryKey: qk.concepts(courseId),
    queryFn: () => listConcepts(courseId),
    enabled: open,
  })

  useEffect(() => {
    if (!open || concepts.data === undefined) return
    form.setFieldsValue({
      concepts: concepts.data.map(concept => ({
        name: concept.name,
        aliases: [...concept.aliases],
        definition: concept.definition ?? '',
      })),
    })
  }, [concepts.data, form, open])

  const save = useMutation({
    mutationFn: async (items: Array<{ conceptId: string; values: ConceptForm }>) => {
      for (const item of items) {
        await updateConcept(courseId, item.conceptId, {
          aliases: item.values.aliases,
          ...(item.values.definition === undefined || item.values.definition.trim() === ''
            ? { definition: null }
            : { definition: item.values.definition.trim() }),
        })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.concepts(courseId) })
      await queryClient.invalidateQueries({ queryKey: qk.readiness(courseId) })
      void message.success('术语已保存（改动后需重新签批）')
    },
    onError: error => void message.error(contentErrorText(error, '保存术语失败')),
  })

  const setStatus = useMutation({
    mutationFn: (input: { conceptId: string; status: 'draft' | 'archived' }) =>
      updateConcept(courseId, input.conceptId, { status: input.status }),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: qk.concepts(courseId) })
      await queryClient.invalidateQueries({ queryKey: qk.readiness(courseId) })
      void message.success(variables.status === 'archived' ? '术语已归档' : '术语已恢复')
    },
    onError: error => void message.error(contentErrorText(error, '更新术语状态失败')),
  })

  const data = concepts.data ?? []

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(720px, 94vw)"
      destroyOnHidden
      title="课程术语"
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() => {
            const values = form.getFieldValue('concepts')
            const items = data.flatMap((concept, index) => {
              const row = values?.[index]
              return row === undefined ? [] : [{ conceptId: concept.conceptId, values: row }]
            })
            save.mutate(items)
          }}
        >
          保存全部
        </Button>
      }
    >
      {concepts.isLoading ? (
        <div className="page-loading"><Spin /></div>
      ) : data.length === 0 ? (
        <Empty description="本课程还没有术语。" />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="别名与定义进内容指纹"
            description="术语名不可改（改名请归档后新建）；归档可逆，但归档后该术语不再计入正文标注的术语校验。"
          />
          <Form<ConceptsForm> form={form} layout="vertical" preserve={false}>
            <Form.List name="concepts">
              {fields => fields.map((field, index) => {
                const concept = data[index]
                if (concept === undefined) return null
                const archived = concept.status === 'archived'
                return (
                  <Card
                    key={field.key}
                    size="small"
                    style={{ marginBottom: 12 }}
                    title={
                      <Space wrap>
                        <span>{concept.name}</span>
                        <Tag bordered={false}>{concept.conceptId}</Tag>
                        {archived ? <Tag bordered={false} color="orange">已归档</Tag> : null}
                      </Space>
                    }
                    extra={
                      <Space>
                        <Button
                          size="small"
                          loading={save.isPending}
                          onClick={() => {
                            const row = form.getFieldValue(['concepts', index])
                            if (row === undefined) return
                            save.mutate([{ conceptId: concept.conceptId, values: row }])
                          }}
                        >
                          保存
                        </Button>
                        {archived ? (
                          <Button
                            size="small"
                            loading={setStatus.isPending}
                            onClick={() => setStatus.mutate({ conceptId: concept.conceptId, status: 'draft' })}
                          >
                            恢复
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            danger
                            loading={setStatus.isPending}
                            onClick={() => setStatus.mutate({ conceptId: concept.conceptId, status: 'archived' })}
                          >
                            归档
                          </Button>
                        )}
                      </Space>
                    }
                  >
                    <Form.Item {...field} name={[field.name, 'aliases']} label="别名">
                      <Select
                        mode="tags"
                        allowClear
                        placeholder="正文 glossary 按名称或别名匹配"
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'definition']} label="定义">
                      <Input.TextArea rows={3} maxLength={2000} />
                    </Form.Item>
                    <Typography.Text type="secondary">术语名不可改</Typography.Text>
                  </Card>
                )
              })}
            </Form.List>
          </Form>
        </Space>
      )}
    </Drawer>
  )
}
