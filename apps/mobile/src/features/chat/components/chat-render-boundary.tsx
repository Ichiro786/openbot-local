import { Component, type ReactNode } from "react";

/**
 * Build 15.3: shows `fallback` in place of children that throw while rendering, so one broken part
 * of a message (an agent's `openbot-ui` block, a Markdown block) never takes the chat down with it.
 * A new `resetKey` (the text changed, as while a reply streams) renders the children again.
 */
export class ChatRenderBoundary extends Component<
  { fallback: ReactNode; resetKey: unknown; children?: ReactNode },
  { failed: boolean; key: unknown }
> {
  override state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: unknown }, state: { key: unknown }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  override componentDidCatch(error: unknown) {
    // The support log captures console warnings (support-log-capture), so the cause stays findable.
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.warn(`Chat message part failed to render: ${detail.slice(0, 800)}`);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
