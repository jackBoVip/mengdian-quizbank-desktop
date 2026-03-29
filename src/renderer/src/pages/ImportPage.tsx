import { useEffect, useState } from 'react';
import { FileTextOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Space, Steps, Tag, Typography, message } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { IMPORT_FORMAT_LABELS, QUESTION_TYPE_LABELS } from '@shared/types';
import { api } from '@renderer/api/client';
import { useAppStore } from '@renderer/store/appStore';

interface ImportPageLocationState {
  selectedFilePath?: string;
}

export function ImportPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [pending, setPending] = useState(false);
  const analysis = useAppStore((state) => state.importAnalysis);
  const setImportAnalysis = useAppStore((state) => state.setImportAnalysis);

  useEffect(() => {
    const state = location.state as ImportPageLocationState | null;
    if (state?.selectedFilePath) {
      setSelectedFilePath(state.selectedFilePath);
    }
  }, [location.state]);

  const handlePickFile = async (): Promise<void> => {
    try {
      const result = await api.import.pickFile();
      if (!result.canceled && result.filePath) {
        setSelectedFilePath(result.filePath);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法打开文件选择窗口');
    }
  };

  const handleAnalyze = async (): Promise<void> => {
    if (!selectedFilePath) {
      message.warning('请先选择题库文件。');
      return;
    }
    setPending(true);
    try {
      const nextAnalysis = await api.import.analyze(selectedFilePath);
      setImportAnalysis(nextAnalysis);
      message.success(`已解析 ${nextAnalysis.summary.totalQuestions} 道题，进入校对页继续处理。`);
      navigate('/review');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '题库解析失败');
    } finally {
      setPending(false);
    }
  };

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div className="page-header">
        <div>
          <h2>导入题库</h2>
          <p>支持 DOCX、TXT、XLSX。文件会先进入解析与校对流程，确认无误后再发布为正式题库。</p>
        </div>
      </div>

      <Card className="page-panel">
        <Steps
          current={analysis ? 1 : 0}
          items={[
            { title: '选择文件', description: '上传 Word / 文本 / 表格题库' },
            { title: '自动解析', description: '识别题型、选项、答案和章节' },
            { title: '人工校对', description: '修正文档噪音与低置信度题目' },
            { title: '发布题库', description: '生成练习与考试系统' }
          ]}
        />
      </Card>

      <Card className="page-panel">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            选择源文件
          </Typography.Title>
          <Space wrap>
            <Button icon={<UploadOutlined />} onClick={() => void handlePickFile()}>
              选择题库文件
            </Button>
            <Button type="primary" loading={pending} onClick={() => void handleAnalyze()}>
              开始解析
            </Button>
            {analysis ? (
              <Button onClick={() => navigate('/review')}>继续校对当前导入</Button>
            ) : null}
          </Space>
          <Card className="glass-card">
            <Space direction="vertical">
              <span>
                <FileTextOutlined /> 当前文件
              </span>
              <strong>{selectedFilePath || '尚未选择文件'}</strong>
            </Space>
          </Card>
        </Space>
      </Card>

      {analysis ? (
        <Card className="page-panel" title="最近一次解析摘要" extra={<Tag color="green">{IMPORT_FORMAT_LABELS[analysis.format]}</Tag>}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="源文件">{analysis.sourceName}</Descriptions.Item>
            <Descriptions.Item label="题目总数">{analysis.summary.totalQuestions}</Descriptions.Item>
            <Descriptions.Item label="低置信度">{analysis.summary.lowConfidenceCount}</Descriptions.Item>
            <Descriptions.Item label="问题总数">
              {analysis.summary.issueCounts.warning + analysis.summary.issueCounts.error + analysis.summary.issueCounts.info}
            </Descriptions.Item>
            {Object.entries(analysis.summary.byType).map(([type, count]) => (
              <Descriptions.Item key={type} label={QUESTION_TYPE_LABELS[type as keyof typeof QUESTION_TYPE_LABELS]}>
                {count}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}
    </Space>
  );
}
