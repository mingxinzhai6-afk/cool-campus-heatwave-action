import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 顶层错误边界：任何渲染异常都会显示在页面上，而不是留下一片空白。
 * 现场演示时如果真出问题，至少能立刻看到是哪一行。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[清凉校园] 渲染异常：', error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="crash">
          <div className="crash-card">
            <h1>页面出错了</h1>
            <p>已捕获到运行时异常。请把下面的信息发给开发者，或直接重新加载。</p>
            <pre>{String(error.stack ?? error)}</pre>
            <button
              className="primary"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
