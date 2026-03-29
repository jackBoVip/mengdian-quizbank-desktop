import { useEffect, useMemo, useState } from 'react';
import {
  DeleteOutlined,
  ExportOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Col,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ExamTemplate, Question } from '@shared/types';
import { QUESTION_TYPE_LABELS } from '@shared/types';
import { api } from '@renderer/api/client';
import { QuestionEditorDrawer } from '@renderer/components/QuestionEditorDrawer';
import { useAppStore } from '@renderer/store/appStore';

const questionColumns: ColumnsType<Question> = [
  { title: '题号', dataIndex: 'sourceNo', width: 80, fixed: 'left' },
  { title: '题型', render: (_, record) => QUESTION_TYPE_LABELS[record.type], width: 100 },
  { title: '章节', dataIndex: 'section', width: 120 },
  {
    title: '题干',
    dataIndex: 'stem',
    ellipsis: true,
    render: (value: string) => <span title={value}>{value}</span>
  },
  {
    title: '答案',
    render: (_, record) => record.answers.join(record.type === 'fill_blank' ? ' / ' : ' ')
  },
  {
    title: '标签',
    render: (_, record) => (
      <Space wrap>
        {record.tags.map((tag) => (
          <Tag key={`${record.id}-${tag}`}>{tag}</Tag>
        ))}
      </Space>
    )
  },
  {
    title: '收藏',
    render: (_, record) => (record.isFavorite ? <Tag color="magenta">已收藏</Tag> : <Tag>未收藏</Tag>),
    width: 110
  }
];

const rulesSummary = (template: ExamTemplate): string =>
  template.rules.map((rule) => `${QUESTION_TYPE_LABELS[rule.questionType]} ${rule.count}题 x ${rule.score}分`).join('；');

