import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter } from 'react-router-dom';
import App from '@renderer/App';
import '@renderer/styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: [theme.defaultAlgorithm],
        token: {
          colorPrimary: '#1f3d36',
          colorInfo: '#1f3d36',
          colorSuccess: '#1f3d36',
          colorWarning: '#197148',
          colorError: '#cf1322',
          colorBgLayout: '#f5f8f4',
          colorText: '#37413d',
          colorTextHeading: '#1f2622',
          colorBorder: 'rgba(31, 38, 34, 0.12)',
          colorSplit: 'rgba(31, 38, 34, 0.08)',
          boxShadowSecondary: '0 18px 48px rgba(28, 33, 30, 0.08)',
          borderRadius: 12,
          wireframe: false,
          fontFamily: '"PingFang SC", "Microsoft YaHei UI", "Segoe UI", sans-serif'
        },
        components: {
          Button: {
            controlHeight: 44,
            defaultShadow: 'none',
            primaryShadow: 'none',
            borderRadius: 12
          },
          Card: {
            borderRadiusLG: 22
          },
          Input: {
            activeShadow: '0 0 0 3px rgba(31, 61, 54, 0.08)',
            hoverBorderColor: 'rgba(31, 38, 34, 0.2)',
            activeBorderColor: 'rgba(31, 61, 54, 0.46)'
          },
          Menu: {
            itemBorderRadius: 16,
            itemSelectedBg: 'rgba(31, 61, 54, 0.08)',
            itemSelectedColor: '#1f2622',
            itemHoverBg: 'rgba(31, 61, 54, 0.05)',
            itemColor: '#5f6963',
            darkItemBg: '#071e31',
            darkItemColor: 'rgba(255, 255, 255, 0.72)',
            darkItemHoverBg: 'rgba(255, 255, 255, 0.08)',
            darkItemSelectedBg: '#1f7a52',
            darkItemSelectedColor: '#ffffff',
            darkSubMenuItemBg: '#071e31'
          },
          Layout: {
            bodyBg: '#f5f8f4',
            siderBg: '#071e31',
            headerBg: '#ffffff',
            triggerBg: '#071e31',
            triggerColor: '#ffffff'
          }
        }
      }}
    >
      <AntdApp>
        <HashRouter>
          <App />
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);
