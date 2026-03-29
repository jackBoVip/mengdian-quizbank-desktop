import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleOutlined, PauseOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Empty, Input, Progress, Radio, Space, Tag, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import type { PracticeSession, SessionQuestion } from '@shared/types';
import { QUESTION_TYPE_LABELS } from '@shared/types';
import { useAppStore } from '@renderer/store/appStore';

const inferBlankCount = (stem: string): number => {
  const matches = stem.match(/（\s*）|\(\s*\)|_{2,}/g);
  return matches?.length ?? 1;
};

const normalizeAnswers = (question: SessionQuestion, draftValues: string[]): string[] => {
  if (question.type === 'multiple') {
    return [...new Set(draftValues.map((item) => item.trim()).filter(Boolean))].sort();
  }
  return draftValues.map((item) => item.trim()).filter(Boolean);
};

const QuestionAnswerEditor = ({
  question,
  values,
  onChange
}: {
  question: SessionQuestion;
  values: string[];
  onChange: (next: string[]) => void;
}): JSX.Element => {
  if (question.type === 'single') {
    return (
      <Radio.Group value={values[0]} onChange={(event) => onChange([event.target.value])}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {question.options?.map((option) => (
            <Card key={option.key} className="option-card" bodyStyle={{ padding: 0 }}>
              <Radio style={{ width: '100%', padding: 14 }} value={option.key}>
                <strong style={{ marginRight: 8 }}>{option.key}.</strong>
                {option.text}
              </Radio>
            </Card>
          ))}
        </Space>
      </Radio.Group>
    );
  }

  if (question.type === 'multiple') {
    return (
      <Checkbox.Group value={values} onChange={(next) => onChange(next.map(String))} style={{ width: '100%' }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {question.options?.map((option) => (
            <Card key={option.key} className="option-card" bodyStyle={{ padding: 0 }}>
              <Checkbox style={{ width: '100%', padding: 14 }} value={option.key}>
                <strong style={{ marginRight: 8 }}>{option.key}.</strong>
                {option.text}
              </Checkbox>
            </Card>
          ))}
        </Space>
      </Checkbox.Group>
    );
  }

  if (question.type === 'true_false') {
    return (
      <Radio.Group value={values[0]} onChange={(event) => onChange([event.target.value])}>
        <Space>
          <Radio.Button value="正确">正确</Radio.Button>
          <Radio.Button value="错误">错误</Radio.Button>
        </Space>
      </Radio.Group>
    );
  }

  const blankCount = question.userAnswers?.length || question.correctAnswers?.length || inferBlankCount(question.stem);
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {Array.from({ length: blankCount }).map((_, index) => (
        <Input
          key={`blank-${index}`}
          value={values[index] ?? ''}
          placeholder={`填写第 ${index + 1} 个空`}
          onChange={(event) => {
            const next = [...values];
            next[index] = event.target.value;
            onChange(next);
          }}
        />
      ))}
    </Space>
  );
};

