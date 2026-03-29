import { useEffect } from 'react';
import { BarChartOutlined, BookOutlined, DatabaseOutlined, FolderOpenOutlined, SettingOutlined } from '@ant-design/icons';
import { Layout, Menu, Tag } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { HomePage } from '@renderer/pages/HomePage';
import { ImportPage } from '@renderer/pages/ImportPage';
import { LibrariesPage } from '@renderer/pages/LibrariesPage';
import { ReviewPage } from '@renderer/pages/ReviewPage';
import { SessionPage } from '@renderer/pages/SessionPage';
import { SettingsPage } from '@renderer/pages/SettingsPage';
import { AssistantOverlayPage } from '@renderer/pages/AssistantOverlayPage';
import { brandLogoUrl } from '@renderer/assets';
import { PageViewport } from '@renderer/components/PageViewport';
import { useAppStore } from '@renderer/store/appStore';

const { Sider, Content } = Layout;

export default function App(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = useAppStore((state) => state.bootstrap);
  const isOverlayRoute = location.pathname === '/assistant-overlay';

  useEffect(() => {
    if (isOverlayRoute) return;
    void bootstrap();
  }, [bootstrap, isOverlayRoute]);

  const selectedKey = location.pathname.startsWith('/import')
    ? 'import'
    : location.pathname.startsWith('/review')
      ? 'review'
      : location.pathname.startsWith('/libraries')
        ? 'libraries'
        : location.pathname.startsWith('/settings')
          ? 'settings'
          : 'home';

  if (isOverlayRoute) {
    return (
      <Routes>
        <Route path="/assistant-overlay" element={<AssistantOverlayPage />} />
      </Routes>
    );
  }

  return (
    <Layout className="app-shell">
      <Sider width={248} breakpoint="lg" collapsedWidth={88} className="shell-sider">
        <div className="shell-sider__inner">
          <div className="brand-block">
            <Tag bordered={false} className="brand-block__tag">
              企业离线题库桌面版
            </Tag>
            <div className="brand-block__header">
              <div className="brand-block__halo" />
              <div className="brand-block__banner">
                <img className="brand-block__logo" src={brandLogoUrl} alt="蒙电题库通 logo" />
              </div>
              <div className="brand-block__copy">
                <div className="brand-block__eyebrow">MENGDIAN QUIZBANK</div>
                <h1>蒙电题库通</h1>
                <div className="brand-block__subtitle">离线刷题与模拟考试终端</div>
              </div>
            </div>
            <div className="brand-block__divider" />
            <p>DOCX / TXT / XLSX 导入、题库校对与模拟考试一体化。</p>
          </div>

          <Menu
            className="shell-menu"
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
            items={[
              { key: 'home', icon: <BarChartOutlined />, label: '总览', onClick: () => navigate('/') },
              { key: 'import', icon: <FolderOpenOutlined />, label: '导入题库', onClick: () => navigate('/import') },
              { key: 'review', icon: <BookOutlined />, label: '题目校对', onClick: () => navigate('/review') },
              { key: 'libraries', icon: <DatabaseOutlined />, label: '题库管理', onClick: () => navigate('/libraries') },
              { key: 'settings', icon: <SettingOutlined />, label: '设置与备份', onClick: () => navigate('/settings') }
            ]}
          />

          <div className="shell-sider__footer">
            <div className="shell-sider__footer-dot" />
            <div className="shell-sider__footer-copy">
              <span className="shell-sider__footer-label">当前模式</span>
              <strong className="shell-sider__footer-title">纯本地离线终端</strong>
              <span className="shell-sider__footer-meta">数据只保存在当前设备，适合企业内网与本地培训场景。</span>
            </div>
          </div>
        </div>
      </Sider>
      <Layout className="workspace-shell">
        <Content className="shell-content">
          <PageViewport>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/libraries" element={<LibrariesPage />} />
              <Route path="/session/:sessionId" element={<SessionPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/assistant-overlay" element={<AssistantOverlayPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PageViewport>
        </Content>
      </Layout>
    </Layout>
  );
}
