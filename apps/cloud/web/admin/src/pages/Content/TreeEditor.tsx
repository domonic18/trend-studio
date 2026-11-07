import {
  BookOutlined,
  DatabaseOutlined,
  EditOutlined,
  FileTextOutlined,
  PictureOutlined,
  PlusOutlined,
  ProjectOutlined,
  QuestionCircleOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  approveCourse,
  createChapter,
  createKnowledgePoint,
  getCourseReadiness,
  getCourseTree,
  listCourseApprovals,
  listSections,
  patchChapter,
  patchCourse,
  patchKnowledgePoint,
  publishCourse,
  reindex,
} from '../../api'
import { useAuth } from '../../auth/AuthProvider'
import { StatusTag } from '../../components/StatusTag'
import { qk } from '../../lib/queryKeys'
import { approvalErrorText, publishErrorText } from '../../lib/publishErrors'
import type { Chapter, ContentStatus, CourseTree, KnowledgePoint, Section } from '../../types'
import { ArticleDrawer } from './ArticleDrawer'
import { CaseStocksDrawer } from './CaseStocksDrawer'
import { ConceptsDrawer } from './ConceptsDrawer'
import { FiguresDrawer } from './FiguresDrawer'
import { QuizDrawer } from './QuizDrawer'
import { ReadinessCard } from './ReadinessCard'
import { SectionDrawer } from './SectionDrawer'
import { SectionsList } from './SectionsList'

interface CourseInfoForm {
  title: string
  status: ContentStatus
}

interface NameForm {
  title: string
  position?: number
}

interface CreateForm extends NameForm {
  id: string
}

type EditableChapter = { mode: 'chapter'; chapter: Chapter }
type EditablePoint = { mode: 'point'; point: KnowledgePoint }

