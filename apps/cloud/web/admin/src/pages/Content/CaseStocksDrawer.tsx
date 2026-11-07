import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Drawer, Empty, Form, Input, Select, Space, Spin, Tag, Typography } from 'antd'
import { useEffect } from 'react'
import { listCaseStocks, writeCaseStocks } from '../../api'
import { contentErrorText } from '../../lib/contentErrors'
import { qk } from '../../lib/queryKeys'

interface CaseStockForm {
  name: string
  exchange: 'SZSE' | 'SSE' | 'BSE'
  code: string
  period: '1d' | '1w'
  windowStart: string
  windowEnd: string
  note?: string
  events: Array<{ date: string; label: string; unitId: string }>
}

interface CaseStocksForm {
  stocks: CaseStockForm[]
}

const EXCHANGE_OPTIONS = [
  { value: 'SZSE', label: '深交所' },
  { value: 'SSE', label: '上交所' },
  { value: 'BSE', label: '北交所' },
]

const PERIOD_OPTIONS = [
  { value: '1d', label: '日线' },
  { value: '1w', label: '周线' },
]

const DATE_RULE = { pattern: /^\d{4}-\d{2}-\d{2}$/, message: '日期格式 YYYY-MM-DD' }
const CODE_RULE = { pattern: /^\d{6}$/, message: '6 位数字代号' }

/**
 * 案例股抽屉：名称 / 交易所代号 / 案例窗口 / 事件锚点。
 *
 * 写入是整批覆盖（同节同代号 upsert），因此保存会提交表单里的全部案例股。
 * 云端暂无删除端点，故此处不给删除入口——表单里去掉一只不会删库。
 */