export function LibrariesPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [messageApi, contextHolder] = message.useMessage();
  const libraries = useAppStore((state) => state.libraries);
  const selectedLibrary = useAppStore((state) => state.selectedLibrary);
  const selectedLibraryId = useAppStore((state) => state.selectedLibraryId);
  const libraryQuestions = useAppStore((state) => state.libraryQuestions);
  const libraryProgress = useAppStore((state) => state.libraryProgress);
  const refreshLibraries = useAppStore((state) => state.refreshLibraries);
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);
  const loadLibrary = useAppStore((state) => state.loadLibrary);
  const loadLibraryQuestions = useAppStore((state) => state.loadLibraryQuestions);
  const updateQuestion = useAppStore((state) => state.updateQuestion);
  const bulkUpdateQuestions = useAppStore((state) => state.bulkUpdateQuestions);
  const startPractice = useAppStore((state) => state.startPractice);
  const startExam = useAppStore((state) => state.startExam);
  const setActiveSession = useAppStore((state) => state.setActiveSession);

  const [searchForm] = Form.useForm();
  const [bulkForm] = Form.useForm();
  const [practiceForm] = Form.useForm();
  const [templateForm] = Form.useForm();
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [selectedRows, setSelectedRows] = useState<React.Key[]>([]);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ExamTemplate | null>(null);

  const activeLibraryId = useMemo(() => {
    const fromState = (location.state as { libraryId?: string } | null)?.libraryId;
    return fromState ?? selectedLibraryId ?? libraries[0]?.id ?? null;
  }, [libraries, location.state, selectedLibraryId]);

  useEffect(() => {
    void refreshLibraries();
  }, [refreshLibraries]);

  useEffect(() => {
    if (activeLibraryId) {
      void loadLibrary(activeLibraryId);
    }
  }, [activeLibraryId, loadLibrary]);

  const handleRefreshQuestions = async (): Promise<void> => {
    if (!selectedLibrary) return;
    const values = searchForm.getFieldsValue();
    await loadLibraryQuestions({
      libraryId: selectedLibrary.id,
      search: values.search,
      type: values.type,
      section: values.section,
      tag: values.tag,
      favoritesOnly: values.favoritesOnly
    });
  };

  const handleDeleteLibrary = async (): Promise<void> => {
    if (!selectedLibrary) return;
    Modal.confirm({
      title: '删除当前题库？',
      content: `题库“${selectedLibrary.name}”及其练习记录、考试模板会一起删除。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.library.delete(selectedLibrary.id);
        await Promise.all([refreshLibraries(), refreshDashboard()]);
        messageApi.success('题库已删除。');
      }
    });
  };

  const handleExportPack = async (): Promise<void> => {
    if (!selectedLibrary) return;
    const result = await api.library.exportPack(selectedLibrary.id);
    if (result.canceled) return;
    messageApi.success(`题库包已导出：${result.filePath}`);
  };

  const templateColumns: ColumnsType<ExamTemplate> = [
    { title: '模板名称', dataIndex: 'name' },
    { title: '时长', render: (_, record) => `${record.durationMinutes} 分钟`, width: 100 },
    { title: '总分', dataIndex: 'totalScore', width: 80 },
    { title: '及格线', dataIndex: 'passScore', width: 100 },
    { title: '规则', render: (_, record) => rulesSummary(record) },
    {
      title: '操作',
      width: 260,
      render: (_, record) => (
        <Space wrap>
          <Button
            type="link"
            onClick={async () => {
              const session = await startExam({
                libraryId: record.libraryId,
                examTemplateId: record.id
              });
              setActiveSession(session);
              navigate(`/session/${session.id}`);
            }}
          >
            开始考试
          </Button>
          <Button
            type="link"
            onClick={() => {
              setEditingTemplate(record);
              templateForm.setFieldsValue({
                name: record.name,
                durationMinutes: record.durationMinutes,
                passScore: record.passScore,
                randomize: record.randomize,
                scopeSections: record.scope.sections,
                scopeTags: record.scope.tags,
                rules: record.rules
              });
              setTemplateOpen(true);
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            danger
            onClick={async () => {
              await api.exam.delete(record.id);
              if (selectedLibrary) {
                await loadLibrary(selectedLibrary.id);
              }
              messageApi.success('考试模板已删除。');
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const heroMetrics = selectedLibrary
    ? [
        { label: '题量规模', value: `${selectedLibrary.questionCount} 题`, tone: 'emerald' },
        { label: '章节覆盖', value: `${selectedLibrary.sectionCount} 章`, tone: 'teal' },
        { label: '训练成效', value: `${(libraryProgress?.accuracy ?? 0).toFixed(1)}%`, tone: 'gold' },
        { label: '错题 / 收藏', value: `${libraryProgress?.wrongCount ?? 0} / ${libraryProgress?.favoritesCount ?? 0}`, tone: 'ink' }
      ]
    : [];

  return (
    <>
      {contextHolder}
      <div className="page-view libraries-view">
        <div className="page-header libraries-header">
          <div className="libraries-header__copy">
            <h2>题库管理</h2>
            <p>用一个控制台管理题库资产、训练数据和考试模板，从当前题库直接发起练习或模拟考试。</p>
          </div>
          <Space className="libraries-header__actions">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void Promise.all([refreshLibraries(), selectedLibrary ? loadLibrary(selectedLibrary.id) : Promise.resolve()])}
            >
              刷新
            </Button>
          </Space>
        </div>

        <div className="libraries-shell">
          <aside className="page-panel libraries-rail">
            <div className="libraries-rail__header">
              <div>
                <span className="libraries-rail__eyebrow">题库资产</span>
                <h3>题库清单</h3>
              </div>
              <Tag className="libraries-rail__count">{libraries.length} 套</Tag>
            </div>
            <div className="libraries-rail__list">
              {libraries.length > 0 ? (
                libraries.map((library) => {
                  const active = library.id === activeLibraryId;
                  return (
                    <button
                      key={library.id}
                      type="button"
                      className={`libraries-rail__item${active ? ' libraries-rail__item--active' : ''}`}
                      onClick={() => void loadLibrary(library.id)}
                    >
                      <div className="libraries-rail__item-head">
                        <strong>{library.name}</strong>
                        {active ? <Tag className="libraries-rail__active-tag">当前</Tag> : null}
                      </div>
                      <p>{library.description || '未填写描述'}</p>
                      <div className="libraries-rail__item-meta">
                        <span>{library.questionCount} 题</span>
                        <span>{library.sectionCount} 章</span>
                        <span>{library.templateCount} 模板</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <Empty description="暂无题库，请先导入一套。" />
              )}
            </div>
            <div className="libraries-rail__footer">
              <span>当前支持 DOCX / TXT / XLSX 导入</span>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate('/import')}>
                导入新题库
              </Button>
            </div>
          </aside>

          <section className="libraries-main">
            {selectedLibrary ? (
              <>
                <section className="page-panel libraries-hero">
                  <div className="libraries-hero__content">
                    <div className="libraries-hero__copy">
                      <div className="libraries-hero__title-group">
                        <h3>{selectedLibrary.name}</h3>
                        <p>{selectedLibrary.description || '当前题库尚未填写描述，可继续补充说明、配置模板并组织练习。'}</p>
                      </div>
                    </div>
                    <div className="libraries-hero__action-card">
                      <div className="libraries-hero__actions">
                        <Button icon={<ExportOutlined />} onClick={() => void handleExportPack()}>
                          导出题库包
                        </Button>
                        <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setPracticeOpen(true)}>
                          开始练习
                        </Button>
                        <Button
                          disabled={selectedLibrary.examTemplates.length === 0}
                          onClick={async () => {
                            const template = selectedLibrary.examTemplates[0];
                            if (!template) return;
                            const session = await startExam({
                              libraryId: template.libraryId,
                              examTemplateId: template.id
                            });
                            setActiveSession(session);
                            navigate(`/session/${session.id}`);
                          }}
                        >
                          模拟考试
                        </Button>
                        <Button danger icon={<DeleteOutlined />} onClick={() => void handleDeleteLibrary()}>
                          删除题库
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="libraries-hero__metrics">
                    {heroMetrics.map((metric) => (
                      <div key={metric.label} className={`libraries-hero__metric libraries-hero__metric--${metric.tone}`}>
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <div className="libraries-workspace">
                  <Tabs
                    className="libraries-tabs"
                    items={[
                      {
                        key: 'questions',
                        label: '题目管理',
                        children: (
                          <div className="libraries-pane">
                            <Card className="page-panel libraries-toolbar-panel" title="搜索与批量修改">
                              <div className="libraries-toolbar-stack">
                                <section className="libraries-toolbar-section">
                                  <div className="libraries-toolbar-section__header">
                                    <div>
                                      <h4>筛选条件</h4>
                                      <p>按题干、章节、标签和收藏状态快速定位题目，减少表格内来回翻找。</p>
                                    </div>
                                  </div>
                                  <Form
                                    form={searchForm}
                                    className="libraries-toolbar-form"
                                    layout="vertical"
                                    onFinish={() => {
                                      void handleRefreshQuestions();
                                    }}
                                  >
                                    <Form.Item label="搜索关键词" name="search" className="libraries-toolbar-form__item--wide">
                                      <Input placeholder="搜题干 / 章节 / 答案" />
                                    </Form.Item>
                                    <Form.Item label="题型" name="type">
                                      <Select
                                        allowClear
                                        options={Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                                      />
                                    </Form.Item>
                                    <Form.Item label="章节" name="section">
                                      <Select allowClear options={selectedLibrary.sections} />
                                    </Form.Item>
                                    <Form.Item label="标签" name="tag">
                                      <Select allowClear options={selectedLibrary.tags} />
                                    </Form.Item>
                                    <Form.Item
                                      label="收藏状态"
                                      name="favoritesOnly"
                                      valuePropName="checked"
                                      className="libraries-toolbar-form__item--check"
                                    >
                                      <Checkbox>只看收藏</Checkbox>
                                    </Form.Item>
                                    <Form.Item className="libraries-toolbar-form__item--action">
                                      <Button type="primary" htmlType="submit">
                                        查询
                                      </Button>
                                    </Form.Item>
                                  </Form>
                                </section>

                                <section className="libraries-toolbar-section libraries-toolbar-section--muted">
                                  <div className="libraries-toolbar-section__header">
                                    <div>
                                      <h4>批量修改</h4>
                                      <p>统一调整已勾选题目的题型、章节和标签，适合导入后的集中整理。</p>
                                    </div>
                                    <span className="libraries-toolbar-section__meta">已选 {selectedRows.length} 题</span>
                                  </div>
                                  <Form
                                    form={bulkForm}
                                    className="libraries-toolbar-form"
                                    layout="vertical"
                                    onFinish={async (values) => {
                                      if (!selectedRows.length) {
                                        messageApi.warning('请先选择要批量修改的题目。');
                                        return;
                                      }
                                      await bulkUpdateQuestions(selectedLibrary.id, selectedRows as string[], {
                                        type: values.type,
                                        section: values.section,
                                        tags: values.tags
                                          ? String(values.tags)
                                              .split(/[，,;；、]/)
                                              .map((item) => item.trim())
                                              .filter(Boolean)
                                          : undefined
                                      });
                                      messageApi.success(`已批量更新 ${selectedRows.length} 题。`);
                                    }}
                                  >
                                    <Form.Item label="批量改题型" name="type">
                                      <Select
                                        allowClear
                                        options={Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                                      />
                                    </Form.Item>
                                    <Form.Item label="批量改章节" name="section">
                                      <Input />
                                    </Form.Item>
                                    <Form.Item label="批量改标签" name="tags" className="libraries-toolbar-form__item--wide">
                                      <Input />
                                    </Form.Item>
                                    <Form.Item className="libraries-toolbar-form__item--action">
                                      <Button htmlType="submit" disabled={selectedRows.length === 0}>
                                        批量保存
                                      </Button>
                                    </Form.Item>
                                  </Form>
                                </section>
                              </div>
                            </Card>

                            <Card
                              className="page-panel libraries-table-panel"
                              title="题目列表"
                              extra={<span className="libraries-table-panel__meta">当前载入 {libraryQuestions.length} 题，已选 {selectedRows.length} 题</span>}
                            >
                              <div className="libraries-table-panel__body">
                                <Table
                                  rowKey="id"
                                  dataSource={libraryQuestions}
                                  columns={questionColumns}
                                  rowSelection={{
                                    selectedRowKeys: selectedRows,
                                    onChange: setSelectedRows
                                  }}
                                  scroll={{ x: 1380, y: 420 }}
                                  pagination={{ pageSize: 10 }}
                                  onRow={(record) => ({
                                    onClick: () => setEditingQuestion(record)
                                  })}
                                />
                              </div>
                            </Card>
                          </div>
                        )
                      },
                      {
                        key: 'exam',
                        label: '考试模板',
                        children: (
                          <div className="libraries-pane">
                            <section className="libraries-template-strip">
                              <div className="libraries-template-strip__card">
                                <span>模板数量</span>
                                <strong>{selectedLibrary.examTemplates.length}</strong>
                              </div>
                              <div className="libraries-template-strip__card">
                                <span>默认时长</span>
                                <strong>{selectedLibrary.examTemplates[0]?.durationMinutes ?? 60} 分钟</strong>
                              </div>
                              <div className="libraries-template-strip__card">
                                <span>默认及格线</span>
                                <strong>{selectedLibrary.examTemplates[0]?.passScore ?? Math.ceil(selectedLibrary.questionCount * 0.8)} 分</strong>
                              </div>
                            </section>
                            <Card
                              className="page-panel libraries-template-panel"
                              title="模板配置"
                              extra={
                                <Button
                                  icon={<PlusOutlined />}
                                  onClick={() => {
                                    setEditingTemplate(null);
                                    templateForm.setFieldsValue({
                                      name: '新考试模板',
                                      durationMinutes: 60,
                                      passScore: Math.ceil(selectedLibrary.questionCount * 0.8),
                                      randomize: true,
                                      rules: [
                                        { questionType: 'single', count: 0, score: 1 },
                                        { questionType: 'multiple', count: 0, score: 1 },
                                        { questionType: 'fill_blank', count: 0, score: 1 },
                                        { questionType: 'true_false', count: 0, score: 1 }
                                      ],
                                      scopeSections: [],
                                      scopeTags: []
                                    });
                                    setTemplateOpen(true);
                                  }}
                                >
                                  新建模板
                                </Button>
                              }
                            >
                              <Table rowKey="id" dataSource={selectedLibrary.examTemplates} columns={templateColumns} pagination={false} />
                            </Card>
                          </div>
                        )
                      }
                    ]}
                  />
                </div>
              </>
            ) : (
              <Card className="page-panel libraries-empty-panel">
                <Empty description="请选择左侧题库，或先去导入题库。" />
              </Card>
            )}
          </section>
        </div>
      </div>

      <QuestionEditorDrawer
        open={Boolean(editingQuestion)}
        value={editingQuestion}
        title={editingQuestion ? `编辑题目 ${editingQuestion.sourceNo}` : '编辑题目'}
        onClose={() => setEditingQuestion(null)}
        onSubmit={async (value) => {
          const next = await updateQuestion(value as Question);
          setEditingQuestion(next);
          messageApi.success('题目已更新。');
        }}
      />

      <Modal
        open={practiceOpen}
        title="开始练习"
        okText="开始"
        onCancel={() => setPracticeOpen(false)}
        onOk={() => practiceForm.submit()}
      >
        <Form
          form={practiceForm}
          layout="vertical"
          initialValues={{ order: 'sequential', questionTypes: undefined, favoritesOnly: false, wrongOnly: false, limit: undefined }}
          onFinish={async (values) => {
            if (!selectedLibrary) return;
            const session = await startPractice({
              libraryId: selectedLibrary.id,
              title: `${selectedLibrary.name} 练习`,
              order: values.order,
              questionTypes: values.questionTypes,
              sections: values.sections,
              tags: values.tags,
              favoritesOnly: values.favoritesOnly,
              wrongOnly: values.wrongOnly,
              limit: values.limit
            });
            setActiveSession(session);
            setPracticeOpen(false);
            navigate(`/session/${session.id}`);
          }}
        >
          <Form.Item label="题目顺序" name="order">
            <Select
              options={[
                { label: '顺序练习', value: 'sequential' },
                { label: '随机练习', value: 'random' }
              ]}
            />
          </Form.Item>
          <Form.Item label="题型范围" name="questionTypes">
            <Select mode="multiple" allowClear options={Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="章节范围" name="sections">
            <Select mode="multiple" allowClear options={selectedLibrary?.sections ?? []} />
          </Form.Item>
          <Form.Item label="标签范围" name="tags">
            <Select mode="multiple" allowClear options={selectedLibrary?.tags ?? []} />
          </Form.Item>
          <Form.Item label="题量限制" name="limit">
            <InputNumber style={{ width: '100%' }} min={1} max={selectedLibrary?.questionCount ?? 9999} />
          </Form.Item>
          <Form.Item name="favoritesOnly" valuePropName="checked">
            <Checkbox>只练收藏题</Checkbox>
          </Form.Item>
          <Form.Item name="wrongOnly" valuePropName="checked">
            <Checkbox>只练错题</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={templateOpen}
        title={editingTemplate ? '编辑考试模板' : '新建考试模板'}
        okText="保存模板"
        width={760}
        onCancel={() => setTemplateOpen(false)}
        onOk={() => templateForm.submit()}
      >
        <Form
          form={templateForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!selectedLibrary) return;
            await api.exam.upsert({
              libraryId: selectedLibrary.id,
              template: {
                ...(editingTemplate ? { id: editingTemplate.id } : {}),
                libraryId: selectedLibrary.id,
                name: values.name,
                durationMinutes: values.durationMinutes,
                passScore: values.passScore,
                randomize: values.randomize,
                rules: (values.rules ?? []).filter((item: { count?: number }) => Number(item.count) > 0),
                scope: {
                  sections: values.scopeSections,
                  tags: values.scopeTags
                }
              }
            });
            await loadLibrary(selectedLibrary.id);
            setTemplateOpen(false);
            messageApi.success('考试模板已保存。');
          }}
        >
          <Form.Item label="模板名称" name="name" rules={[{ required: true, message: '请填写模板名称' }]}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="时长（分钟）" name="durationMinutes" rules={[{ required: true, message: '请填写时长' }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="及格线" name="passScore" rules={[{ required: true, message: '请填写及格线' }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="抽题顺序" name="randomize" valuePropName="checked">
                <Checkbox>随机抽题</Checkbox>
              </Form.Item>
            </Col>
          </Row>
          <Form.List name="rules">
            {(fields) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Row gutter={12} key={field.key}>
                    <Col span={10}>
                      <Form.Item {...field} label="题型" name={[field.name, 'questionType']}>
                        <Select options={Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
                      </Form.Item>
                    </Col>
                    <Col span={7}>
                      <Form.Item {...field} label="题量" name={[field.name, 'count']}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={7}>
                      <Form.Item {...field} label="每题分值" name={[field.name, 'score']}>
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                ))}
              </Space>
            )}
          </Form.List>
          <Form.Item label="限定章节" name="scopeSections">
            <Select mode="multiple" allowClear options={selectedLibrary?.sections ?? []} />
          </Form.Item>
          <Form.Item label="限定标签" name="scopeTags">
            <Select mode="multiple" allowClear options={selectedLibrary?.tags ?? []} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
