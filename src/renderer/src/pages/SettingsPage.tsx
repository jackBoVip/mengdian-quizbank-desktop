import { useEffect, useMemo, useState } from 'react';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Input, Space, Switch, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/api/client';
import { brandLogoUrl } from '@renderer/assets';
import type { AssistantMatchResult, AssistantRuntimeStatus, AssistantSettings } from '@shared/types';
import { useAppStore } from '@renderer/store/appStore';

export function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const libraries = useAppStore((state) => state.libraries);
  const selectedLibraryId = useAppStore((state) => state.selectedLibraryId);
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<AssistantRuntimeStatus | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewResult, setPreviewResult] = useState<AssistantMatchResult | null>(null);
  const activeLibraryName = useMemo(
    () => libraries.find((library) => library.id === (assistantSettings?.activeLibraryId ?? selectedLibraryId))?.name ?? '未选择',
    [assistantSettings?.activeLibraryId, libraries, selectedLibraryId]
  );
  const runtimeState = useMemo(() => {
    if (assistantStatus?.running) {
      return { color: 'green', label: '运行中' };
    }
    if (assistantSettings?.enabled && assistantStatus?.blockedReason) {
      return { color: 'gold', label: '待授权' };
    }
    if (assistantSettings?.enabled) {
      return { color: 'processing', label: '待就绪' };
    }
    return { color: 'default', label: '已关闭' };
  }, [assistantSettings?.enabled, assistantStatus?.blockedReason, assistantStatus?.running]);
  const permissionTag = (value: AssistantRuntimeStatus['permissions']['accessibility']): { color: string; label: string } => {
    if (value === 'granted') return { color: 'green', label: '已授权' };
    if (value === 'unsupported') return { color: 'default', label: '未接入' };
    return { color: 'orange', label: '未授权' };
  };

  useEffect(() => {
    void Promise.all([api.assistant.getSettings(), api.assistant.getStatus()]).then(([settings, status]) => {
      setAssistantSettings(settings);
      setAssistantStatus(status);
    });

    const disposeStatus = api.assistant.onStatusChanged((status) => {
      setAssistantStatus(status);
    });

    const pollTimer = window.setInterval(() => {
      void api.assistant.getStatus().then((status) => {
        setAssistantStatus(status);
      });
    }, 1500);

    return () => {
      window.clearInterval(pollTimer);
      disposeStatus();
    };
  }, []);

  const handleImportPack = async (): Promise<void> => {
    const result = await api.library.importPack();
    if (result.canceled) return;
    messageApi.success('题库包导入成功。');
    navigate('/libraries');
  };

  const handleBackup = async (): Promise<void> => {
    const result = await api.library.backupAll();
    if (result.canceled) return;
    messageApi.success(`整库备份已导出到 ${result.filePath}`);
  };

  const handleToggleAssistant = async (enabled: boolean): Promise<void> => {
    const status = await api.assistant.toggle(enabled);
    setAssistantStatus(status);
    const settings = await api.assistant.getSettings();
    setAssistantSettings(settings);
    if (enabled && status.blockedReason) {
      messageApi.info(status.blockedReason);
    }
  };

  const handleRequestPermissions = async (): Promise<void> => {
    const status = await api.assistant.requestPermissions();
    setAssistantStatus(status);
    if (status.blockedReason) {
      messageApi.info(`${status.blockedReason} 如状态未刷新，建议重启应用。`);
      return;
    }
    messageApi.success('权限状态已刷新，答题助手可继续运行。');
  };

  const handlePreviewMatch = async (): Promise<void> => {
    const result = await api.assistant.previewMatch({ text: previewText });
    setPreviewResult(result);
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <div className="page-header">
          <div>
            <h2>设置与备份</h2>
            <p>管理题库包分发、整库备份，以及离线部署的基本说明。</p>
          </div>
        </div>

        <Card className="page-panel" title="数据操作">
          <Space wrap>
            <Button icon={<UploadOutlined />} type="primary" onClick={() => void handleImportPack()}>
              导入题库包
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => void handleBackup()}>
              导出整库备份
            </Button>
          </Space>
        </Card>

        <Card className="page-panel assistant-settings-panel" title="答题助手">
          <div className="assistant-settings-panel__header">
            <div>
              <Typography.Title level={4}>系统级答题助手</Typography.Title>
              <Typography.Paragraph>
                开启后会在后台监听鼠标悬停区域，按当前题库做模糊匹配，并在鼠标旁显示“答案 + 置信度”。当前构建会优先读取系统可访问文本，缺失时再用本地 OCR 补识别。
              </Typography.Paragraph>
            </div>
            <Switch checked={assistantSettings?.enabled ?? false} onChange={(checked) => void handleToggleAssistant(checked)} />
          </div>

          {assistantStatus?.blockedReason ? (
            <Alert
              type="warning"
              showIcon
              message={assistantStatus.blockedReason}
              action={
                <Button size="small" type="link" onClick={() => void handleRequestPermissions()}>
                  去授权
                </Button>
              }
            />
          ) : null}

          <Descriptions bordered column={2} className="assistant-settings-panel__descriptions">
            <Descriptions.Item label="运行状态">
              <Tag color={runtimeState.color}>{runtimeState.label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="匹配范围">{activeLibraryName}</Descriptions.Item>
            <Descriptions.Item label="触发模式">自动悬停</Descriptions.Item>
            <Descriptions.Item label="识别方式">
              {assistantStatus?.permissions.ocrRuntime === 'unsupported' ? '辅助功能文本读取' : '混合识别'}
            </Descriptions.Item>
            <Descriptions.Item label="提示内容">答案 + 置信度</Descriptions.Item>
            <Descriptions.Item label="全局快捷键">{assistantSettings?.shortcut ?? 'CommandOrControl+Shift+H'}</Descriptions.Item>
            <Descriptions.Item label="辅助功能权限">
              <Tag color={permissionTag(assistantStatus?.permissions.accessibility ?? 'missing').color}>
                {permissionTag(assistantStatus?.permissions.accessibility ?? 'missing').label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="屏幕录制权限">
              <Tag color={permissionTag(assistantStatus?.permissions.screenCapture ?? 'missing').color}>
                {permissionTag(assistantStatus?.permissions.screenCapture ?? 'missing').label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="OCR 运行时">
              <Tag color={assistantStatus?.permissions.ocrRuntime === 'granted' ? 'green' : assistantStatus?.permissions.ocrRuntime === 'unsupported' ? 'default' : 'orange'}>
                {assistantStatus?.permissions.ocrRuntime === 'granted' ? '就绪' : assistantStatus?.permissions.ocrRuntime === 'unsupported' ? '未接入' : '不可用'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="最近识别源">
              {assistantStatus?.lastTextSource === 'none' ? '暂无' : assistantStatus?.lastTextSource === 'accessibility' ? '辅助功能文本' : '本地 OCR'}
            </Descriptions.Item>
          </Descriptions>

          <div className="assistant-settings-panel__preview">
            <Typography.Title level={5}>运行诊断</Typography.Title>
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="当前运行包">{assistantStatus?.diagnostics.isPackaged ? '打包版' : '开发态'}</Descriptions.Item>
              <Descriptions.Item label="权限主体">{assistantStatus?.diagnostics.helperDisplayName ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="权限来源">
                {assistantStatus?.diagnostics.permissionSource === 'native-helper' ? '内置 helper 进程' : 'Electron 主进程'}
              </Descriptions.Item>
              <Descriptions.Item label="主程序路径">
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {assistantStatus?.diagnostics.appExecutablePath ?? '-'}
                </Typography.Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="Helper 路径">
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {assistantStatus?.diagnostics.helperExecutablePath ?? '-'}
                </Typography.Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="Helper Bundle ID">{assistantStatus?.diagnostics.helperBundleId ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Helper Bundle 路径">
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {assistantStatus?.diagnostics.helperBundlePath ?? '-'}
                </Typography.Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="OCR 引擎">{assistantStatus?.diagnostics.ocrEngine ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="最近识别文本">
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {assistantStatus?.lastRecognizedText ?? '暂无'}
                </Typography.Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="最佳候选">
                {assistantStatus?.diagnostics.lastBestMatch
                  ? `${assistantStatus.diagnostics.lastBestMatch.answerText ?? '无答案'} · 置信度 ${Number(
                      (assistantStatus.diagnostics.lastBestMatch.confidence * 100).toFixed(1)
                    )}% · 题号 ${assistantStatus.diagnostics.lastBestMatch.sourceNo ?? '-'} · ${
                      assistantStatus.diagnostics.lastBestMatch.shouldDisplay ? '可展示' : '被阈值拦截'
                    }`
                  : '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="第二候选">
                {assistantStatus?.diagnostics.lastSecondMatch
                  ? `置信度 ${Number((assistantStatus.diagnostics.lastSecondMatch.confidence * 100).toFixed(1))}% · 题号 ${
                      assistantStatus.diagnostics.lastSecondMatch.sourceNo ?? '-'
                    }`
                  : '暂无'}
              </Descriptions.Item>
              {assistantStatus?.diagnostics.helperLastError ? (
                <Descriptions.Item label="最近 Helper 错误">{assistantStatus.diagnostics.helperLastError}</Descriptions.Item>
              ) : null}
              {assistantStatus?.diagnostics.ocrLastError ? (
                <Descriptions.Item label="最近 OCR 错误">{assistantStatus.diagnostics.ocrLastError}</Descriptions.Item>
              ) : null}
            </Descriptions>
          </div>

          <Space wrap>
            <Button type="primary" onClick={() => void handleRequestPermissions()}>
              申请系统权限
            </Button>
          </Space>

          <div className="assistant-settings-panel__preview">
            <Typography.Title level={5}>调试预览</Typography.Title>
            <Typography.Paragraph>粘贴题干或鼠标附近识别出的文本，验证当前题库的命中结果。</Typography.Paragraph>
            <Input.TextArea rows={4} value={previewText} onChange={(event) => setPreviewText(event.target.value)} placeholder="输入题干文本..." />
            <Space>
              <Button type="primary" onClick={() => void handlePreviewMatch()} disabled={!previewText.trim()}>
                预览匹配
              </Button>
            </Space>
            {previewResult ? (
              <Alert
                type={previewResult.matched ? 'success' : 'info'}
                showIcon
                message={previewResult.matched ? `答案：${previewResult.answerText}` : '未命中当前题库'}
                description={
                  previewResult.matched
                    ? `置信度 ${Number((previewResult.confidence * 100).toFixed(1))}% · 题号 ${previewResult.sourceNo ?? '-'}`
                    : `识别文本：${previewResult.recognizedText || '无'}`
                }
              />
            ) : null}
          </div>
        </Card>

        <Card className="page-panel" title="当前版本说明">
          <div className="brand-profile">
            <img className="brand-profile__logo" src={brandLogoUrl} alt="蒙电题库通 logo" />
            <div className="brand-profile__content">
              <strong>蒙电题库通</strong>
              <p>采用 `mengdianops-extension` 项目中的蒙电 logo 作为桌面应用统一品牌资源，覆盖应用页签、侧边栏与安装包图标。</p>
            </div>
          </div>
          <Descriptions bordered column={1}>
            <Descriptions.Item label="运行方式">纯本地离线桌面应用，数据保存在本机。</Descriptions.Item>
            <Descriptions.Item label="支持格式">DOCX、TXT、XLSX。</Descriptions.Item>
            <Descriptions.Item label="题型">单选、多选、填空、判断。</Descriptions.Item>
            <Descriptions.Item label="导出能力">单题库包导出、整库备份导出。</Descriptions.Item>
            <Descriptions.Item label="默认约束">无图片题、无云同步、无账号体系。</Descriptions.Item>
          </Descriptions>
        </Card>
      </Space>
    </>
  );
}
