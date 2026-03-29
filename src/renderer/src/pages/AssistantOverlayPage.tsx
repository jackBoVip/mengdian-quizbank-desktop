import { useEffect, useState } from 'react';
import type { AssistantTipPayload } from '@shared/types';
import { api } from '@renderer/api/client';

export function AssistantOverlayPage(): JSX.Element {
  const [tip, setTip] = useState<AssistantTipPayload | null>(null);

  useEffect(() => {
    const unsubscribe = api.assistant.onTipChanged((nextTip) => {
      setTip(nextTip);
    });
    return unsubscribe;
  }, []);

  return (
    <div className={`assistant-overlay${tip?.visible ? ' assistant-overlay--visible' : ''}`}>
      {tip ? (
        <div className="assistant-overlay__bubble">
          <div className="assistant-overlay__label">标准答案</div>
          <div className="assistant-overlay__answer">{tip.answer}</div>
          <div className="assistant-overlay__meta">匹配置信度 {tip.confidence.toFixed(1)}%</div>
        </div>
      ) : null}
    </div>
  );
}