export function CourseEditor({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [form] = Form.useForm<CourseInfoForm>()
  const [articleChapter, setArticleChapter] = useState<Chapter | null>(null)
  const [quizChapter, setQuizChapter] = useState<Chapter | null>(null)
  const [figuresChapter, setFiguresChapter] = useState<Chapter | null>(null)
  const [chapterModal, setChapterModal] = useState(false)
  const [pointModal, setPointModal] = useState<{ chapterId: string } | null>(null)
  const [rename, setRename] = useState<EditableChapter | EditablePoint | null>(null)
  const [editingSection, setEditingSection] = useState<Section | null>(null)
  const [caseStockSection, setCaseStockSection] = useState<Section | null>(null)
  const [conceptsOpen, setConceptsOpen] = useState(false)
  const [nameForm] = Form.useForm<NameForm>()

  /** 签批与发布限 operator/admin——producer 只产内容，按钮直接不给他看。 */
  const canOperate = user?.role === 'admin' || user?.role === 'operator'
  /** 看板与生产端能力对非学员开放。 */
  const canSeeBoard = user !== null && user.role !== 'student'
  /** 内容编辑限 operator/admin/producer；学员看不到编辑入口。 */
  const canEditContent = canSeeBoard

  const tree = useQuery({ queryKey: qk.course(courseId), queryFn: () => getCourseTree(courseId) })
  const approvals = useQuery({
    queryKey: qk.approvals(courseId),
    queryFn: () => listCourseApprovals(courseId),
  })
  const readiness = useQuery({
    queryKey: qk.readiness(courseId),
    queryFn: () => getCourseReadiness(courseId),
  })
  const finalApproval = approvals.data?.find(item => item.gate === 'final')

  /** 发布按钮的禁用理由：未过的门禁逐条说清，避免点了才报 409。 */
  const blockingGates = (readiness.data?.gates ?? []).filter(gate => gate.status !== 'pass')
  const publishBlockReason = blockingGates.length === 0
    ? undefined
    : blockingGates.map(gate => `${gate.label}：${gate.summary}`).join('；')
  const signBlockReason = readiness.data !== undefined
    && readiness.data.approvedFingerprint !== null
    && readiness.data.approvedFingerprint === readiness.data.fingerprint
    ? '当前内容已签批且未变更，无需重复签批'
    : undefined

  useEffect(() => {
    if (tree.data === undefined) return
    form.setFieldsValue({ title: tree.data.course.title, status: tree.data.course.status })
  }, [form, tree.data])

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.course(courseId) }),
      queryClient.invalidateQueries({ queryKey: qk.courses }),
      queryClient.invalidateQueries({ queryKey: qk.readiness(courseId) }),
    ])
  }

  const saveCourse = useMutation({
    mutationFn: (values: CourseInfoForm) => patchCourse(courseId, values),
    onSuccess: async () => {
      await invalidate()
      void message.success('课程信息已保存')
    },
  })

  const rebuild = useMutation({
    mutationFn: () => reindex(courseId),
    onSuccess: embedded => {
      void message.success(`索引已重建，共向量化 ${embedded} 个片段`)
    },
  })

  const publish = useMutation({
    mutationFn: () => publishCourse(courseId),
    onSuccess: async result => {
      await invalidate()
      modal.success({
        title: '发布完成',
        content: `已发布 ${result.counts.chapters} 章、${result.counts.chapterArticles} 篇教材、`
          + `${result.counts.figures} 张图示、${result.counts.segments} 个片段；`
          + `${result.indexed ? `索引已更新（${result.embedded} 条）` : '索引未更新'}。`,
      })
    },
    onError: error => void message.error(publishErrorText(error)),
  })

  /** 签批 = 对当前课程内容指纹签名；内容再变更即 approval_stale，须重签。 */
  const sign = useMutation({
    mutationFn: () => approveCourse(courseId, 'final'),
    onSuccess: async approval => {
      await queryClient.invalidateQueries({ queryKey: qk.approvals(courseId) })
      await queryClient.invalidateQueries({ queryKey: qk.readiness(courseId) })
      void message.success(`终审已签批（指纹 ${approval.digest.slice(0, 16)}）：此后请勿再改动课程内容`)
    },
    onError: error => void message.error(approvalErrorText(error)),
  })

  const addChapter = useMutation({
    mutationFn: (values: CreateForm) => createChapter(courseId, {
      chapterId: values.id,
      title: values.title,
      ...(values.position === undefined ? {} : { position: values.position }),
    }),
    onSuccess: async () => {
      await invalidate()
      setChapterModal(false)
      void message.success('章节已创建')
    },
  })

  const addPoint = useMutation({
    mutationFn: ({ chapterId, values }: { chapterId: string; values: CreateForm }) => createKnowledgePoint(
      courseId,
      chapterId,
      {
        knowledgePointId: values.id,
        title: values.title,
        ...(values.position === undefined ? {} : { position: values.position }),
      },
    ),
    onSuccess: async () => {
      await invalidate()
      setPointModal(null)
      void message.success('知识点已创建')
    },
  })

  const renameItem = useMutation({
    mutationFn: async () => {
      const values = await nameForm.validateFields()
      if (rename === null) return
      if (rename.mode === 'chapter') {
        await patchChapter(courseId, rename.chapter.chapterId, {
          title: values.title,
          ...(values.position === undefined ? {} : { position: values.position }),
        })
        return
      }
      await patchKnowledgePoint(rename.point.knowledgePointId, {
        title: values.title,
        ...(values.position === undefined ? {} : { position: values.position }),
      })
    },
    onSuccess: async () => {
      await invalidate()
      setRename(null)
      void message.success('已更新')
    },
  })

  const confirmPublish = (): void => {
    modal.confirm({
      title: '发布课程？',
      content: '发布后所有草稿文章与片段将对外可见，并触发检索索引重建。',
      okText: '发布',
      cancelText: '取消',
      onOk: () => publish.mutateAsync().then(() => undefined),
    })
  }

  const confirmSign = (): void => {
    modal.confirm({
      title: '签批终审？',
      content: '签批 = 对当前课程内容指纹签名。签批后若再改动教材、课件、图示或案例股，'
        + '发布会被拦下（内容指纹不符），须重新签批。',
      okText: '签批',
      cancelText: '取消',
      onOk: () => sign.mutateAsync().then(() => undefined),
    })
  }

  if (tree.isLoading) return <div className="page-loading"><Spin /></div>
  if (tree.isError || tree.data === undefined) {
    return <Card><Empty description="课程不存在或加载失败" /></Card>
  }

  const data: CourseTree = tree.data

  return (
    <div className="course-editor">
      <Card
        title="课程信息"
        extra={
          <Space wrap>
            <Tooltip title="重新生成该课程全部片段的向量索引">
              <Button icon={<DatabaseOutlined />} loading={rebuild.isPending} onClick={() => rebuild.mutate()}>
                重建向量
              </Button>
            </Tooltip>
            {canSeeBoard ? (
              <Tooltip title="九步生产进度、产出与评审结论">
                <Button icon={<ProjectOutlined />} onClick={() => navigate(`/courses/${courseId}/board`)}>
                  生产看板
                </Button>
              </Tooltip>
            ) : null}
            {finalApproval === undefined ? (
              <Tag bordered={false}>未签批</Tag>
            ) : (
              <Tooltip title={`内容指纹 ${finalApproval.digest.slice(0, 16)}｜签批于 ${finalApproval.approvedAt}`}>
                <Tag bordered={false} color="green">终审已签批</Tag>
              </Tooltip>
            )}
            {canOperate ? (
              <>
                <Tooltip title={signBlockReason ?? '签批 = 对当前课程内容指纹签名（发布前置门禁，限 operator/admin）'}>
                  <span>
                    <Button
                      icon={<SafetyCertificateOutlined />}
                      loading={sign.isPending}
                      disabled={signBlockReason !== undefined}
                      onClick={confirmSign}
                    >
                      签批终审
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={publishBlockReason ?? '发布草稿内容并重建检索索引（限 operator/admin）'}>
                  <span>
                    <Button
                      type="primary"
                      icon={<RocketOutlined />}
                      loading={publish.isPending}
                      disabled={publishBlockReason !== undefined}
                      onClick={confirmPublish}
                    >
                      发布课程
                    </Button>
                  </span>
                </Tooltip>
              </>
            ) : null}
          </Space>
        }
      >
        <Form<CourseInfoForm> form={form} layout="inline" onFinish={values => saveCourse.mutate(values)}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入课程标题' }]}>
            <Input style={{ width: 320 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              style={{ width: 120 }}
              options={[
                { value: 'draft', label: '草稿' },
                { value: 'published', label: '已发布' },
                { value: 'archived', label: '已归档' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" loading={saveCourse.isPending}>保存</Button>
          </Form.Item>
        </Form>
      </Card>

      <ReadinessCard courseId={courseId} />

      <Card
        title="课程结构"
        extra={
          <Space wrap>
            {canEditContent ? (
              <Tooltip title="术语别名、定义与归档（改动进内容指纹）">
                <Button icon={<BookOutlined />} onClick={() => setConceptsOpen(true)}>
                  课程术语
                </Button>
              </Tooltip>
            ) : null}
            <Button icon={<PlusOutlined />} onClick={() => setChapterModal(true)}>新增章节</Button>
          </Space>
        }
      >
        {data.chapters.length === 0 ? (
          <Empty description="还没有章节，先创建一个章节。" />
        ) : (
          <Collapse
            accordion={false}
            items={data.chapters.map((chapter, index) => ({
              key: chapter.chapterId,
              label: (
                <Space wrap>
                  <Typography.Text strong>{chapter.title}</Typography.Text>
                  <Tag bordered={false}>{chapter.chapterId}</Tag>
                  {chapter.article === null ? (
                    <Tag bordered={false}>无教材</Tag>
                  ) : (
                    <>
                      <StatusTag value={chapter.article.status} />
                      <Typography.Text type="secondary">v{chapter.article.version}</Typography.Text>
                    </>
                  )}
                  {chapter.quiz === null ? (
                    <Tag bordered={false}>无题库</Tag>
                  ) : (
                    <>
                      <StatusTag value={chapter.quiz.status} />
                      <Typography.Text type="secondary">题库 v{chapter.quiz.version}</Typography.Text>
                    </>
                  )}
                  <Typography.Text type="secondary">{chapter.figureCount} 张图示</Typography.Text>
                  <Typography.Text type="secondary">{chapter.knowledgePoints.length} 个知识点</Typography.Text>
                </Space>
              ),
              extra: (
                <Space onClick={event => event.stopPropagation()}>
                  <Button
                    type="text"
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() => setArticleChapter(chapter)}
                  >
                    教材
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<QuestionCircleOutlined />}
                    onClick={() => setQuizChapter(chapter)}
                  >
                    测验
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<PictureOutlined />}
                    onClick={() => setFiguresChapter(chapter)}
                  >
                    图示
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openRename({ mode: 'chapter', chapter })}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setPointModal({ chapterId: chapter.chapterId })}
                  >
                    知识点
                  </Button>
                </Space>
              ),
              children: (
                <>
                  {chapter.knowledgePoints.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该章节暂无知识点" />
                  ) : (
                    <>
                      <List
                        size="small"
                        dataSource={chapter.knowledgePoints}
                        renderItem={point => (
                          <List.Item
                            actions={[
                              <Button
                                key="rename"
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => openRename({ mode: 'point', point })}
                              />,
                            ]}
                          >
                            <List.Item.Meta
                              title={<span>{point.title}</span>}
                              description={
                                <Space size={8}>
                                  <Typography.Text type="secondary">{point.knowledgePointId}</Typography.Text>
                                  <Typography.Text type="secondary">{point.segmentCount} 个片段</Typography.Text>
                                </Space>
                              }
                            />
                          </List.Item>
                        )}
                      />
                      <div className="section-list-divider"><Typography.Text type="secondary">以上为本章知识点</Typography.Text></div>
                    </>
                  )}
                  <SectionsList
                    courseId={courseId}
                    chapter={chapter}
                    canEdit={canEditContent}
                    onEditSection={setEditingSection}
                    onEditCaseStocks={setCaseStockSection}
                  />
                </>
              ),
            }))}
            defaultActiveKey={data.chapters[0] === undefined ? [] : [data.chapters[0].chapterId]}
          />
        )}
      </Card>

      <ArticleDrawer
        courseId={courseId}
        chapter={articleChapter}
        open={articleChapter !== null}
        onClose={() => setArticleChapter(null)}
      />

      <QuizDrawer
        courseId={courseId}
        chapter={quizChapter}
        open={quizChapter !== null}
        onClose={() => setQuizChapter(null)}
      />

      <FiguresDrawer
        courseId={courseId}
        chapter={figuresChapter}
        open={figuresChapter !== null}
        onClose={() => setFiguresChapter(null)}
      />

      <SectionDrawer
        courseId={courseId}
        section={editingSection}
        open={editingSection !== null}
        onClose={() => setEditingSection(null)}
      />

      <CaseStocksDrawer
        courseId={courseId}
        sectionId={caseStockSection?.sectionId ?? null}
        sectionTitle={caseStockSection?.title}
        open={caseStockSection !== null}
        onClose={() => setCaseStockSection(null)}
      />

      <ConceptsDrawer
        courseId={courseId}
        open={conceptsOpen}
        onClose={() => setConceptsOpen(false)}
      />

      <CreateModal
        open={chapterModal}
        title="新增章节"
        idLabel="章节 ID"
        onCancel={() => setChapterModal(false)}
        submitting={addChapter.isPending}
        onSubmit={values => addChapter.mutate(values)}
      />

      <CreateModal
        open={pointModal !== null}
        title="新增知识点"
        idLabel="知识点 ID"
        onCancel={() => setPointModal(null)}
        submitting={addPoint.isPending}
        onSubmit={values => {
          if (pointModal === null) return
          addPoint.mutate({ chapterId: pointModal.chapterId, values })
        }}
      />

      <Modal
        open={rename !== null}
        title={rename?.mode === 'chapter' ? '编辑章节' : '编辑知识点'}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameItem.isPending}
        onCancel={() => setRename(null)}
        onOk={() => renameItem.mutate()}
        destroyOnHidden
      >
        <Form<NameForm>
          form={nameForm}
          layout="vertical"
          preserve={false}
          initialValues={{
            title: rename?.mode === 'chapter' ? rename.chapter.title : rename?.point.title,
            position: rename?.mode === 'chapter' ? rename.chapter.position : rename?.point.position,
          }}
        >
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="position" label="排序位置">
            <InputNumber min={1} placeholder="可选，从 1 开始" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )

  function openRename(target: EditableChapter | EditablePoint): void {
    setRename(target)
  }
}

function CreateModal({
  open,
  title,
  idLabel,
  submitting,
  onCancel,
  onSubmit,
}: {
  open: boolean
  title: string
  idLabel: string
  submitting: boolean
  onCancel: () => void
  onSubmit: (values: CreateForm) => void
}) {
  const [form] = Form.useForm<CreateForm>()
  return (
    <Modal
      open={open}
      title={title}
      okText="创建"
      cancelText="取消"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={() => {
        void form.validateFields().then(values => onSubmit(values))
      }}
      destroyOnHidden
    >
      <Form<CreateForm> form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="id"
          label={idLabel}
          rules={[
            { required: true, message: '请输入 ID' },
            { pattern: /^[A-Za-z0-9._-]{1,64}$/, message: '仅支持字母、数字、点、下划线与连字符，最长 64 位' },
          ]}
        >
          <Input placeholder="例如 ch-01 或 kp-01" />
        </Form.Item>
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="position" label="排序位置">
          <InputNumber min={1} placeholder="可选，从 1 开始" style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