export function SessionPage(): JSX.Element {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const [messageApi, contextHolder] = message.useMessage();
  const activeSession = useAppStore((state) => state.activeSession);
  const answerSession = useAppStore((state) => state.answerSession);
  const finishActiveSession = useAppStore((state) => state.finishActiveSession);
  const pauseActiveSession = useAppStore((state) => state.pauseActiveSession);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [draftAnswers, setDraftAnswers] = useState<string[]>([]);

  const session: PracticeSession | null = activeSession && activeSession.id === sessionId ? activeSession : null;
  const currentQuestion = session?.questions[currentIndex];

  useEffect(() => {
    if (!session) return;
    setCurrentIndex((prev) => Math.min(prev, Math.max(session.questions.length - 1, 0)));
  }, [session]);

  useEffect(() => {
    if (!currentQuestion) return;
    setDraftAnswers(currentQuestion.userAnswers ?? []);
  }, [currentQuestion]);

  const answeredCount = useMemo(() => session?.questions.filter((question) => question.userAnswers?.length).length ?? 0, [session]);

  if (!session) {
    return (
      <Card className="page-panel">
        <Empty description="当前会话不在内存中。请从题库管理页重新开始一次练习或考试。">
          <Button type="primary" onClick={() => navigate('/libraries')}>
            返回题库管理
          </Button>
        </Empty>
      </Card>
    );
  }

  if (!currentQuestion) {
    return (
      <Card className="page-panel">
        <Empty description="当前会话没有题目。">
          <Button type="primary" onClick={() => navigate('/libraries')}>
            返回题库管理
          </Button>
        </Empty>
      </Card>
    );
  }

  const handleSubmitCurrent = async (): Promise<void> => {
    const nextSession = await answerSession({
      sessionId: session.id,
      questionId: currentQuestion.questionId,
      answers: normalizeAnswers(currentQuestion, draftAnswers)
    });
    if (nextSession.mode === 'practice') {
      const nextQuestion = nextSession.questions.find((item) => item.questionId === currentQuestion.questionId);
      if (nextQuestion?.isCorrect) {
        messageApi.success('回答正确。');
      } else {
        messageApi.error('回答错误，已加入错题统计。');
      }
    } else {
      messageApi.success('答案已记录。');
    }
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <div className="page-header">
          <div>
            <h2>{session.title}</h2>
            <p>
              {session.mode === 'exam' ? '模拟考试模式：提交前不显示答案。' : '练习模式：提交后即时判分并展示正确答案。'}
            </p>
          </div>
          <Space>
            <Button icon={<PauseOutlined />} onClick={() => void pauseActiveSession()}>
              暂停
            </Button>
            <Button type="primary" onClick={() => void finishActiveSession()}>
              {session.mode === 'exam' ? '提交考试' : '结束练习'}
            </Button>
          </Space>
        </div>

        <div className="stat-grid">
          <Card className="glass-card">
            <Typography.Text type="secondary">已答进度</Typography.Text>
            <Progress percent={Number(((answeredCount / session.questionCount) * 100).toFixed(1))} />
          </Card>
          <Card className="glass-card">
            <Typography.Text type="secondary">当前得分</Typography.Text>
            <Typography.Title level={3} style={{ margin: '8px 0 0' }}>
              {session.score} / {session.totalScore}
            </Typography.Title>
          </Card>
          <Card className="glass-card">
            <Typography.Text type="secondary">当前题号</Typography.Text>
            <Typography.Title level={3} style={{ margin: '8px 0 0' }}>
              {currentIndex + 1} / {session.questionCount}
            </Typography.Title>
          </Card>
          <Card className="glass-card">
            <Typography.Text type="secondary">状态</Typography.Text>
            <Typography.Title level={4} style={{ margin: '8px 0 0' }}>
              {session.status}
            </Typography.Title>
          </Card>
        </div>

        <div className="session-grid">
          <Card className="page-panel" title={`${QUESTION_TYPE_LABELS[currentQuestion.type]} · 第 ${currentIndex + 1} 题`}>
            <Space direction="vertical" size={18} style={{ width: '100%' }}>
              <Space>
                <Tag color="green">题号 {currentQuestion.sourceNo}</Tag>
                <Tag color="lime">{currentQuestion.section}</Tag>
                {currentQuestion.tags.map((tag) => (
                  <Tag key={`${currentQuestion.questionId}-${tag}`}>{tag}</Tag>
                ))}
              </Space>

              <Typography.Paragraph className="question-stem">{currentQuestion.stem}</Typography.Paragraph>

              <QuestionAnswerEditor question={currentQuestion} values={draftAnswers} onChange={setDraftAnswers} />

              <Space wrap>
                <Button icon={<ArrowLeftOutlined />} disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}>
                  上一题
                </Button>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void handleSubmitCurrent()}>
                  提交本题
                </Button>
                <Button
                  icon={<ArrowRightOutlined />}
                  disabled={currentIndex === session.questionCount - 1}
                  onClick={() => setCurrentIndex((index) => Math.min(index + 1, session.questionCount - 1))}
                >
                  下一题
                </Button>
              </Space>

              {currentQuestion.userAnswers?.length ? (
                <Alert
                  type={currentQuestion.isCorrect ? 'success' : 'error'}
                  showIcon
                  message={currentQuestion.isCorrect ? '当前题作答正确' : '当前题作答错误'}
                  description={
                    session.showAnswers && currentQuestion.correctAnswers?.length ? (
                      <Space direction="vertical">
                        <span>你的答案：{currentQuestion.userAnswers.join(' / ')}</span>
                        <span>正确答案：{currentQuestion.correctAnswers.join(' / ')}</span>
                        {currentQuestion.explanation ? <span>解析：{currentQuestion.explanation}</span> : null}
                      </Space>
                    ) : (
                      <span>答案已记录，可继续作答。</span>
                    )
                  }
                />
              ) : null}
            </Space>
          </Card>

          <Card className="page-panel" title="答题卡">
            <Space direction="vertical" size={18} style={{ width: '100%' }}>
              <div className="question-nav-grid">
                {session.questions.map((question, index) => {
                  const answered = Boolean(question.userAnswers?.length);
                  const statusColor =
                    currentIndex === index ? 'primary' : answered ? (question.isCorrect === false ? 'danger' : 'default') : 'dashed';
                  return (
                    <Button key={question.questionId} type={statusColor as 'primary' | 'default' | 'dashed'} danger={question.isCorrect === false} onClick={() => setCurrentIndex(index)}>
                      {index + 1}
                    </Button>
                  );
                })}
              </div>

              <Space wrap>
                <Tag color="green">总题数 {session.questionCount}</Tag>
                <Tag color="green">已答 {answeredCount}</Tag>
                <Tag color="gold">正确 {session.correctCount}</Tag>
                {session.passScore !== null ? <Tag color="purple">及格线 {session.passScore}</Tag> : null}
              </Space>
            </Space>
          </Card>
        </div>
      </Space>
    </>
  );
}