export function CaseStocksDrawer({
  courseId,
  sectionId,
  sectionTitle,
  open,
  onClose,
}: {
  courseId: string
  sectionId: string | null
  sectionTitle?: string
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm<CaseStocksForm>()

  const stocks = useQuery({
    queryKey: qk.caseStocks(sectionId ?? ''),
    queryFn: () => listCaseStocks(sectionId ?? ''),
    enabled: open && sectionId !== null,
  })

  useEffect(() => {
    if (!open || stocks.data === undefined) return
    form.setFieldsValue({
      stocks: stocks.data.map(stock => ({
        name: stock.name,
        exchange: stock.exchange as CaseStockForm['exchange'],
        code: stock.code,
        period: stock.period as CaseStockForm['period'],
        windowStart: stock.windowStart,
        windowEnd: stock.windowEnd,
        note: stock.note ?? '',
        events: stock.events.map(event => ({ ...event })),
      })),
    })
  }, [form, open, stocks.data])

  const save = useMutation({
    mutationFn: (values: CaseStocksForm) => {
      if (sectionId === null) throw new Error('未选中节')
      return writeCaseStocks(sectionId, values.stocks.map(stock => {
        const note = stock.note?.trim()
        return {
          name: stock.name,
          exchange: stock.exchange,
          code: stock.code,
          period: stock.period,
          windowStart: stock.windowStart,
          windowEnd: stock.windowEnd,
          events: stock.events.map(event => ({
            date: event.date,
            label: event.label,
            unitId: event.unitId,
          })),
          ...(note === undefined || note === '' ? {} : { note }),
        }
      }))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.caseStocks(sectionId ?? '') })
      await queryClient.invalidateQueries({ queryKey: qk.readiness(courseId) })
      void message.success('案例股已保存（改动后需重新签批）')
      onClose()
    },
    onError: error => void message.error(contentErrorText(error, '保存案例股失败')),
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(760px, 94vw)"
      destroyOnHidden
      title={
        <Space wrap>
          <span>案例股</span>
          {sectionId === null ? null : <Tag bordered={false}>{sectionId}</Tag>}
          {sectionTitle === undefined ? null : <Typography.Text type="secondary">{sectionTitle}</Typography.Text>}
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
      {sectionId === null ? (
        <Spin />
      ) : stocks.isLoading ? (
        <div className="page-loading"><Spin /></div>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="案例窗口决定 K 线与标注的可见区间"
            description="事件锚点必须能回溯到 source unit；日期须落在案例窗口内，否则云端整批拒绝（不部分落库）。"
          />
          <Form<CaseStocksForm> form={form} layout="vertical" preserve={false}>
            <Form.List name="stocks">
              {(fields, { add }) => (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {fields.length === 0 ? (
                    <Empty description="本节还没有案例股。" />
                  ) : fields.map(field => (
                    <Card key={field.key} size="small" title={`案例股 ${field.name + 1}`}>
                      <Form.Item {...field} name={[field.name, 'name']} label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                        <Input maxLength={50} />
                      </Form.Item>
                      <Space wrap style={{ width: '100%' }}>
                        <Form.Item {...field} name={[field.name, 'exchange']} label="交易所" rules={[{ required: true }]}>
                          <Select style={{ width: 140 }} options={EXCHANGE_OPTIONS} />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'code']} label="代号" rules={[{ required: true }, CODE_RULE]}>
                          <Input style={{ width: 160 }} placeholder="6 位数字" />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'period']} label="K 线周期" rules={[{ required: true }]}>
                          <Select style={{ width: 120 }} options={PERIOD_OPTIONS} />
                        </Form.Item>
                      </Space>
                      <Space wrap style={{ width: '100%' }}>
                        <Form.Item {...field} name={[field.name, 'windowStart']} label="案例窗口起" rules={[{ required: true }, DATE_RULE]}>
                          <Input style={{ width: 180 }} placeholder="YYYY-MM-DD" />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'windowEnd']} label="案例窗口止" rules={[{ required: true }, DATE_RULE]}>
                          <Input style={{ width: 180 }} placeholder="YYYY-MM-DD" />
                        </Form.Item>
                      </Space>
                      <Form.Item {...field} name={[field.name, 'note']} label="备注">
                        <Input maxLength={500} />
                      </Form.Item>
                      <Form.List name={[field.name, 'events']}>
                        {(eventFields, { add: addEvent }) => (
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Typography.Text strong>事件锚点（{eventFields.length}）</Typography.Text>
                            {eventFields.map(eventField => (
                              <Space key={eventField.key} wrap align="start">
                                <Form.Item
                                  {...eventField}
                                  name={[eventField.name, 'date']}
                                  rules={[{ required: true, message: '请输入日期' }, DATE_RULE]}
                                >
                                  <Input style={{ width: 150 }} placeholder="YYYY-MM-DD" />
                                </Form.Item>
                                <Form.Item
                                  {...eventField}
                                  name={[eventField.name, 'label']}
                                  rules={[{ required: true, message: '请输入标签' }]}
                                >
                                  <Input style={{ width: 180 }} placeholder="例：筹码峰" />
                                </Form.Item>
                                <Form.Item
                                  {...eventField}
                                  name={[eventField.name, 'unitId']}
                                  rules={[{ required: true, message: '请输入 unitId' }, { pattern: /^su_[0-9a-f]{16}$/, message: 'unitId 形如 su_xxxxxxxxxxxxxxxx' }]}
                                >
                                  <Input style={{ width: 240 }} placeholder="su_" />
                                </Form.Item>
                              </Space>
                            ))}
                            <Button size="small" onClick={() => addEvent({ date: '', label: '', unitId: '' })}>
                              新增事件锚点
                            </Button>
                          </Space>
                        )}
                      </Form.List>
                    </Card>
                  ))}
                  <Button onClick={() => add({ name: '', exchange: 'SZSE', code: '', period: '1d', windowStart: '', windowEnd: '', note: '', events: [] })}>
                    新增案例股
                  </Button>
                </Space>
              )}
            </Form.List>
          </Form>
        </Space>
      )}
    </Drawer>
  )
}
