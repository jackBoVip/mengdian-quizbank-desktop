import { useEffect } from 'react';
import { ArrowRightOutlined } from '@ant-design/icons';
import { Button, Card, List, Progress, Space, Statistic, Table, Tag, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/api/client';
import { useAppStore } from '@renderer/store/appStore';

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const dashboard = useAppStore((state) => state.dashboard);
  const libraries = useAppStore((state) => state.libraries);
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);
  const refreshLibraries = useAppStore((state) => state.refreshLibraries);

  useEffect(() => {
    void Promise.all([refreshDashboard(), refreshLibraries()]);
  }, [refreshDashboard, refreshLibraries]);

  const handleImportLibrary = async (): Promise<void> => {
    try {
      const result = await api.import.pickFile();
      if (result.canceled || !result.filePath) {
        return;
      }
      navigate('/import', { state: { selectedFilePath: result.filePath } });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法打开文件选择窗口');
    }
  };

  return (
    <div className="page-view dashboard-view">
      <div className="page-header">
        <div>
          <h2>总览面板</h2>
          <p>集中查看题库规模、练习成效、错题热点和最近考试结果。</p>
        </div>
        <Space>
          <Button type="primary" onClick={() => void handleImportLibrary()}>
            导入题库
          </Button>
          <Button onClick={() => navigate('/libraries')}>进入题库管理</Button>
        </Space>
      </div>

      <div className="dashboard-layout">
        <Card className="page-panel dashboard-libraries" title="现有题库">
          <List
            className="dashboard-library-list"
            dataSource={libraries}
            renderItem={(library) => (
              <List.Item>
                <Card
                  hoverable
                  className="glass-card dashboard-library-card"
                  actions={[
                    <Button key="open" type="link" icon={<ArrowRightOutlined />} onClick={() => navigate('/libraries', { state: { libraryId: library.id } })}>
                      打开
                    </Button>
                  ]}
                >
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    <strong style={{ fontSize: 16 }}>{library.name}</strong>
                    <span className="dashboard-muted">{library.description || '未填写描述'}</span>
                    <Space wrap>
                      <Tag color="green">{library.questionCount} 题</Tag>
                      <Tag color="lime">{library.sectionCount} 章节</Tag>
                      <Tag color="green">{library.templateCount} 套模板</Tag>
                    </Space>
                  </Space>
                </Card>
              </List.Item>
            )}
            locale={{ emptyText: '还没有题库，先去导入一套' }}
          />
        </Card>

        <div className="dashboard-stats">
          <Card className="glass-card metric-card">
            <Statistic title="题库数量" value={dashboard.libraryCount} suffix="套" />
          </Card>
          <Card className="glass-card metric-card">
            <Statistic title="题目总数" value={dashboard.questionCount} suffix="题" />
          </Card>
          <Card className="glass-card metric-card">
            <Statistic title="练习 / 考试会话" value={dashboard.practiceCount} suffix="次" />
          </Card>
          <Card className="glass-card metric-card">
            <Statistic title="整体正确率" value={dashboard.accuracy} suffix="%" precision={1} />
          </Card>
          <Card className="glass-card metric-card">
            <Statistic title="收藏题数" value={dashboard.favoritesCount} suffix="题" />
          </Card>
          <Card className="glass-card metric-card">
            <Statistic title="累计错题" value={dashboard.wrongCount} suffix="题" />
          </Card>
        </div>

        <div className="dashboard-bottom">
          <Card className="page-panel dashboard-exams" title="最近考试结果">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={dashboard.recentExams}
              columns={[
                { title: '名称', dataIndex: 'title' },
                { title: '题量', dataIndex: 'questionCount', width: 72 },
                { title: '得分', render: (_, record) => `${record.score}/${record.totalScore}` },
                { title: '及格线', render: (_, record) => (record.passScore === null ? '-' : record.passScore), width: 88 },
                { title: '状态', render: (_, record) => <Tag color={record.status === 'finished' ? 'green' : 'default'}>{record.status}</Tag>, width: 90 }
              ]}
              locale={{ emptyText: '暂无考试记录' }}
            />
          </Card>

          <Card className="page-panel dashboard-weakness" title="薄弱维度">
            <List
              className="dashboard-weakness-list"
              split={false}
              dataSource={[
                ...dashboard.weakSections.map((item) => ({ ...item, group: '章节' })),
                ...dashboard.weakTypes.map((item) => ({ ...item, group: '题型' }))
              ]}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                      <span>
                        <Tag color={item.group === '章节' ? 'lime' : 'gold'}>{item.group}</Tag>
                        {item.name}
                      </span>
                      <strong>{item.accuracy}%</strong>
                    </Space>
                    <Progress percent={item.accuracy} showInfo={false} strokeColor="#1f7a52" />
                    <span className="dashboard-muted">已答 {item.answeredCount} 题</span>
                  </Space>
                </List.Item>
              )}
              locale={{ emptyText: '暂无练习数据' }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
