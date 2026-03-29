import { useEffect, useMemo, useRef, useState } from 'react';
import { FilterOutlined, SaveOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import type { QuestionDraft } from '@shared/types';
import { QUESTION_TYPE_LABELS } from '@shared/types';
import { QuestionEditorDrawer } from '@renderer/components/QuestionEditorDrawer';
import { useAppStore } from '@renderer/store/appStore';

const REVIEW_TABLE_SCROLL_X = 1440;

const renderEllipsisCell = (value: string, className = 'review-cell-ellipsis'): JSX.Element => (
  <span className={className} title={value}>
    {value}
  </span>
);

const buildIssueSummary = (draft: QuestionDraft): { text: string; className: string } => {
  if (!draft.issues.length) {
    return { text: '无问题', className: 'review-issue-pill review-issue-pill--ok' };
  }

  const issueText = draft.issues.map((issue) => issue.message).join('；');
  const level =
    draft.issues.some((issue) => issue.level === 'error')
      ? 'danger'
      : draft.issues.some((issue) => issue.level === 'warning')
        ? 'warning'
        : 'info';

  return {
    text: issueText,
    className: `review-issue-pill review-issue-pill--${level}`
  };
};

const columns: ColumnsType<QuestionDraft> = [
  { title: '题号', dataIndex: 'sourceNo', width: 88 },
  { title: '题型', render: (_, record) => QUESTION_TYPE_LABELS[record.type], width: 108 },
  {
    title: '题干',
    dataIndex: 'stem',
    className: 'review-col review-col--stem',
    width: 260,
    render: (value: string) => renderEllipsisCell(value),
    ellipsis: { showTitle: false }
  },
  {
    title: '答案',
    className: 'review-col review-col--answer',
    width: 360,
    render: (_, record) => {
      const answerText = record.answers.join(record.type === 'fill_blank' ? ' / ' : ' ');
      return renderEllipsisCell(answerText);
    },
    ellipsis: { showTitle: false }
  },
  {
    title: '置信度',
    render: (_, record) => `${Math.round(record.confidence * 100)}%`,
    width: 108
  },
  {
    title: '问题',
    className: 'review-col review-col--issue',
    width: 420,
    render: (_, record) => {
      const issue = buildIssueSummary(record);
      return renderEllipsisCell(issue.text, issue.className);
    },
    ellipsis: { showTitle: false }
  }
];

export function ReviewPage(): JSX.Element {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const analysis = useAppStore((state) => state.importAnalysis);
  const updateReviewDraft = useAppStore((state) => state.updateReviewDraft);
  const bulkUpdateReviewDrafts = useAppStore((state) => state.bulkUpdateReviewDrafts);
  const saveReviewedLibrary = useAppStore((state) => state.saveReviewedLibrary);

  const [editing, setEditing] = useState<QuestionDraft | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [issueOnly, setIssueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(320);
  const [bulkForm] = Form.useForm();
  const [saveForm] = Form.useForm();
  const tableHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = tableHostRef.current;
    if (!host) return;

    const updateHeight = (): void => {
      const nextHeight = Math.max(240, host.clientHeight - 112);
      setTableScrollY(nextHeight);
    };

    updateHeight();

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(host);

    return () => observer.disconnect();
  }, []);

  const filteredDrafts = useMemo(() => {
    if (!analysis) return [];
    return analysis.drafts.filter((draft) => {
      if (issueOnly && draft.issues.length === 0) return false;
      if (typeFilter && draft.type !== typeFilter) return false;
      if (search.trim()) {
        const keyword = search.trim();
        return draft.stem.includes(keyword) || draft.answers.join(' ').includes(keyword) || draft.section.includes(keyword);
      }
      return true;
    });
  }, [analysis, issueOnly, search, typeFilter]);

  if (!analysis) {
    return (
      <Card className="page-panel">
        <Empty description="当前没有待校对的导入结果">
          <Button type="primary" onClick={() => navigate('/import')}>
            去导入题库
          </Button>
        </Empty>
      </Card>
    );
  }

  const totalIssues = analysis.drafts.reduce((sum, draft) => sum + draft.issues.length, 0);

  return (
    <>
      {contextHolder}
      <div className="page-view review-view">
        <div className="page-header">
          <div className="review-header__copy">
            <div className="review-header__title-row">
              <h2>题目校对</h2>
              <Space wrap size={10} className="review-header__tags">
                <Tag className="review-status-tag review-status-tag--ink">待校对 {analysis.summary.totalQuestions} 题</Tag>
                <Tag className="review-status-tag review-status-tag--warning">低置信度 {analysis.summary.lowConfidenceCount} 题</Tag>
                <Tag className="review-status-tag review-status-tag--danger">问题条目 {totalIssues} 条</Tag>
                <Tag className="review-status-tag review-status-tag--success">{analysis.format.toUpperCase()}</Tag>
              </Space>
            </div>
            <p title={analysis.sourceName}>源文件：{analysis.sourceName}</p>
          </div>
          <Space>
            <Button icon={<FilterOutlined />} onClick={() => bulkForm.submit()} disabled={selectedRowKeys.length === 0}>
              批量修改所选题目
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => setSaveOpen(true)}>
              发布为题库
            </Button>
          </Space>
        </div>

        <Card className="page-panel review-filter-panel" title="筛选与批量修改">
          <Form
            form={bulkForm}
            layout="inline"
            onFinish={(values) => {
              if (!selectedRowKeys.length) {
                messageApi.warning('请先选择要批量修改的题目。');
                return;
              }
              bulkUpdateReviewDrafts(selectedRowKeys as string[], {
                type: values.type,
                section: values.section,
                tags: values.tags
                  ? String(values.tags)
                      .split(/[，,;；、]/)
                      .map((item) => item.trim())
                      .filter(Boolean)
                  : undefined
              });
              messageApi.success(`已批量更新 ${selectedRowKeys.length} 题。`);
            }}
          >
            <Form.Item label="只看有问题" valuePropName="checked">
              <Switch checked={issueOnly} onChange={setIssueOnly} />
            </Form.Item>
            <Form.Item label="搜索">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜题干/答案/章节" />
            </Form.Item>
            <Form.Item label="题型">
              <Select
                allowClear
                style={{ width: 140 }}
                value={typeFilter}
                onChange={setTypeFilter}
                options={Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
            <Form.Item label="批量改题型" name="type">
              <Select allowClear style={{ width: 140 }} options={Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item label="批量改章节" name="section">
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label="批量改标签" name="tags">
              <Input style={{ width: 220 }} placeholder="多个标签用逗号分隔" />
            </Form.Item>
          </Form>
        </Card>

        <Card className="page-panel review-table-panel" title="题目草稿列表">
          <div className="review-table-host" ref={tableHostRef}>
            <Table
              rowKey="tempId"
              dataSource={filteredDrafts}
              columns={columns}
              tableLayout="fixed"
              scroll={{ x: REVIEW_TABLE_SCROLL_X, y: tableScrollY }}
              rowSelection={{
                columnWidth: 52,
                selectedRowKeys,
                onChange: setSelectedRowKeys
              }}
              onRow={(record) => ({
                onClick: () => setEditing(record)
              })}
              pagination={{ pageSize: 12, showSizeChanger: false }}
            />
          </div>
        </Card>
      </div>

      <QuestionEditorDrawer
        open={Boolean(editing)}
        value={editing}
        title={editing ? `编辑草稿题 ${editing.sourceNo}` : '编辑草稿题'}
        onClose={() => setEditing(null)}
        onSubmit={(nextValue) => {
          const nextDraft = nextValue as QuestionDraft;
          updateReviewDraft(nextDraft.tempId, () => nextDraft);
          setEditing(nextDraft);
          messageApi.success('草稿已更新。');
        }}
      />

      <Modal
        open={saveOpen}
        title="发布为题库"
        okText="确认发布"
        onCancel={() => setSaveOpen(false)}
        onOk={() => saveForm.submit()}
      >
        <Form
          form={saveForm}
          layout="vertical"
          initialValues={{ name: analysis.sourceName.replace(/\.[^.]+$/, ''), description: `由 ${analysis.sourceName} 导入生成` }}
          onFinish={async (values) => {
            try {
              const library = await saveReviewedLibrary({
                name: values.name,
                description: values.description
              });
              setSaveOpen(false);
              messageApi.success('题库已发布。');
              navigate('/libraries', { state: { libraryId: library.id } });
            } catch (error) {
              messageApi.error(error instanceof Error ? error.message : '发布题库失败');
            }
          }}
        >
          <Form.Item label="题库名称" name="name" rules={[{ required: true, message: '请填写题库名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
